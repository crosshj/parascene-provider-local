"use strict";

const BASE_PROVIDER_CAPABILITIES = {
  status: "operational",
  methods: {
    text2img: {
      id: "text2img",
      default: true,
      async: true,
      name: "Text To Image",
      description: "Generate an image from text.",
      intent: "image_generate",
      credits: 0.1,
      fields: {
        model: {
          label: "Model",
          type: "select",
          required: true,
          options: [
            {
              label: "flux: flux1-dev",
              value: "diffusion_models/flux/flux1-dev.safetensors",
            },
            {
              label: "flux: flux1-dev-fp8",
              value: "checkpoints/FLUX1/flux1-dev-fp8.safetensors",
            },
            {
              label: "flux: flux1-dev-kontext_fp8_scaled",
              value:
                "diffusion_models/flux/flux1-dev-kontext_fp8_scaled.safetensors",
            },
            {
              label: "flux: flux1-krea-dev_fp8_scaled",
              value:
                "diffusion_models/flux/flux1-krea-dev_fp8_scaled.safetensors",
            },
            {
              label: "flux: flux1-schnell",
              value: "diffusion_models/flux/flux1-schnell.safetensors",
            },
            {
              label: "flux: flux1-schnell-fp8",
              value: "checkpoints/FLUX1/flux1-schnell-fp8.safetensors",
            },
            {
              label: "flux: getphatFLUXReality_v10FP8",
              value:
                "diffusion_models/flux/getphatFLUXReality_v10FP8.safetensors",
            },
            {
              label: "flux: getphatFLUXReality_v5HardcoreFP8",
              value:
                "diffusion_models/flux/getphatFLUXReality_v5HardcoreFP8.safetensors",
            },
            {
              label: "flux: real-dream-flux-1-fp8",
              value: "diffusion_models/flux/real-dream-flux-1-fp8.safetensors",
            },
            {
              label: "flux: STOIQOAfroditeFLUXXL_F1DAlpha",
              value:
                "diffusion_models/flux/STOIQOAfroditeFLUXXL_F1DAlpha.safetensors",
            },
            {
              label: "flux: STOIQONewrealityFLUXSD35_f1DAlphaTwo",
              value:
                "diffusion_models/flux/STOIQONewrealityFLUXSD35_f1DAlphaTwo.safetensors",
            },
            {
              label: "qwen: qwen_image_edit_fp8_e4m3fn",
              value:
                "diffusion_models/qwen/qwen_image_edit_fp8_e4m3fn.safetensors",
            },
            {
              label: "qwen: Qwen-Rapid-AIO-NSFW-v9",
              value: "checkpoints/qwen/Qwen-Rapid-AIO-NSFW-v9.safetensors",
            },
            {
              label: "sd15: cyberrealistic_v20",
              value: "checkpoints/1.5/cyberrealistic_v20.safetensors",
            },
            {
              label: "sd15: deliberate_v11",
              value: "checkpoints/1.5/deliberate_v11.safetensors",
            },
            {
              label: "sd15: dreamShaper_8_pruned",
              value: "checkpoints/1.5/dreamShaper_8_pruned.safetensors",
            },
            {
              label: "sd15: liberty_main",
              value: "checkpoints/1.5/liberty_main.safetensors",
            },
            {
              label: "sd15: lofi_V2pre",
              value: "checkpoints/1.5/lofi_V2pre.safetensors",
            },
            {
              label: "sd15: qgo10b_qgo10b",
              value: "checkpoints/1.5/qgo10b_qgo10b.safetensors",
            },
            {
              label: "sd15: realisticVisionV60B1_v60B1VAE",
              value:
                "checkpoints/1.5/realisticVisionV60B1_v60B1VAE.safetensors",
            },
            {
              label: "sd15: revAnimated_v122",
              value: "checkpoints/1.5/revAnimated_v122.safetensors",
            },
            {
              label: "sd15: rpg_v5",
              value: "checkpoints/1.5/rpg_v5.safetensors",
            },
            {
              label: "sd15: toonAme_version20",
              value: "checkpoints/1.5/toonAme_version20.safetensors",
            },
            {
              label: "sdxl: dreamshaperXL_turboDpmppSDE",
              value: "checkpoints/xl/dreamshaperXL_turboDpmppSDE.safetensors",
            },
            {
              label: "sdxl: illustriousXL20_v20",
              value: "checkpoints/xl/illustriousXL20_v20.safetensors",
            },
            {
              label: "sdxl: juggernautXL_v7Rundiffusion",
              value: "checkpoints/xl/juggernautXL_v7Rundiffusion.safetensors",
            },
            {
              label: "sdxl: juggernautXL_v9Rdphoto2Lightning",
              value:
                "checkpoints/xl/juggernautXL_v9Rdphoto2Lightning.safetensors",
            },
            {
              label: "sdxl: protovisionXLHighFidelity3D_releaseV660Bakedvae",
              value:
                "checkpoints/xl/protovisionXLHighFidelity3D_releaseV660Bakedvae.safetensors",
            },
            {
              label: "sdxl: realcartoonXL_v6",
              value: "checkpoints/xl/realcartoonXL_v6.safetensors",
            },
            {
              label: "sdxl: realDream_sdxlLightning1",
              value: "checkpoints/xl/realDream_sdxlLightning1.safetensors",
            },
            {
              label: "sdxl: sd_xl_base_1.0",
              value: "checkpoints/xl/sd_xl_base_1.0.safetensors",
            },
            {
              label: "sdxl: sd_xl_turbo_1.0_fp16",
              value: "checkpoints/xl/sd_xl_turbo_1.0_fp16.safetensors",
            },
            {
              label: "sdxl: zavychromaxl_v40",
              value: "checkpoints/xl/zavychromaxl_v40.safetensors",
            },
            {
              label: "z-image: z_image_turbo_bf16",
              value: "diffusion_models/z-image/z_image_turbo_bf16.safetensors",
            },
          ],
        },
        prompt: {
          label: "Prompt",
          type: "text",
          required: true,
        },
        seed: {
          label: "Seed",
          type: "number",
          required: false,
          min: 0,
          step: 1,
          description:
            "Optional deterministic seed. If not provided, a random seed is used.",
        },
      },
    },
    image2image: {
      id: "image2image",
      default: false,
      async: true,
      name: "Image To Image",
      description: "Generate an image from an input image and text.",
      intent: "image_mutate",
      credits: 0.1,
      fields: {
        model: {
          label: "Model",
          type: "select",
          required: true,
          options: [
            {
              label: "sdxl: dreamshaperXL_turboDpmppSDE",
              value: "checkpoints/xl/dreamshaperXL_turboDpmppSDE.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: illustriousXL20_v20",
              value: "checkpoints/xl/illustriousXL20_v20.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: juggernautXL_v7Rundiffusion",
              value: "checkpoints/xl/juggernautXL_v7Rundiffusion.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: juggernautXL_v9Rdphoto2Lightning",
              value:
                "checkpoints/xl/juggernautXL_v9Rdphoto2Lightning.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: protovisionXLHighFidelity3D_releaseV660Bakedvae",
              value:
                "checkpoints/xl/protovisionXLHighFidelity3D_releaseV660Bakedvae.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: realcartoonXL_v6",
              value: "checkpoints/xl/realcartoonXL_v6.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: realDream_sdxlLightning1",
              value: "checkpoints/xl/realDream_sdxlLightning1.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: sd_xl_base_1.0",
              value: "checkpoints/xl/sd_xl_base_1.0.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: sd_xl_turbo_1.0_fp16",
              value: "checkpoints/xl/sd_xl_turbo_1.0_fp16.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
            {
              label: "sdxl: zavychromaxl_v40",
              value: "checkpoints/xl/zavychromaxl_v40.safetensors",
              hint: "Supports single image input. Low censorship.",
            },
          ],
        },
        prompt: {
          label: "Prompt",
          type: "text",
          required: true,
        },
        input_images: {
          label: "Input Images",
          type: "image_url_array",
          required: false,
        },
        denoise: {
          label: "Denoise",
          type: "number",
          required: false,
          min: 0,
          max: 1,
          step: 0.01,
          description:
            "Strength of denoising. If not provided, SDXL models default to 0.65.",
        },
        seed: {
          label: "Seed",
          type: "number",
          required: false,
          min: 0,
          step: 1,
          description:
            "Optional deterministic seed. If not provided, a random seed is used.",
        },
      },
    },
  },
};

module.exports = {
  BASE_PROVIDER_CAPABILITIES,
};
