"""FLUX test workflow for direct Comfy code reuse experiments.

Default mode (`FLUX_TEST_DIRECT_COMFY=1`) executes inference via ComfyUI node
classes imported from a local Comfy install.
"""

from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import Any

from PIL import Image
import yaml

import workflows.flux as base_flux

_COMFY = None


class _SuppressComfyClipProjectionWarning(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "clip missing: ['text_projection.weight']" not in msg


_SUPPRESSOR_INSTALLED = False


def _unwrap_node_output(value):
    # Comfy v3-style nodes return NodeOutput(args=...), legacy nodes return tuple.
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

    comfy_root = Path(
        os.environ.get("COMFYUI_ROOT", "C:/ComfyUI_windows_portable_2/ComfyUI")
    ).expanduser()
    if not comfy_root.exists():
        raise RuntimeError(f"COMFYUI_ROOT not found: {comfy_root}")

    import sys

    comfy_root_str = str(comfy_root)
    if comfy_root_str not in sys.path:
        sys.path.insert(0, comfy_root_str)

    os.environ.setdefault("XFORMERS_FORCE_DISABLE_TRITON", "1")
    disable_xformers = os.environ.get("FLUX_TEST_DISABLE_XFORMERS", "1") == "1"

    # Force Comfy to parse args in embedded mode so we can apply
    # --disable-xformers before its model management modules initialize.
    original_argv = list(sys.argv)
    if disable_xformers:
        sys.argv = [original_argv[0], "--disable-xformers"]

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

    # Restore argv for the host process after Comfy modules are loaded.
    sys.argv = original_argv

    if disable_xformers:
        comfy_model_management.XFORMERS_IS_AVAILABLE = False
        comfy_model_management.XFORMERS_ENABLED_VAE = False
        if hasattr(comfy_attention, "attention_pytorch"):
            comfy_attention.optimized_attention = comfy_attention.attention_pytorch

    extra_model_paths = comfy_root / "extra_model_paths.yaml"
    if extra_model_paths.exists():
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


def resolve_flux_model_path(model_path: str, family: str) -> str:
    return base_flux.resolve_flux_model_path(model_path, family)


def load_pipeline(
    model_path: str,
    configs_dir,
    torch_module,
    use_cuda: bool,
    flux_dtype,
    use_cpu_offload: bool,
    enable_xformers: bool,
):
    if os.environ.get("FLUX_TEST_DIRECT_COMFY", "1") != "1":
        return base_flux.load_pipeline(
            model_path,
            configs_dir,
            torch_module,
            use_cuda,
            flux_dtype,
            use_cpu_offload,
            enable_xformers,
        )

    model_path = resolve_flux_model_path(model_path, "flux")
    comfy = _init_comfy_runtime()
    folder_paths = comfy["folder_paths"]
    nodes = comfy["nodes"]

    unet_name = _find_comfy_model_name(folder_paths, "diffusion_models", model_path)
    if not unet_name:
        raise RuntimeError(
            f"Comfy could not resolve model in diffusion_models: {model_path}"
        )

    clip_name = os.environ.get("FLUX_COMFY_CLIP", "clip_l.safetensors")
    t5_name = os.environ.get("FLUX_COMFY_T5", "t5xxl_fp16.safetensors")
    vae_name = os.environ.get("FLUX_COMFY_VAE", "ae.safetensors")
    weight_dtype = os.environ.get("FLUX_COMFY_WEIGHT_DTYPE", "default")
    clip_device = os.environ.get("FLUX_COMFY_CLIP_DEVICE", "default")

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


def _default_steps(payload: dict) -> int:
    if payload.get("steps") is not None:
        return int(payload.get("steps"))

    model_name = str(payload.get("model", "")).lower()
    if "schnell" in model_name:
        return 4
    return 20


def generate(pipe, payload: dict, torch_module) -> tuple:
    """Comfy-direct or fallback FLUX generate path for testing."""
    from lib.utils import can_use_cuda

    if isinstance(pipe, dict) and pipe.get("backend") == "comfy_direct":
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
        negative = _unwrap_node_output(
            nodes.ConditioningZeroOut().zero_out(positive)
        )
        latent = _unwrap_node_output(
            EmptySD3LatentImage.generate(width, height, 1)
        )

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

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Missing required field: prompt")

    prompt_2 = str(payload.get("prompt_2", "") or "").strip() or prompt
    width = int(payload.get("width", 1024))
    height = int(payload.get("height", 1024))
    steps = _default_steps(payload)
    guidance = float(payload.get("guidance", payload.get("cfg", 1.0)))
    denoise = float(payload.get("denoise", 1.0))
    sampler_name = str(payload.get("sampler_name", "euler") or "euler")
    scheduler = str(payload.get("scheduler", "simple") or "simple")
    max_sequence_length = int(payload.get("max_sequence_length", 512))
    seed = payload.get("seed")

    if seed is None:
        import random

        seed = random.randint(1, 2_147_483_647)
    seed = int(seed)

    use_cuda = can_use_cuda(torch_module)
    generator = torch_module.Generator(
        device="cuda" if use_cuda else "cpu"
    ).manual_seed(seed)

    kwargs = {
        "prompt": prompt,
        "prompt_2": prompt_2,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "guidance_scale": guidance,
        "generator": generator,
        "max_sequence_length": max_sequence_length,
    }

    # Comfy-like controls (applied only if the installed pipeline supports them)
    if os.environ.get("FLUX_TEST_FORWARD_SAMPLER", "1") == "1":
        kwargs["sampler_name"] = sampler_name
        kwargs["scheduler"] = scheduler
    kwargs["denoise"] = denoise

    kwargs = base_flux._validate_pipe_kwargs(pipe, kwargs)

    with torch_module.inference_mode():
        result = pipe(**kwargs)

    if not getattr(result, "images", None):
        raise RuntimeError("Pipeline did not return images.")

    return result.images[0], seed
