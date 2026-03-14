"""Clean-room FLUX CCR node-style helpers.

These helpers mimic the shape of the Comfy FLUX node graph without importing
Comfy modules.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import workflows.flux as base_flux


class FolderPaths:
    def __init__(self) -> None:
        models_base = Path(os.environ.get("MODELS_BASE", "D:/comfy_models")).expanduser()
        self._categories: dict[str, list[Path]] = {
            "diffusion_models": [
                models_base / "diffusion_models",
                models_base / "unet",
            ],
            "text_encoders": [models_base / "text_encoders"],
            "vae": [models_base / "vae"],
        }

    def _iter_files(self, root: Path) -> list[Path]:
        if not root.exists():
            return []
        out: list[Path] = []
        for p in root.rglob("*"):
            if p.is_file() and p.suffix.lower() in {".safetensors", ".pt", ".bin", ".ckpt"}:
                out.append(p)
        return out

    def get_filename_list(self, category: str) -> list[str]:
        paths = self._categories.get(category, [])
        names: list[str] = []
        seen = set()
        for root in paths:
            for p in self._iter_files(root):
                rel = p.relative_to(root).as_posix().replace("/", "\\")
                if rel.lower() in seen:
                    continue
                seen.add(rel.lower())
                names.append(rel)
        names.sort()
        return names

    def get_full_path(self, category: str, name: str) -> str | None:
        target_norm = name.replace("/", "\\").lower()
        for root in self._categories.get(category, []):
            full = root / name.replace("\\", "/")
            if full.exists():
                return str(full)
            # fallback: match by basename / normalized relpath
            for p in self._iter_files(root):
                rel = p.relative_to(root).as_posix().replace("/", "\\").lower()
                if rel == target_norm or p.name.lower() == target_norm:
                    return str(p)
        return None


class UNETLoader:
    def __init__(self, folder_paths: FolderPaths):
        self.folder_paths = folder_paths

    def load_unet(self, unet_name: str, weight_dtype: str = "default") -> dict[str, Any]:
        unet_path = self.folder_paths.get_full_path("diffusion_models", unet_name)
        if not unet_path:
            raise RuntimeError(f"UNet not found: {unet_name}")
        return {"unet_path": unet_path, "weight_dtype": weight_dtype}


class DualCLIPLoader:
    def __init__(self, folder_paths: FolderPaths):
        self.folder_paths = folder_paths

    def load_clip(
        self,
        clip_name1: str,
        clip_name2: str,
        clip_type: str,
        device: str = "default",
    ) -> dict[str, Any]:
        clip_1 = self.folder_paths.get_full_path("text_encoders", clip_name1)
        clip_2 = self.folder_paths.get_full_path("text_encoders", clip_name2)
        if not clip_1:
            raise RuntimeError(f"CLIP encoder not found: {clip_name1}")
        if not clip_2:
            raise RuntimeError(f"T5 encoder not found: {clip_name2}")
        return {
            "clip_path": clip_1,
            "t5_path": clip_2,
            "type": clip_type,
            "device": device,
        }


class VAELoader:
    def __init__(self, folder_paths: FolderPaths):
        self.folder_paths = folder_paths

    def load_vae(self, vae_name: str) -> dict[str, Any]:
        vae_path = self.folder_paths.get_full_path("vae", vae_name)
        if not vae_path:
            raise RuntimeError(f"VAE not found: {vae_name}")
        return {"vae_path": vae_path}


class CLIPTextEncodeFlux:
    @classmethod
    def execute(
        cls,
        clip: dict[str, Any],
        clip_l: str,
        t5xxl: str,
        guidance: float,
    ) -> dict[str, Any]:
        return {
            "clip": clip,
            "clip_l": clip_l,
            "t5xxl": t5xxl,
            "guidance": float(guidance),
        }


class ConditioningZeroOut:
    @classmethod
    def zero_out(cls, conditioning: dict[str, Any]) -> dict[str, Any]:
        return {"zeroed_from": conditioning}


class EmptySD3LatentImage:
    @classmethod
    def generate(cls, width: int, height: int, batch_size: int = 1) -> dict[str, Any]:
        return {
            "width": int(width),
            "height": int(height),
            "batch_size": int(batch_size),
        }


class KSampler:
    def __init__(
        self,
        *,
        configs_dir: Path,
        torch_module,
        use_cuda: bool,
        flux_dtype,
        use_cpu_offload: bool,
        enable_xformers: bool,
    ) -> None:
        self.configs_dir = configs_dir
        self.torch_module = torch_module
        self.use_cuda = use_cuda
        self.flux_dtype = flux_dtype
        self.use_cpu_offload = use_cpu_offload
        self.enable_xformers = enable_xformers
        self._pipe_cache: dict[str, Any] = {}

    def _with_env(self, key: str, value: str | None):
        old = os.environ.get(key)
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
        return old

    def _load_pipe(self, model: dict[str, Any], clip: dict[str, Any], vae: dict[str, Any]):
        cache_key = "|".join(
            [
                str(model.get("unet_path", "")),
                str(clip.get("clip_path", "")),
                str(clip.get("t5_path", "")),
                str(vae.get("vae_path", "")),
                str(self.flux_dtype),
                str(self.use_cuda),
                str(self.use_cpu_offload),
                str(self.enable_xformers),
            ]
        )
        if cache_key in self._pipe_cache:
            return self._pipe_cache[cache_key]

        old_clip = self._with_env("FLUX_CLIP_PATH", clip.get("clip_path"))
        old_t5 = self._with_env("FLUX_T5_PATH", clip.get("t5_path"))
        old_vae = self._with_env("FLUX_VAE_PATH", vae.get("vae_path"))
        try:
            pipe = base_flux.load_pipeline(
                model["unet_path"],
                self.configs_dir,
                self.torch_module,
                self.use_cuda,
                self.flux_dtype,
                self.use_cpu_offload,
                self.enable_xformers,
            )
        finally:
            self._with_env("FLUX_CLIP_PATH", old_clip)
            self._with_env("FLUX_T5_PATH", old_t5)
            self._with_env("FLUX_VAE_PATH", old_vae)

        self._pipe_cache[cache_key] = pipe
        return pipe

    def sample(
        self,
        model: dict[str, Any],
        seed: int,
        steps: int,
        cfg: float,
        sampler_name: str,
        scheduler: str,
        positive: dict[str, Any],
        negative: dict[str, Any],
        latent_image: dict[str, Any],
        denoise: float = 1.0,
    ) -> dict[str, Any]:
        _ = negative  # kept for API shape parity
        pipe = self._load_pipe(model, positive["clip"], model["vae"])

        generator = self.torch_module.Generator(
            device="cuda" if self.use_cuda else "cpu"
        ).manual_seed(int(seed))

        kwargs = {
            "prompt": positive["clip_l"],
            "prompt_2": positive["t5xxl"],
            "width": int(latent_image["width"]),
            "height": int(latent_image["height"]),
            "num_inference_steps": int(steps),
            "guidance_scale": float(positive.get("guidance", cfg)),
            "generator": generator,
            "denoise": float(denoise),
            "sampler_name": sampler_name,
            "scheduler": scheduler,
        }

        kwargs = base_flux._validate_pipe_kwargs(pipe, kwargs)

        with self.torch_module.inference_mode():
            result = pipe(**kwargs)

        return {"images": result.images}


class VAEDecode:
    @classmethod
    def decode(cls, vae: dict[str, Any], samples: dict[str, Any]):
        _ = vae  # API parity
        images = samples.get("images")
        if images is None:
            raise RuntimeError("Samples missing images.")
        return images
