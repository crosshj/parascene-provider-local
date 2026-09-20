# Minimal LTX-2.5 text-to-audio nodes.
# Core Comfy 0.36 already ships the rest of the LTX audio graph; the full
# ComfyUI-LTXVideo pack overlaps those nodes and fails to load here.
# These three class names match the official T2A workflow.

import torch
import comfy.model_management
from comfy.model_patcher import ModelPatcher


class LTXVAudioOnlyModel:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": (
                    "MODEL",
                    {
                        "tooltip": "The LTX-2 audio/video model to run in audio-only mode."
                    },
                ),
            }
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "patch"
    CATEGORY = "lightricks/audio"
    DESCRIPTION = (
        "Run the LTX-2 audio/video model in audio-only mode for text-to-audio. "
        "Sets run_vx / a2v_cross_attn / v2a_cross_attn off (honored by core av_model.py)."
    )

    def patch(self, model: ModelPatcher):
        new_model = model.clone()
        transformer_options = new_model.model_options.setdefault(
            "transformer_options", {}
        )
        transformer_options["run_vx"] = False
        transformer_options["a2v_cross_attn"] = False
        transformer_options["v2a_cross_attn"] = False
        return (new_model,)


class LTXVAudioOnlyEmptyVideoLatent:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "generate"
    CATEGORY = "lightricks/audio"
    DESCRIPTION = (
        "Fixed 64x64 single-frame placeholder video latent for audio-only T2A. "
        "Join with the audio latent via LTXVConcatAVLatent."
    )

    def generate(self):
        # LTX-2 video latent: (batch, 128 channels, frames, H/32, W/32)
        # 64x64 -> (1, 128, 1, 2, 2)
        latent = torch.zeros(
            [1, 128, 1, 2, 2],
            device=comfy.model_management.intermediate_device(),
        )
        return ({"samples": latent},)


class LTXFloatToInt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "a": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "tooltip": (
                            "Value to convert. Rounded with Python round() "
                            "(ties to even), then returned as INT."
                        ),
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("INT",)
    FUNCTION = "op"
    CATEGORY = "math/conversion"
    DESCRIPTION = (
        "Round a float to int (fps -> frames helpers in LTX T2A). "
        "No clamp; out-of-range values pass through as the rounded integer."
    )

    def op(self, a):
        return (round(a),)


NODE_CLASS_MAPPINGS = {
    "LTXVAudioOnlyModel": LTXVAudioOnlyModel,
    "LTXVAudioOnlyEmptyVideoLatent": LTXVAudioOnlyEmptyVideoLatent,
    "LTXFloatToInt": LTXFloatToInt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LTXVAudioOnlyModel": "LTXV Audio Only Model",
    "LTXVAudioOnlyEmptyVideoLatent": "LTXV Audio Only Empty Video Latent",
    "LTXFloatToInt": "LTX Float To Int",
}
