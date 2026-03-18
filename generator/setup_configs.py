#!/usr/bin/env python3
"""
One-time local config setup for the image generation service.

Creates generator/configs/<family>/ directories that diffusers needs to identify
model architecture when loading from local .safetensors files.

Nothing from the gated FLUX repo is downloaded. Weights always come from your
local D:/comfy_models files. Only the T5 tokenizer vocab (~800 KB) is fetched
from google-t5/t5-base, which is a public non-gated Google model.

Run once:
    .venv/Scripts/python setup_configs.py
"""

import json
import os
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CONFIGS = SCRIPT_DIR / "configs"


# ---------------------------------------------------------------------------
# Z-Image config
# ---------------------------------------------------------------------------
def setup_zimage() -> None:
    out = CONFIGS / "z-image"
    out.mkdir(parents=True, exist_ok=True)
    print("\n[z-image] writing pipeline configs...")

    write_json(
        out / "model_index.json",
        {
            "_class_name": "ZImageDiffusionPipeline",
            "_diffusers_version": "0.30.0",
            "model_path": str(
                Path("D:/comfy_models/diffusion_models/z-image")
            ),
            "scheduler": ["diffusers", "EulerDiscreteScheduler"],
            "text_encoder": ["transformers", "CLIPTextModel"],
            "tokenizer": ["transformers", "CLIPTokenizer"],
            "unet": ["diffusers", "UNet2DConditionModel"],
            "vae": ["diffusers", "AutoencoderKL"]
        },
    )

    print("[z-image] done.")
# Helpers
# ---------------------------------------------------------------------------

def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))
    print(f"  wrote {path.relative_to(SCRIPT_DIR)}")


def find_hf_snapshot(repo_slug: str, required_file: str) -> Path | None:
    """Return the first snapshot dir that contains required_file."""
    base = (
        Path.home()
        / ".cache"
        / "huggingface"
        / "hub"
        / repo_slug
        / "snapshots"
    )
    if not base.exists():
        return None
    for snap in base.iterdir():
        if (snap / required_file).exists():
            return snap
    return None


# ---------------------------------------------------------------------------
# FLUX config
# ---------------------------------------------------------------------------

def setup_flux() -> None:
    out = CONFIGS / "flux"
    out.mkdir(parents=True, exist_ok=True)
    print("\n[flux] writing pipeline configs...")

    write_json(
        out / "model_index.json",
        {
            "_class_name": "FluxPipeline",
            "_diffusers_version": "0.30.0",
            "scheduler": ["diffusers", "FlowMatchEulerDiscreteScheduler"],
            "text_encoder": ["transformers", "CLIPTextModel"],
            "text_encoder_2": ["transformers", "T5EncoderModel"],
            "tokenizer": ["transformers", "CLIPTokenizer"],
            "tokenizer_2": ["transformers", "T5TokenizerFast"],
            "transformer": ["diffusers", "FluxTransformer2DModel"],
            "vae": ["diffusers", "AutoencoderKL"],
        },
    )

    # text_encoder — CLIP-L (matches comfy_models/text_encoders/clip_l.safetensors)
    write_json(
        out / "text_encoder" / "config.json",
        {
            "_name_or_path": "openai/clip-vit-large-patch14",
            "architectures": ["CLIPTextModel"],
            "attention_dropout": 0.0,
            "bos_token_id": 0,
            "dropout": 0.0,
            "eos_token_id": 49407,
            "hidden_act": "quick_gelu",
            "hidden_size": 768,
            "initializer_factor": 1.0,
            "initializer_range": 0.02,
            "intermediate_size": 3072,
            "layer_norm_eps": 1e-05,
            "max_position_embeddings": 77,
            "model_type": "clip_text_model",
            "num_attention_heads": 12,
            "num_hidden_layers": 12,
            "pad_token_id": 1,
            "projection_dim": 768,
            "torch_dtype": "float32",
            "transformers_version": "4.40.0",
            "vocab_size": 49408,
        },
    )

    # text_encoder_2 — T5-XXL (matches comfy_models/text_encoders/t5xxl_fp16.safetensors)
    write_json(
        out / "text_encoder_2" / "config.json",
        {
            "architectures": ["T5EncoderModel"],
            "d_ff": 10240,
            "d_kv": 64,
            "d_model": 4096,
            "decoder_start_token_id": 0,
            "dropout_rate": 0.1,
            "eos_token_id": 1,
            "dense_act_fn": "gelu_pytorch_tanh",
            "initializer_factor": 1.0,
            "is_encoder_decoder": True,
            "is_gated_act": True,
            "layer_norm_epsilon": 1e-06,
            "model_type": "t5",
            "num_decoder_layers": 24,
            "num_heads": 64,
            "num_layers": 24,
            "output_past": True,
            "pad_token_id": 0,
            "relative_attention_num_buckets": 32,
            "tie_word_embeddings": False,
            "vocab_size": 32128,
        },
    )

    write_json(
        out / "scheduler" / "scheduler_config.json",
        {
            "_class_name": "FlowMatchEulerDiscreteScheduler",
            "_diffusers_version": "0.30.0",
            "base_image_seq_len": 256,
            "base_shift": 0.5,
            "invert_sigmas": False,
            "max_image_seq_len": 4096,
            "max_shift": 1.15,
            "num_train_timesteps": 1000,
            "shift": 3.0,
            "use_dynamic_shifting": True,
        },
    )

    # transformer config (FLUX.1 dev/schnell architecture)
    write_json(
        out / "transformer" / "config.json",
        {
            "_class_name": "FluxTransformer2DModel",
            "_diffusers_version": "0.30.0",
            "attention_head_dim": 128,
            "guidance_embeds": True,
            "in_channels": 64,
            "joint_attention_dim": 4096,
            "num_attention_heads": 24,
            "num_layers": 19,
            "num_single_layers": 38,
            "patch_size": 1,
            "pooled_projection_dim": 768,
            "axes_dims_rope": [16, 56, 56],
        },
    )

    # VAE config used by FLUX autoencoder (ae.safetensors)
    write_json(
        out / "vae" / "config.json",
        {
            "_class_name": "AutoencoderKL",
            "_diffusers_version": "0.30.0",
            "act_fn": "silu",
            "block_out_channels": [128, 256, 512, 512],
            "down_block_types": [
                "DownEncoderBlock2D",
                "DownEncoderBlock2D",
                "DownEncoderBlock2D",
                "DownEncoderBlock2D",
            ],
            "up_block_types": [
                "UpDecoderBlock2D",
                "UpDecoderBlock2D",
                "UpDecoderBlock2D",
                "UpDecoderBlock2D",
            ],
            "in_channels": 3,
            "out_channels": 3,
            "latent_channels": 16,
            "layers_per_block": 2,
            "sample_size": 1024,
            "scaling_factor": 0.3611,
            "shift_factor": 0.1159,
        },
    )

    # CLIP tokenizer — already cached locally from openai/clip-vit-large-patch14
    tok1_dst = out / "tokenizer"
    if (tok1_dst / "vocab.json").exists():
        print("  tokenizer (CLIP) already in place, skipping")
    else:
        slug = "models--openai--clip-vit-large-patch14"
        snap = find_hf_snapshot(slug, "vocab.json")
        if snap is None:
            raise RuntimeError(
                "CLIP tokenizer not found in HF cache. "
                "Run once with internet to cache it:\n"
                "  python -c \"from transformers import CLIPTokenizer; "
                "CLIPTokenizer.from_pretrained('openai/clip-vit-large-patch14')\""
            )
        tok1_dst.mkdir(parents=True, exist_ok=True)
        for fname in ("vocab.json", "merges.txt", "tokenizer_config.json", "special_tokens_map.json"):
            src = snap / fname
            if src.exists():
                shutil.copy2(src, tok1_dst / fname)
                print(f"  copied tokenizer/{fname} from HF cache")

    # T5 tokenizer — download from google-t5/t5-base (public, not gated, ~800 KB)
    tok2_dst = out / "tokenizer_2"
    if (tok2_dst / "spiece.model").exists():
        print("  tokenizer_2 (T5) already in place, skipping")
    else:
        print("  downloading T5 tokenizer from google-t5/t5-base (public, ~800 KB)...")
        from transformers import T5TokenizerFast
        tokenizer = T5TokenizerFast.from_pretrained("google-t5/t5-base")
        tokenizer.save_pretrained(str(tok2_dst))
        print(f"  T5 tokenizer saved to configs/flux/tokenizer_2/")

    print("[flux] done.")


# ---------------------------------------------------------------------------
# SDXL config
# ---------------------------------------------------------------------------

def setup_sdxl() -> None:
    out = CONFIGS / "sdxl"
    out.mkdir(parents=True, exist_ok=True)
    print("\n[sdxl] writing pipeline configs...")

    write_json(
        out / "model_index.json",
        {
            "_class_name": "StableDiffusionXLPipeline",
            "_diffusers_version": "0.30.0",
            "force_zeros_for_empty_prompt": True,
            "scheduler": ["diffusers", "EulerDiscreteScheduler"],
            "text_encoder": ["transformers", "CLIPTextModel"],
            "text_encoder_2": ["transformers", "CLIPTextModelWithProjection"],
            "tokenizer": ["transformers", "CLIPTokenizer"],
            "tokenizer_2": ["transformers", "CLIPTokenizer"],
            "unet": ["diffusers", "UNet2DConditionModel"],
            "vae": ["diffusers", "AutoencoderKL"],
        },
    )

    # text_encoder — CLIP-L (openai/clip-vit-large-patch14 architecture)
    write_json(
        out / "text_encoder" / "config.json",
        {
            "architectures": ["CLIPTextModel"],
            "attention_dropout": 0.0,
            "bos_token_id": 49406,
            "dropout": 0.0,
            "eos_token_id": 49407,
            "hidden_act": "quick_gelu",
            "hidden_size": 768,
            "initializer_factor": 1.0,
            "initializer_range": 0.02,
            "intermediate_size": 3072,
            "layer_norm_eps": 1e-05,
            "max_position_embeddings": 77,
            "model_type": "clip_text_model",
            "num_attention_heads": 12,
            "num_hidden_layers": 12,
            "pad_token_id": 1,
            "projection_dim": 768,
            "torch_dtype": "float32",
            "transformers_version": "4.40.0",
            "vocab_size": 49408,
        },
    )

    # text_encoder_2 — OpenCLIP ViT-bigG (SDXL second text encoder)
    write_json(
        out / "text_encoder_2" / "config.json",
        {
            "architectures": ["CLIPTextModelWithProjection"],
            "attention_dropout": 0.0,
            "bos_token_id": 49406,
            "dropout": 0.0,
            "eos_token_id": 49407,
            "hidden_act": "gelu",
            "hidden_size": 1280,
            "initializer_factor": 1.0,
            "initializer_range": 0.02,
            "intermediate_size": 5120,
            "layer_norm_eps": 1e-05,
            "max_position_embeddings": 77,
            "model_type": "clip_text_model",
            "num_attention_heads": 20,
            "num_hidden_layers": 32,
            "pad_token_id": 1,
            "projection_dim": 1280,
            "torch_dtype": "float32",
            "transformers_version": "4.40.0",
            "vocab_size": 49408,
        },
    )

    write_json(
        out / "scheduler" / "scheduler_config.json",
        {
            "_class_name": "EulerDiscreteScheduler",
            "_diffusers_version": "0.21.0",
            "beta_end": 0.012,
            "beta_schedule": "scaled_linear",
            "beta_start": 0.00085,
            "interpolation_type": "linear",
            "num_train_timesteps": 1000,
            "prediction_type": "epsilon",
            "sigma_max": None,
            "sigma_min": None,
            "steps_offset": 1,
            "timestep_spacing": "leading",
            "timestep_type": "discrete",
            "trained_betas": None,
            "use_karras_sigmas": False,
        },
    )

    # SDXL uses two CLIP tokenizers — both are the same openai/clip-vit-large-patch14
    tok1_dst = out / "tokenizer"
    tok2_dst = out / "tokenizer_2"
    if (tok1_dst / "vocab.json").exists():
        print("  tokenizer already in place, skipping")
    else:
        slug = "models--openai--clip-vit-large-patch14"
        snap = find_hf_snapshot(slug, "vocab.json")
        if snap is None:
            raise RuntimeError("CLIP tokenizer not found in HF cache — run flux setup first.")
        for dst in (tok1_dst, tok2_dst):
            dst.mkdir(parents=True, exist_ok=True)
            for fname in ("vocab.json", "merges.txt", "tokenizer_config.json", "special_tokens_map.json"):
                src = snap / fname
                if src.exists():
                    shutil.copy2(src, dst / fname)
        print("  tokenizers (CLIP x2) copied from HF cache")

    print("[sdxl] done.")


# ---------------------------------------------------------------------------
# SD1.5 — uses local yaml config from comfy_models/configs
# ---------------------------------------------------------------------------

def setup_sd15() -> None:
    out = CONFIGS / "sd15"
    out.mkdir(parents=True, exist_ok=True)
    print("\n[sd15] writing pipeline configs...")

    # SD1.5 uses original_config (yaml), point at the one already in comfy_models
    comfy_yaml = Path("D:/comfy_models/configs/v1-inference.yaml")
    ref = {"original_config_yaml": str(comfy_yaml)} if comfy_yaml.exists() else {}
    write_json(out / "meta.json", ref)
    print(f"  yaml config reference: {comfy_yaml}")

    print("[sd15] done.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"Writing configs to: {CONFIGS}")
    setup_flux()
    setup_sdxl()
    setup_sd15()
    setup_zimage()
    print("\nAll configs ready. Restart the server — no HF network access needed during generation.")
