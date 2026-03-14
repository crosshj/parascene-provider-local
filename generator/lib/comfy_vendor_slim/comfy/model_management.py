# Hot path only:
# - XFORMERS_IS_AVAILABLE / XFORMERS_ENABLED_VAE: flux_comfy_vendored._init_comfy_runtime() assigns these
#   when FLUX_CCR_DISABLE_XFORMERS=1 (so attention uses attention_pytorch).
# - intermediate_device(): called by EmptySD3LatentImage.generate() to create the empty latent tensor;
#   we use cpu since slim has no GPU/VRAM logic.

import torch

XFORMERS_IS_AVAILABLE = False
XFORMERS_ENABLED_VAE = False


def intermediate_device():
    return torch.device("cpu")
