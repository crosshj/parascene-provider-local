"""Z-Image generation workflow via vendored Comfy nodes.

This is intentionally shaped to mirror `generator/workflows/qwen.py`:
load a diffusion model + text encoder + VAE, then run:
CLIPTextEncode -> EmptyLatentImage -> KSampler -> VAEDecode.
"""

from __future__ import annotations

from contextlib import nullcontext
import os
import random
import sys
import time
from pathlib import Path

from lib.flux_comfy_vendored import _init_comfy_runtime, _find_comfy_model_name, _tensor_to_pil


def _node_result(value):
    # Comfy sometimes returns a wrapper with `.result`.
    if hasattr(value, "result"):
        result = value.result
        return () if result is None else result
    return value


def _unwrap_single_output(value):
    """
    Comfy node methods almost always return tuples of outputs.
    UNET/CLIP/VAE loaders commonly return `(obj,)`.
    """
    if isinstance(value, tuple) and len(value) == 1:
        return value[0]
    return value


def _log(msg: str) -> None:
    sys.stderr.write(f"[worker] z-image(comfy): {msg}\n")
    sys.stderr.flush()


def resolve_zimage_model_path(model_path: str, family: str) -> str:
    _ = family
    path = Path(model_path)
    if path.exists():
        return str(path)
    raise FileNotFoundError(f"Z-Image checkpoint not found: {path}")


def load_pipeline(
    model_path: str,
    configs_dir,
    torch_module,
    use_cuda: bool,
    zimage_dtype,
    use_cpu_offload: bool,
    enable_xformers: bool,
):
    _ = (
        configs_dir,
        torch_module,
        use_cuda,
        zimage_dtype,
        use_cpu_offload,
        enable_xformers,
    )

    model_path = resolve_zimage_model_path(model_path, "z-image")
    sys.stderr.write(f"[worker] z-image(comfy): init comfy runtime for {model_path}\n")
    sys.stderr.flush()

    comfy = _init_comfy_runtime()
    folder_paths = comfy["folder_paths"]
    nodes = comfy["nodes"]

    # Z-Image in Comfy is usually loaded as separate components:
    # `Load Diffusion Model` (UNet) + `Load CLIP` (text encoder) + `Load VAE`.
    # This mirrors the screenshot you provided.
    unet_name = _find_comfy_model_name(folder_paths, "diffusion_models", model_path)
    if not unet_name:
        raise RuntimeError(
            "Comfy could not resolve Z-Image model in `diffusion_models` "
            f"(model path: {model_path})."
        )

    sys.stderr.write(
        f"[worker] z-image(comfy): unet resolved to Comfy name {unet_name}\n"
    )
    sys.stderr.flush()

    # Hard-coded to match your Comfy workflow screenshot.
    # If you rename these files in Comfy's folders, update the names here.
    weight_dtype = "default"
    clip_name = "qwen_3_4b.safetensors"
    clip_type = "lumina2"
    vae_name = "ae.safetensors"

    model_loaded = _node_result(
        nodes.UNETLoader().load_unet(unet_name, weight_dtype)
    )
    clip_loaded = _node_result(
        nodes.CLIPLoader().load_clip(clip_name, clip_type)
    )
    vae_loaded = _node_result(nodes.VAELoader().load_vae(vae_name))

    model = _unwrap_single_output(model_loaded)
    clip = _unwrap_single_output(clip_loaded)
    vae = _unwrap_single_output(vae_loaded)

    return {"backend": "comfy_direct", "model": model, "clip": clip, "vae": vae}


def generate(pipe, payload: dict, torch_module) -> tuple:
    _ = torch_module
    if not isinstance(pipe, dict) or pipe.get("backend") not in ("comfy_checkpoint", "comfy_direct"):
        raise RuntimeError("Invalid z-image pipeline bundle.")

    comfy = _init_comfy_runtime()
    nodes = comfy["nodes"]

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Missing required field: prompt")

    negative_prompt = str(payload.get("negative_prompt", "") or "").strip()
    width = int(payload.get("width", 1024))
    height = int(payload.get("height", 1024))
    steps = int(payload.get("steps", 30))
    cfg = float(payload.get("cfg", 7.0))
    denoise = float(payload.get("denoise", 1.0))
    sampler_name = str(payload.get("sampler_name", "euler_ancestral") or "euler_ancestral")
    scheduler = str(payload.get("scheduler", "beta") or "beta")

    seed = payload.get("seed")
    if seed is None:
        seed = random.randint(1, 2_147_483_647)
    seed = int(seed)

    _log(
        "generate:start "
        f"seed={seed} size={width}x{height} steps={steps} cfg={cfg} "
        f"sampler={sampler_name} scheduler={scheduler}"
    )

    started = time.time()
    infer_ctx = (
        torch_module.inference_mode()
        if hasattr(torch_module, "inference_mode")
        else nullcontext()
    )

    with infer_ctx:
        t0 = time.time()
        positive = _node_result(nodes.CLIPTextEncode().encode(pipe["clip"], prompt))
        negative = _node_result(nodes.CLIPTextEncode().encode(pipe["clip"], negative_prompt))
        _log(f"stage:text-encode {int((time.time() - t0) * 1000)}ms")

        t0 = time.time()
        latent = _node_result(nodes.EmptyLatentImage().generate(width, height, 1))
        _log(f"stage:latent {int((time.time() - t0) * 1000)}ms")

        if isinstance(positive, tuple):
            positive = positive[0]
        if isinstance(negative, tuple):
            negative = negative[0]
        if isinstance(latent, tuple):
            latent = latent[0]

        t0 = time.time()
        sampled = _node_result(
            nodes.KSampler().sample(
                pipe["model"],
                seed,
                steps,
                cfg,
                sampler_name,
                scheduler,
                positive,
                negative,
                latent,
                denoise,
            )
        )
        _log(f"stage:sampler {int((time.time() - t0) * 1000)}ms")
        if isinstance(sampled, tuple):
            sampled = sampled[0]

        t0 = time.time()
        images = _node_result(nodes.VAEDecode().decode(pipe["vae"], sampled))
        _log(f"stage:vae-decode {int((time.time() - t0) * 1000)}ms")
        if isinstance(images, tuple):
            images = images[0]

    t0 = time.time()
    image = _tensor_to_pil(images[0])
    _log(f"stage:tensor-to-pil {int((time.time() - t0) * 1000)}ms")
    _log(f"generate:done total={int((time.time() - started) * 1000)}ms")
    return image, seed

