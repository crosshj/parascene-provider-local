"use strict";

// Copy/paste base from Comfy "Save (API format)" JSON.
const WORKFLOW_TEMPLATE = {
  6: {
    class_type: "CLIPTextEncode",
    inputs: {
      clip: ["40", 0],
      text: "",
    },
  },
  30: {
    class_type: "CheckpointLoaderSimple",
    inputs: {
      ckpt_name: "FLUX1\\flux1-dev-fp8.safetensors",
    },
  },
  40: {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: "t5xxl_fp16.safetensors",
      type: "sd3",
    },
  },
  41: {
    class_type: "VAELoader",
    inputs: {
      vae_name: "ae.safetensors",
    },
  },
  31: {
    class_type: "KSampler",
    inputs: {
      seed: 1119851866655636,
      steps: 40,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "beta",
      denoise: 1,
      model: ["30", 0],
      positive: ["35", 0],
      negative: ["33", 0],
      latent_image: ["27", 0],
    },
  },
  35: {
    class_type: "FluxGuidance",
    inputs: {
      guidance: 3.5,
      conditioning: ["6", 0],
    },
  },
  27: {
    class_type: "EmptySD3LatentImage",
    inputs: {
      width: 1024,
      height: 1024,
      batch_size: 1,
    },
  },
  8: {
    class_type: "VAEDecode",
    inputs: {
      samples: ["31", 0],
      vae: ["41", 0],
    },
  },
  9: {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: "ComfyUI",
      images: ["8", 0],
    },
  },
  33: {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "",
      clip: ["40", 0],
    },
  },
};

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

function FluxWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  if (overrides.modelFile) {
    workflow["30"].inputs.ckpt_name = "FLUX1\\" + overrides.modelFile;
  }
  workflow["6"].inputs.text = overrides.prompt || "";
  workflow["33"].inputs.text = overrides.negativePrompt || "";
  workflow["31"].inputs.seed = toPositiveInt(
    overrides.seed,
    workflow["31"].inputs.seed,
  );
  workflow["31"].inputs.steps = toPositiveInt(overrides.steps, 20);
  workflow["31"].inputs.cfg = toNumber(overrides.cfg, 1.0);
  workflow["27"].inputs.width = toPositiveInt(overrides.width, 1024);
  workflow["27"].inputs.height = toPositiveInt(overrides.height, 1024);
  return workflow;
}

module.exports = FluxWorkflow;
