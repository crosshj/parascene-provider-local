"""FLUX generation workflow — local-only, strict loading, no remote resolution."""

from __future__ import annotations

import inspect
import json
import os
import random
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Tuple


def resolve_flux_model_path(model_path: str, family: str) -> str:
    if family != "flux":
        return model_path

    original = Path(model_path)
    if original.exists():
        return str(original)

    original_norm = str(original).replace("/", "\\").lower()
    if "checkpoints\\flux1" in original_norm:
        dm_candidate = Path("D:/comfy_models/diffusion_models/flux") / original.name
        if dm_candidate.exists():
            sys.stderr.write(
                f"[worker] FLUX path remap: using {dm_candidate} instead of missing {original}\n"
            )
            sys.stderr.flush()
            return str(dm_candidate)

    raise FileNotFoundError(f"FLUX checkpoint not found: {original}")


@lru_cache(maxsize=8)
def is_transformer_only_flux_checkpoint(path_value: str) -> bool:
    try:
        from safetensors import safe_open

        with safe_open(path_value, framework="pt", device="cpu") as sf:
            keys = list(sf.keys())

        has_flux_transformer = any(
            k.startswith("model.diffusion_model.")
            or k.startswith("double_blocks.")
            or k.startswith("single_blocks.")
            or k.startswith("img_in.")
            for k in keys
        )
        has_clip = any("text_model.embeddings.position_embedding.weight" in k for k in keys)
        has_t5 = any(
            k.startswith("conditioner.embedders.1.model.")
            or k.startswith("text_encoders.t5xxl.transformer.")
            for k in keys
        )
        has_vae = any(k.startswith("first_stage_model.") for k in keys)
        return has_flux_transformer and not (has_clip or has_t5 or has_vae)
    except Exception:
        return False


def build_flux_load_kwargs(configs_dir: Path, torch_dtype) -> Tuple[Path, dict]:
    local_config = Path(
        os.environ.get("FLUX_CONFIG_DIR", str(configs_dir / "flux"))
    ).expanduser()

    if not (local_config / "model_index.json").exists():
        raise RuntimeError(
            "FLUX local config not found. Set FLUX_CONFIG_DIR to a local FLUX diffusers config directory."
        )

    return local_config, {
        "config": str(local_config),
        "torch_dtype": torch_dtype,
        "local_files_only": True,
    }


def _pick_local_path(label: str, env_name: str, candidates: list[Path]) -> Path:
    env_value = (os.environ.get(env_name, "") or "").strip()
    if env_value:
        path = Path(env_value).expanduser()
        if not path.exists():
            raise RuntimeError(f"{env_name} points to missing {label}: {path}")
        return path

    for path in candidates:
        if path.exists():
            return path

    tried = "\n".join(f"  - {p}" for p in candidates)
    raise RuntimeError(
        f"Missing local {label}. Set {env_name} or place one at:\n{tried}"
    )


def load_flux_with_local_components(
    transformer_path: str,
    local_config_path: Path,
    torch_dtype,
    FluxPipeline,
    AutoencoderKL,
):
    from safetensors.torch import load_file
    from transformers import (
        CLIPTextConfig,
        CLIPTextModel,
        CLIPTokenizer,
        T5Config,
        T5EncoderModel,
        T5TokenizerFast,
    )

    clip_path = _pick_local_path(
        "CLIP encoder",
        "FLUX_CLIP_PATH",
        [
            Path("D:/comfy_models/text_encoders/clip_l.safetensors"),
        ],
    )
    t5_path = _pick_local_path(
        "T5 encoder",
        "FLUX_T5_PATH",
        [
            Path("D:/comfy_models/text_encoders/t5xxl_fp16.safetensors"),
            Path("D:/comfy_models/text_encoders/t5xxl_fp8_e4m3fn_scaled.safetensors"),
        ],
    )
    vae_path = _pick_local_path(
        "VAE",
        "FLUX_VAE_PATH",
        [
            Path("D:/comfy_models/vae/ae.safetensors"),
        ],
    )
    clip_tok_dir = _pick_local_path(
        "CLIP tokenizer dir",
        "FLUX_CLIP_TOKENIZER_DIR",
        [
            local_config_path / "tokenizer",
        ],
    )
    t5_tok_dir = _pick_local_path(
        "T5 tokenizer dir",
        "FLUX_T5_TOKENIZER_DIR",
        [
            local_config_path / "tokenizer_2",
            Path("C:/ComfyUI_windows_portable_2/ComfyUI/comfy/text_encoders/t5_tokenizer"),
        ],
    )

    clip_cfg_dir = local_config_path / "text_encoder"
    t5_cfg_dir = local_config_path / "text_encoder_2"
    vae_cfg_dir = local_config_path / "vae"

    for required_dir in (clip_cfg_dir, t5_cfg_dir, vae_cfg_dir):
        if not required_dir.exists():
            raise RuntimeError(f"Missing local config directory: {required_dir}")

    sys.stderr.write(
        "[worker] FLUX local components:\n"
        f"  transformer: {transformer_path}\n"
        f"  clip:        {clip_path}\n"
        f"  t5:          {t5_path}\n"
        f"  vae:         {vae_path}\n"
        f"  clip tok:    {clip_tok_dir}\n"
        f"  t5 tok:      {t5_tok_dir}\n"
        f"  config dir:  {local_config_path}\n"
    )
    sys.stderr.flush()

    clip_sd = load_file(str(clip_path))
    t5_sd = load_file(str(t5_path))

    clip_cfg = CLIPTextConfig.from_pretrained(str(clip_cfg_dir), local_files_only=True)
    t5_cfg = T5Config.from_pretrained(str(t5_cfg_dir), local_files_only=True)
    t5_cfg.tie_word_embeddings = False

    clip_tokenizer = CLIPTokenizer.from_pretrained(str(clip_tok_dir), local_files_only=True)
    t5_tokenizer = T5TokenizerFast.from_pretrained(
        str(t5_tok_dir),
        local_files_only=True,
    )

    clip_model = CLIPTextModel.from_pretrained(
        pretrained_model_name_or_path=None,
        config=clip_cfg,
        state_dict=clip_sd,
        low_cpu_mem_usage=True,
        torch_dtype=torch_dtype,
    ).eval()

    t5_model = T5EncoderModel.from_pretrained(
        pretrained_model_name_or_path=None,
        config=t5_cfg,
        state_dict=t5_sd,
        low_cpu_mem_usage=True,
        torch_dtype=torch_dtype,
    ).eval()

    try:
        vae_model = AutoencoderKL.from_single_file(
            str(vae_path),
            config=str(vae_cfg_dir),
            torch_dtype=torch_dtype,
            local_files_only=True,
        )
    except Exception as vae_exc:
        if "meta tensor" not in str(vae_exc).lower():
            raise
        vae_model = AutoencoderKL.from_single_file(
            str(vae_path),
            config=str(vae_cfg_dir),
            torch_dtype=torch_dtype,
            local_files_only=True,
            low_cpu_mem_usage=False,
        )

    base_kwargs = {
        "config": str(local_config_path),
        "torch_dtype": torch_dtype,
        "local_files_only": True,
        "tokenizer": clip_tokenizer,
        "tokenizer_2": t5_tokenizer,
        "text_encoder": clip_model,
        "text_encoder_2": t5_model,
        "vae": vae_model,
    }

    try:
        return FluxPipeline.from_single_file(transformer_path, **base_kwargs)
    except Exception as flux_exc:
        if "meta tensor" not in str(flux_exc).lower():
            raise
        return FluxPipeline.from_single_file(
            transformer_path,
            low_cpu_mem_usage=False,
            **base_kwargs,
        )


def move_flux_pipe_to_device(pipe: Any, use_cuda: bool, use_cpu_offload: bool):
    device = "cuda" if use_cuda else "cpu"
    if use_cuda and use_cpu_offload:
        try:
            sys.stderr.write("[worker] FLUX device mode: enable_model_cpu_offload()\n")
            sys.stderr.flush()
            pipe.enable_model_cpu_offload()
            return pipe
        except Exception as offload_exc:
            sys.stderr.write(
                f"[worker] FLUX cpu offload unavailable, falling back to .to('{device}'): {offload_exc}\n"
            )
            sys.stderr.flush()
    return pipe.to(device)


def _validate_pipe_kwargs(pipe, kwargs: dict) -> dict:
    sig = inspect.signature(pipe.__call__)
    params = sig.parameters.values()

    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params):
        return kwargs

    supported = {p.name for p in params}
    unsupported = sorted(k for k in kwargs if k not in supported)
    if unsupported:
        raise TypeError(
            f"Installed FLUX pipeline does not accept kwargs: {', '.join(unsupported)}"
        )

    return kwargs


# ---------------------------------------------------------------------------
# Pipeline loader
# ---------------------------------------------------------------------------

def load_pipeline(
    model_path: str,
    configs_dir: Path,
    torch_module,
    use_cuda: bool,
    flux_dtype,
    use_cpu_offload: bool,
    enable_xformers: bool,
):
    from diffusers import AutoencoderKL, FluxPipeline

    model_path = resolve_flux_model_path(model_path, "flux")
    local_config, load_kwargs = build_flux_load_kwargs(configs_dir, flux_dtype)

    def _from_single_file_with_meta_retry(path_value, kwargs_value):
        try:
            return FluxPipeline.from_single_file(path_value, **kwargs_value)
        except Exception as first_exc:
            if "meta tensor" not in str(first_exc).lower():
                raise
            return FluxPipeline.from_single_file(path_value, low_cpu_mem_usage=False, **kwargs_value)

    if is_transformer_only_flux_checkpoint(model_path):
        pipe = load_flux_with_local_components(
            model_path, local_config, flux_dtype, FluxPipeline, AutoencoderKL
        )
    else:
        pipe = _from_single_file_with_meta_retry(model_path, load_kwargs)

    pipe = move_flux_pipe_to_device(pipe, use_cuda, use_cpu_offload)

    if enable_xformers:
        should_try_xformers = True
        skip_reason = None

        if not use_cuda:
            should_try_xformers = False
            skip_reason = "CUDA not available"
        else:
            try:
                major, minor = torch_module.cuda.get_device_capability(0)
                # Current xformers wheel in this environment does not support
                # Blackwell (sm_120) yet; avoid noisy runtime operator errors.
                if major >= 10:
                    should_try_xformers = False
                    skip_reason = (
                        f"GPU compute capability sm_{major}{minor} not supported by current xformers wheel"
                    )
            except Exception:
                # If capability probing fails, still attempt xformers.
                pass

        if should_try_xformers:
            try:
                pipe.enable_xformers_memory_efficient_attention()
                sys.stderr.write("[worker] FLUX xformers attention: enabled\n")
                sys.stderr.flush()
            except Exception as xf_exc:
                sys.stderr.write(
                    f"[worker] FLUX xformers attention: unavailable ({xf_exc})\n"
                )
                sys.stderr.flush()
        else:
            sys.stderr.write(
                f"[worker] FLUX xformers attention: skipped ({skip_reason})\n"
            )
            sys.stderr.flush()
    else:
        sys.stderr.write("[worker] FLUX xformers attention: disabled by config\n")
        sys.stderr.flush()

    return pipe


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def generate(pipe, payload: dict, torch_module) -> tuple:
    from lib.utils import apply_family_guidance_kwargs, can_use_cuda

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Missing required field: prompt")

    negative_prompt = str(payload.get("negative_prompt", "") or "")
    width = int(payload.get("width", 1024))
    height = int(payload.get("height", 1024))
    steps = int(payload.get("steps", 20))
    cfg = float(payload.get("cfg", 1.0))
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
    apply_family_guidance_kwargs("flux", kwargs, cfg, guidance, negative_prompt)
    kwargs = _validate_pipe_kwargs(pipe, kwargs)

    with torch_module.inference_mode():
        result = pipe(**kwargs)

    if not getattr(result, "images", None):
        raise RuntimeError("Pipeline did not return images.")

    return result.images[0], seed


# ---------------------------------------------------------------------------
# Standalone CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import time

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    from lib.utils import (
        can_use_cuda,
        describe_exception,
        log_cuda_fallback_once,
        log_selected_cuda_once,
        to_win_path,
    )

    parser = argparse.ArgumentParser(description="FLUX standalone generator")
    parser.add_argument("--model", required=True, help="Path to FLUX checkpoint")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--out-dir", default="outputs")
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--steps", type=int, default=20)
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

    _flux_dtype_env = (os.environ.get("FLUX_DTYPE", "fp16") or "fp16").strip().lower()
    flux_dtype = torch.float16 if use_cuda else torch.float32
    if use_cuda and _flux_dtype_env in ("bf16", "bfloat16"):
        flux_dtype = torch.bfloat16

    use_cpu_offload = os.environ.get("FLUX_USE_CPU_OFFLOAD", "0") == "1"
    enable_xformers = os.environ.get("FLUX_ENABLE_XFORMERS", "0") == "1"
    configs_dir = Path(__file__).resolve().parents[1] / "configs"

    model_path = to_win_path(args.model)
    started = time.time()

    try:
        pipe = load_pipeline(
            model_path,
            configs_dir,
            torch,
            use_cuda,
            flux_dtype,
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