# Hot path: load_torch_file (VAELoader, comfy.sd), repeat_to_batch_size (sample.fix_empty_latent_channels), PROGRESS_BAR_ENABLED (common_ksampler).
# Minimal implementation; no checkpoint_pickle, einops, etc.

from __future__ import annotations

import math
import torch

try:
    import safetensors.torch
except ImportError:
    safetensors = None

PROGRESS_BAR_ENABLED = True


def load_torch_file(ckpt, safe_load=False, device=None, return_metadata=False):
    if device is None:
        device = torch.device("cpu")
    metadata = None
    path_lower = ckpt.lower() if isinstance(ckpt, str) else ""
    if path_lower.endswith(".safetensors") or path_lower.endswith(".sft"):
        if safetensors is None:
            raise RuntimeError("safetensors required to load .safetensors files")
        with safetensors.safe_open(ckpt, framework="pt", device=device.type) as f:
            sd = {k: f.get_tensor(k) for k in f.keys()}
            if return_metadata:
                metadata = f.metadata()
    else:
        sd = torch.load(ckpt, map_location=device, weights_only=safe_load)
        if isinstance(sd, dict) and "state_dict" in sd:
            sd = sd["state_dict"]
        if return_metadata:
            metadata = {}
    if return_metadata:
        return sd, metadata
    return sd


def repeat_to_batch_size(tensor, batch_size, dim=0):
    if tensor.shape[dim] > batch_size:
        return tensor.narrow(dim, 0, batch_size)
    if tensor.shape[dim] < batch_size:
        repeats = [1] * tensor.dim()
        repeats[dim] = math.ceil(batch_size / tensor.shape[dim])
        return tensor.repeat(repeats).narrow(dim, 0, batch_size)
    return tensor
