"""Qwen Image generation workflow via vendored Comfy checkpoint loading."""

from __future__ import annotations

import os
import random
from pathlib import Path

from lib.flux_comfy_vendored import _init_comfy_runtime, _find_comfy_model_name, _tensor_to_pil


def _node_result(value):
    if hasattr(value, "result"):
        result = value.result
        return () if result is None else result
    return value


def resolve_qwen_model_path(model_path: str, family: str) -> str:
    _ = family
    path = Path(model_path)
    if path.exists():
        return str(path)
    raise FileNotFoundError(f"Qwen checkpoint not found: {path}")


# ---------------------------------------------------------------------------
# Pipeline loader
# ---------------------------------------------------------------------------


def load_pipeline(
    model_path: str,
    configs_dir,
    torch_module,
    use_cuda: bool,
    qwen_dtype,
    use_cpu_offload: bool,
    enable_xformers: bool,
):
    _ = (configs_dir, torch_module, use_cuda, qwen_dtype, use_cpu_offload, enable_xformers)
    model_path = resolve_qwen_model_path(model_path, "qwen")

    comfy = _init_comfy_runtime()
    folder_paths = comfy["folder_paths"]
    comfy_sd = comfy["comfy_sd"]

    ckpt_name = _find_comfy_model_name(folder_paths, "checkpoints", model_path)
    if not ckpt_name:
        raise RuntimeError(
            f"Comfy could not resolve model in checkpoints: {model_path}"
        )

    ckpt_path = folder_paths.get_full_path_or_raise("checkpoints", ckpt_name)

    model_options = {
        "dtype": qwen_dtype,
    }
    te_model_options = {
        "dtype": torch_module.float16,
        "load_device": torch_module.device("cpu"),
        "offload_device": torch_module.device("cpu"),
        "initial_device": torch_module.device("cpu"),
    }

    try:
        loaded = comfy_sd.load_checkpoint_guess_config(
            ckpt_path,
            output_vae=True,
            output_clip=True,
            output_clipvision=False,
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
            output_model=True,
            model_options=model_options,
            te_model_options=te_model_options,
        )
    except OSError as exc:
        message = str(exc).lower()
        if os.name == "nt" and ("os error 1455" in message or "paging file is too small" in message):
            raise RuntimeError(
                "Windows could not memory-map the Qwen checkpoint while loading it. "
                "The worker now disables safetensors mmap by default on Windows, but if the process was already running, restart the server/service and try again. "
                "If it still fails, increase the Windows paging file size or set COMFY_DISABLE_MMAP=1 explicitly for the service environment."
            ) from exc
        raise

    if not isinstance(loaded, tuple) or len(loaded) < 3:
        raise RuntimeError("Checkpoint loader did not return model, clip, vae.")

    model, clip, vae = loaded[:3]
    return {
        "backend": "comfy_checkpoint",
        "model": model,
        "clip": clip,
        "vae": vae,
    }


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def generate(pipe, payload: dict, torch_module) -> tuple:
    _ = torch_module
    if not isinstance(pipe, dict) or pipe.get("backend") != "comfy_checkpoint":
        raise RuntimeError("Invalid Qwen pipeline bundle.")

    comfy = _init_comfy_runtime()
    nodes = comfy["nodes"]

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Missing required field: prompt")

    negative_prompt = str(payload.get("negative_prompt", "") or "").strip()
    width = int(payload.get("width", 1024))
    height = int(payload.get("height", 1024))
    steps = int(payload.get("steps", 4))
    cfg = float(payload.get("cfg", 1.0))
    denoise = float(payload.get("denoise", 1.0))
    sampler_name = str(payload.get("sampler_name", "euler_ancestral") or "euler_ancestral")
    scheduler = str(payload.get("scheduler", "beta") or "beta")
    seed = payload.get("seed")

    if seed is None:
        seed = random.randint(1, 2_147_483_647)
    seed = int(seed)

    positive = _node_result(nodes.CLIPTextEncode().encode(pipe["clip"], prompt))
    negative = _node_result(nodes.CLIPTextEncode().encode(pipe["clip"], negative_prompt))
    latent = _node_result(nodes.EmptyLatentImage().generate(width, height, 1))

    if isinstance(positive, tuple):
        positive = positive[0]
    if isinstance(negative, tuple):
        negative = negative[0]
    if isinstance(latent, tuple):
        latent = latent[0]

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
    if isinstance(sampled, tuple):
        sampled = sampled[0]

    images = _node_result(nodes.VAEDecode().decode(pipe["vae"], sampled))
    if isinstance(images, tuple):
        images = images[0]
    return _tensor_to_pil(images[0]), seed
