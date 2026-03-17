"""FLUX via vendored Comfy modules.

Uses code vendored under `generator/lib/comfy_vendor/ComfyUI`.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from PIL import Image

import workflows.flux as base_flux

_COMFY = None
_SUPPRESSOR_INSTALLED = False


class _SuppressComfyClipProjectionWarning(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "clip missing: ['text_projection.weight']" not in msg


def _unwrap_node_output(value):
    if hasattr(value, "result"):
        result = value.result
        if result is None:
            return None
        return result[0] if isinstance(result, tuple) else result
    if isinstance(value, tuple):
        return value[0]
    return value


def _init_comfy_runtime():
    global _COMFY
    if _COMFY is not None:
        return _COMFY

    default_root = Path(__file__).resolve().parent / "comfy_vendor" / "ComfyUI"
    comfy_root = Path(os.environ.get("COMFYUI_ROOT", str(default_root))).expanduser()
    if not comfy_root.exists():
        raise RuntimeError(f"COMFYUI_ROOT not found: {comfy_root}")

    import sys

    comfy_root_str = str(comfy_root)
    if comfy_root_str not in sys.path:
        sys.path.insert(0, comfy_root_str)

    os.environ.setdefault("XFORMERS_FORCE_DISABLE_TRITON", "1")
    disable_xformers = os.environ.get("FLUX_CCR_DISABLE_XFORMERS", "1") == "1"
    # Force mmap enabled on Windows unless you want to test paging file errors
    disable_mmap = False
    disable_async_offload = os.environ.get(
        "COMFY_DISABLE_ASYNC_OFFLOAD",
        "1" if os.name == "nt" else "0",
    ) == "1"
    gpu_only = os.environ.get("COMFY_GPU_ONLY", "1") == "1"

    original_argv = list(sys.argv)
    argv = [original_argv[0]]
    if disable_xformers:
        argv.append("--disable-xformers")
    if disable_mmap:
        argv.append("--disable-mmap")
    if disable_async_offload:
        argv.append("--disable-async-offload")
    # if gpu_only:
    #     argv.append("--gpu-only")
    if len(argv) > 1:
        sys.argv = argv

    import comfy.options as comfy_options

    comfy_options.enable_args_parsing(True)

    import folder_paths
    import nodes
    import comfy.model_management as comfy_model_management
    import comfy.ldm.modules.attention as comfy_attention
    from comfy_extras.nodes_flux import CLIPTextEncodeFlux
    from comfy_extras.nodes_sd3 import EmptySD3LatentImage

    global _SUPPRESSOR_INSTALLED
    if not _SUPPRESSOR_INSTALLED:
        logging.getLogger().addFilter(_SuppressComfyClipProjectionWarning())
        _SUPPRESSOR_INSTALLED = True

    sys.argv = original_argv

    if disable_xformers:
        comfy_model_management.XFORMERS_IS_AVAILABLE = False
        comfy_model_management.XFORMERS_ENABLED_VAE = False
        if hasattr(comfy_attention, "attention_pytorch"):
            comfy_attention.optimized_attention = comfy_attention.attention_pytorch

    extra_model_paths = comfy_root / "extra_model_paths.yaml"
    if extra_model_paths.exists():
        import yaml

        with extra_model_paths.open("r", encoding="utf-8") as stream:
            config = yaml.safe_load(stream) or {}
        yaml_dir = extra_model_paths.parent
        for section in config.values():
            if not section:
                continue
            base_path = section.get("base_path")
            if base_path:
                base_path = os.path.expandvars(os.path.expanduser(base_path))
                if not os.path.isabs(base_path):
                    base_path = os.path.abspath(os.path.join(yaml_dir, base_path))
            for folder_key, folder_value in section.items():
                if folder_key in ("base_path", "is_default"):
                    continue
                for rel in str(folder_value).splitlines():
                    rel = rel.strip()
                    if not rel:
                        continue
                    full_path = rel
                    if base_path:
                        full_path = os.path.join(base_path, rel)
                    elif not os.path.isabs(full_path):
                        full_path = os.path.abspath(os.path.join(yaml_dir, rel))
                    folder_paths.add_model_folder_path(
                        folder_key,
                        os.path.normpath(full_path),
                    )

    _COMFY = {
        "folder_paths": folder_paths,
        "nodes": nodes,
        "CLIPTextEncodeFlux": CLIPTextEncodeFlux,
        "EmptySD3LatentImage": EmptySD3LatentImage,
    }
    return _COMFY


def resolve_flux_model_path(model_path: str, family: str) -> str:
    return base_flux.resolve_flux_model_path(model_path, family)


def _find_comfy_model_name(folder_paths, category: str, absolute_path: str) -> str | None:
    target = os.path.normcase(os.path.normpath(str(absolute_path)))
    for name in folder_paths.get_filename_list(category):
        full = folder_paths.get_full_path(category, name)
        if not full:
            continue
        full_norm = os.path.normcase(os.path.normpath(str(full)))
        if full_norm == target:
            return name
    return None


def _tensor_to_pil(first_image_tensor) -> Image.Image:
    img = first_image_tensor.detach().cpu().clamp(0, 1)
    arr = (img * 255).round().byte().numpy()
    return Image.fromarray(arr)


def _default_steps(payload: dict) -> int:
    if payload.get("steps") is not None:
        return int(payload.get("steps"))
    model_name = str(payload.get("model", "")).lower()
    return 4 if "schnell" in model_name else 20


def load_pipeline(
    model_path: str,
    configs_dir,
    torch_module,
    use_cuda: bool,
    flux_dtype,
    use_cpu_offload: bool,
    enable_xformers: bool,
):
    _ = (configs_dir, torch_module, use_cuda, flux_dtype, use_cpu_offload, enable_xformers)
    model_path = resolve_flux_model_path(model_path, "flux")
    comfy = _init_comfy_runtime()
    folder_paths = comfy["folder_paths"]
    nodes = comfy["nodes"]

    unet_name = _find_comfy_model_name(folder_paths, "diffusion_models", model_path)
    if not unet_name:
        raise RuntimeError(
            f"Comfy could not resolve model in diffusion_models: {model_path}"
        )

    clip_name = os.environ.get("FLUX_CCR_CLIP", "clip_l.safetensors")
    t5_name = os.environ.get("FLUX_CCR_T5", "t5xxl_fp16.safetensors")
    vae_name = os.environ.get("FLUX_CCR_VAE", "ae.safetensors")
    weight_dtype = os.environ.get("FLUX_CCR_WEIGHT_DTYPE", "default")
    clip_device = os.environ.get("FLUX_CCR_CLIP_DEVICE", "default")

    model = _unwrap_node_output(nodes.UNETLoader().load_unet(unet_name, weight_dtype))
    clip = _unwrap_node_output(
        nodes.DualCLIPLoader().load_clip(clip_name, t5_name, "flux", clip_device)
    )
    vae = _unwrap_node_output(nodes.VAELoader().load_vae(vae_name))

    return {
        "backend": "comfy_direct",
        "model": model,
        "clip": clip,
        "vae": vae,
    }


def generate(pipe, payload: dict, torch_module) -> tuple:
    _ = torch_module
    if not isinstance(pipe, dict) or pipe.get("backend") != "comfy_direct":
        raise RuntimeError("Invalid CCR pipeline bundle.")

    comfy = _init_comfy_runtime()
    nodes = comfy["nodes"]
    CLIPTextEncodeFlux = comfy["CLIPTextEncodeFlux"]
    EmptySD3LatentImage = comfy["EmptySD3LatentImage"]

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Missing required field: prompt")

    prompt_2 = str(payload.get("prompt_2", "") or "").strip() or prompt
    width = int(payload.get("width", 1024))
    height = int(payload.get("height", 1024))
    steps = _default_steps(payload)
    cfg = float(payload.get("cfg", 1.0))
    guidance = float(payload.get("guidance", 3.5))
    denoise = float(payload.get("denoise", 1.0))
    sampler_name = str(payload.get("sampler_name", "euler") or "euler")
    scheduler = str(payload.get("scheduler", "simple") or "simple")
    seed = payload.get("seed")

    if seed is None:
        import random

        seed = random.randint(1, 2_147_483_647)
    seed = int(seed)

    positive = _unwrap_node_output(
        CLIPTextEncodeFlux.execute(pipe["clip"], prompt, prompt_2, guidance)
    )
    negative = _unwrap_node_output(nodes.ConditioningZeroOut().zero_out(positive))
    latent = _unwrap_node_output(EmptySD3LatentImage.generate(width, height, 1))

    sampled = _unwrap_node_output(
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
    images = _unwrap_node_output(nodes.VAEDecode().decode(pipe["vae"], sampled))
    return _tensor_to_pil(images[0]), seed
