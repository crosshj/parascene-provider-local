# Hot path: prepare_noise, fix_empty_latent_channels (real); sample() still stub (needs full samplers).

from __future__ import annotations

import torch
import numpy as np
import comfy.model_management
import comfy.utils
import comfy.nested_tensor


def _prepare_noise_inner(latent_image, generator, noise_inds=None):
    if noise_inds is None:
        return torch.randn(
            latent_image.size(),
            dtype=latent_image.dtype,
            layout=latent_image.layout,
            generator=generator,
            device="cpu",
        )
    unique_inds, inverse = np.unique(noise_inds, return_inverse=True)
    noises = []
    for i in range(unique_inds[-1] + 1):
        noise = torch.randn(
            [1] + list(latent_image.size())[1:],
            dtype=latent_image.dtype,
            layout=latent_image.layout,
            generator=generator,
            device="cpu",
        )
        if i in unique_inds:
            noises.append(noise)
    noises = [noises[i] for i in inverse]
    return torch.cat(noises, axis=0)


def prepare_noise(latent_image, seed, noise_inds=None):
    generator = torch.manual_seed(seed)
    if getattr(latent_image, "is_nested", False):
        tensors = latent_image.unbind()
        noises = [_prepare_noise_inner(t, generator, noise_inds) for t in tensors]
        return comfy.nested_tensor.NestedTensor(noises)
    return _prepare_noise_inner(latent_image, generator, noise_inds)


def fix_empty_latent_channels(model, latent_image):
    """Stub: real impl in full vendor."""
    if getattr(latent_image, "is_nested", False):
        return latent_image
    latent_format = model.get_model_object("latent_format")
    if (
        latent_format.latent_channels != latent_image.shape[1]
        and torch.count_nonzero(latent_image) == 0
    ):
        latent_image = comfy.utils.repeat_to_batch_size(
            latent_image, latent_format.latent_channels, dim=1
        )
    if getattr(latent_format, "latent_dimensions", 2) == 3 and latent_image.ndim == 4:
        latent_image = latent_image.unsqueeze(2)
    return latent_image


def sample(
    model,
    noise,
    steps,
    cfg,
    sampler_name,
    scheduler,
    positive,
    negative,
    latent_image,
    denoise=1.0,
    disable_noise=False,
    start_step=None,
    last_step=None,
    force_full_denoise=False,
    noise_mask=None,
    sigmas=None,
    callback=None,
    disable_pbar=False,
    seed=None,
):
    raise NotImplementedError("comfy_vendor_slim: use full comfy_vendor for sample")
