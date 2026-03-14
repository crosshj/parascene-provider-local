# Stub: hot path uses load_diffusion_model, load_clip, VAE, CLIPType.
# Full implementation lives in comfy_vendor; slim stub allows nodes to import and define the hot path.

from __future__ import annotations

from enum import Enum
import torch


class CLIPType(Enum):
    """Hot path: workflow only calls load_clip(..., type='flux')."""
    FLUX = 6


class VAE:
    """Stub: real VAE in full vendor. decode() and throw_exception_if_invalid() for node interface."""

    def __init__(self, sd=None, device=None, config=None, dtype=None, metadata=None):
        self._sd = sd

    def decode(self, samples):
        raise NotImplementedError("comfy_vendor_slim: use full comfy_vendor for VAE.decode")

    def throw_exception_if_invalid(self):
        pass


def load_diffusion_model(unet_path, model_options=None):
    if model_options is None:
        model_options = {}
    raise NotImplementedError("comfy_vendor_slim: use full comfy_vendor for load_diffusion_model")


def load_clip(ckpt_paths, embedding_directory=None, clip_type=CLIPType.FLUX, model_options=None):
    if model_options is None:
        model_options = {}
    raise NotImplementedError("comfy_vendor_slim: use full comfy_vendor for load_clip")
