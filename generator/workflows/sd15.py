"""SD 1.5 generation workflow — usable standalone or via generate.py."""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path


def build_sd15_load_kwargs(torch_dtype) -> dict:
    comfy_yaml = Path("D:/comfy_models/configs/v1-inference.yaml")
    if not comfy_yaml.exists():
        raise RuntimeError(f"SD1.5 config not found at {comfy_yaml}")

    return {
        "original_config": str(comfy_yaml),
        "torch_dtype": torch_dtype,
    }


# ---------------------------------------------------------------------------
# Pipeline loader
# ---------------------------------------------------------------------------

def load_pipeline(model_path: str, torch_module, use_cuda: bool, enable_attn_slicing: bool):
    """Load an SD 1.5 pipeline and place it on the correct device."""
    from diffusers import StableDiffusionPipeline

    dtype = torch_module.float16 if use_cuda else torch_module.float32
    load_kwargs = build_sd15_load_kwargs(dtype)
    device = "cuda" if use_cuda else "cpu"

    try:
        pipe = StableDiffusionPipeline.from_single_file(model_path, **load_kwargs)
    except Exception as first_exc:
        if "meta tensor" not in str(first_exc).lower():
            raise
        pipe = StableDiffusionPipeline.from_single_file(model_path, low_cpu_mem_usage=False, **load_kwargs)

    pipe = pipe.to(device)

    if enable_attn_slicing:
        try:
            pipe.enable_attention_slicing()
        except Exception:
            pass

    try:
        pipe.enable_xformers_memory_efficient_attention()
    except Exception:
        pass

    return pipe


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def generate(pipe, payload: dict, torch_module) -> tuple:
    """Run SD 1.5 inference. Returns (PIL image, seed)."""
    from lib.utils import apply_family_guidance_kwargs, can_use_cuda

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Missing required field: prompt")

    negative_prompt = str(payload.get("negative_prompt", "") or "")
    width = int(payload.get("width", 512))
    height = int(payload.get("height", 512))
    steps = int(payload.get("steps", 20))
    cfg = float(payload.get("cfg", 7.0))
    guidance = float(payload.get("guidance", 3.5))
    seed = payload.get("seed")

    if seed is None:
        seed = random.randint(1, 2_147_483_647)
    seed = int(seed)

    use_cuda = can_use_cuda(torch_module)
    device = "cuda" if use_cuda else "cpu"
    generator = torch_module.Generator(device=device).manual_seed(seed)

    kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "generator": generator,
    }
    apply_family_guidance_kwargs("sd15", kwargs, cfg, guidance, negative_prompt)

    try:
        with torch_module.inference_mode():
            result = pipe(**kwargs)
    except TypeError:
        safe_kwargs = {"prompt": prompt, "num_inference_steps": steps, "generator": generator}
        with torch_module.inference_mode():
            result = pipe(**safe_kwargs)

    if not getattr(result, "images", None):
        raise RuntimeError("Pipeline did not return images.")

    return result.images[0], seed


# ---------------------------------------------------------------------------
# Standalone CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import time

    # Allow running as: python workflows/sd15.py ...
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    from lib.utils import (
        can_use_cuda,
        describe_exception,
        log_cuda_fallback_once,
        log_selected_cuda_once,
        to_win_path,
    )

    parser = argparse.ArgumentParser(description="SD 1.5 standalone generator")
    parser.add_argument("--model", required=True, help="Path to SD 1.5 checkpoint")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--out-dir", default="outputs")
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--cfg", type=float, default=7.0)
    parser.add_argument("--negative-prompt", default="")
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

    import os
    enable_attn_slicing = os.environ.get("ENABLE_ATTN_SLICING", "0") == "1"
    model_path = to_win_path(args.model)
    started = time.time()

    try:
        pipe = load_pipeline(model_path, torch, use_cuda, enable_attn_slicing)
        payload = {
            "prompt": args.prompt,
            "negative_prompt": args.negative_prompt,
            "width": args.width,
            "height": args.height,
            "steps": args.steps,
            "cfg": args.cfg,
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
        print(json.dumps({"ok": False, "error": describe_exception(exc), "trace": traceback.format_exc(limit=1)}))
        sys.exit(1)
