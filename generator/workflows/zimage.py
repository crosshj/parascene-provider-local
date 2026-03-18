"""Z-Image generation workflow — local-only, strict loading, no remote resolution."""

from __future__ import annotations

import inspect
import json
import os
import random
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Tuple

def resolve_zimage_model_path(model_path: str) -> str:
    original = Path(model_path)
    if original.exists():
        return str(original)
    raise FileNotFoundError(f"Z-Image checkpoint not found: {original}")

@lru_cache(maxsize=8)
def is_transformer_only_zimage_checkpoint(path_value: str) -> bool:
    try:
        from safetensors import safe_open
        with safe_open(path_value, framework="pt", device="cpu") as sf:
            keys = list(sf.keys())
        has_transformer = any(k.startswith("model.diffusion_model.") for k in keys)
        has_clip = any("text_model.embeddings.position_embedding.weight" in k for k in keys)
        has_vae = any(k.startswith("first_stage_model.") for k in keys)
        return has_transformer and not (has_clip or has_vae)
    except Exception:
        return False

def build_zimage_load_kwargs(configs_dir: Path, torch_dtype) -> Tuple[Path, dict]:
    # Standard: configs_dir/z-image
    local_config = configs_dir / "z-image"
    if not (local_config / "model_index.json").exists():
        # Try environment override
        env_config = os.environ.get("ZIMAGE_CONFIG_DIR")
        if env_config:
            env_path = Path(env_config).expanduser()
            if (env_path / "model_index.json").exists():
                local_config = env_path
            else:
                raise RuntimeError(
                    f"Z-Image config not found at env override {env_path}. "
                    "Run setup_configs.py or check your configs directory."
                )
        else:
            raise RuntimeError(
                f"Z-Image config not found at {local_config}. "
                "Run setup_configs.py or check your configs directory."
            )
    return local_config, {
        "config": str(local_config),
        "torch_dtype": torch_dtype,
        "local_files_only": True,
    }

def load_pipeline(model_path: str, configs_dir: Path, torch_module, use_cuda: bool, zimage_dtype, use_cpu_offload: bool, enable_xformers: bool):
    from diffusers import AutoencoderKL, FluxPipeline
    model_path = resolve_zimage_model_path(model_path)
    local_config, load_kwargs = build_zimage_load_kwargs(configs_dir, zimage_dtype)
    def _from_single_file_with_meta_retry(path_value, kwargs_value):
        try:
            return FluxPipeline.from_single_file(path_value, **kwargs_value)
        except Exception as first_exc:
            if "meta tensor" not in str(first_exc).lower():
                raise
            return FluxPipeline.from_single_file(path_value, low_cpu_mem_usage=False, **kwargs_value)
    if is_transformer_only_zimage_checkpoint(model_path):
        pipe = _from_single_file_with_meta_retry(model_path, load_kwargs)
    else:
        pipe = _from_single_file_with_meta_retry(model_path, load_kwargs)
    pipe = pipe.to("cuda" if use_cuda else "cpu")
    if enable_xformers and use_cuda:
        try:
            pipe.enable_xformers_memory_efficient_attention()
            sys.stderr.write("[worker] Z-Image xformers attention: enabled\n")
            sys.stderr.flush()
        except Exception as xf_exc:
            sys.stderr.write(f"[worker] Z-Image xformers attention: unavailable ({xf_exc})\n")
            sys.stderr.flush()
    else:
        sys.stderr.write("[worker] Z-Image xformers attention: disabled by config\n")
        sys.stderr.flush()
    return pipe

def generate(pipe, payload: dict, torch_module) -> tuple:
    from lib.utils import apply_family_guidance_kwargs, can_use_cuda
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Missing required field: prompt")
    negative_prompt = str(payload.get("negative_prompt", "") or "")
    width = int(payload.get("width", 1024))
    height = int(payload.get("height", 1024))
    steps = int(payload.get("steps", 30))
    cfg = float(payload.get("cfg", 7.0))
    guidance = float(payload.get("guidance", 3.5))
    seed = payload.get("seed")
    if seed is None:
        seed = random.randint(1, 2_147_483_647)
    seed = int(seed)
    use_cuda = can_use_cuda(torch_module)
    generator = torch_module.Generator(device="cuda" if use_cuda else "cpu").manual_seed(seed)
    kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "generator": generator,
    }
    apply_family_guidance_kwargs("z-image", kwargs, cfg, guidance, negative_prompt)
    with torch_module.inference_mode():
        result = pipe(**kwargs)
    if not getattr(result, "images", None):
        raise RuntimeError("Pipeline did not return images.")
    return result.images[0], seed

if __name__ == "__main__":
    import argparse
    import time
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from lib.utils import can_use_cuda, describe_exception, log_cuda_fallback_once, log_selected_cuda_once, to_win_path
    parser = argparse.ArgumentParser(description="Z-Image standalone generator")
    parser.add_argument("--model", required=True, help="Path to Z-Image checkpoint")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--out-dir", default="outputs")
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--guidance", type=float, default=3.5)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    import torch
    use_cuda = can_use_cuda(torch)
    if use_cuda:
        log_selected_cuda_once(torch)
        try:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True
        except Exception:
            pass
    else:
        log_cuda_fallback_once()
    _zimage_dtype_env = (os.environ.get("ZIMAGE_DTYPE", "fp16") or "fp16").strip().lower()
    zimage_dtype = torch.float16 if use_cuda else torch.float32
    if use_cuda and _zimage_dtype_env in ("bf16", "bfloat16"):
        zimage_dtype = torch.bfloat16
    use_cpu_offload = os.environ.get("ZIMAGE_USE_CPU_OFFLOAD", "0") == "1"
    enable_xformers = os.environ.get("ZIMAGE_ENABLE_XFORMERS", "0") == "1"
    configs_dir = Path(__file__).resolve().parents[1] / "configs"
    model_path = to_win_path(args.model)
    started = time.time()
    try:
        pipe = load_pipeline(
            model_path,
            configs_dir,
            torch,
            use_cuda,
            zimage_dtype,
            use_cpu_offload,
            enable_xformers,
        )
        payload = {
            "prompt": args.prompt,
            "width": args.width,
            "height": args.height,
            "steps": args.steps,
            "guidance": args.guidance,
            "seed": args.seed,
        }
        image, seed = generate(pipe, payload, torch)
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        out_path = out_dir / f"img-{stamp}-{seed}.png"
        image.save(out_path)
        print(json.dumps({
            "ok": True,
            "file_path": str(out_path),
            "seed": seed,
            "elapsed_ms": int((time.time() - started) * 1000),
        }, indent=2))
    except Exception as exc:
        import traceback
        print(json.dumps({
            "ok": False,
            "error": describe_exception(exc),
            "trace": traceback.format_exc(limit=1),
        }))
        sys.exit(1)
