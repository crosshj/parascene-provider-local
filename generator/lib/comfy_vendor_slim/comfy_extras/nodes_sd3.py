# Hot path: EmptySD3LatentImage.generate(width, height, batch_size).
# Real implementation; only needs torch and comfy.model_management.intermediate_device.
# Workflow always calls with batch_size=1.

import torch
import comfy.model_management


class EmptySD3LatentImage:
    @classmethod
    def execute(cls, width, height, batch_size=1):
        latent = torch.zeros(
            [batch_size, 16, height // 8, width // 8],
            device=comfy.model_management.intermediate_device(),
        )
        return ({"samples": latent},)

    generate = execute
