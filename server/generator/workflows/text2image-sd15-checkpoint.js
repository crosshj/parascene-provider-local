"use strict";

// Copy/paste base from Comfy "Save (API format)" JSON.
const WORKFLOW_TEMPLATE = {
  "6": {
    class_type: "CLIPTextEncode",
    inputs: {
      clip: ["30", 1],
      text: "",
    },
  },
  "30": {
    class_type: "CheckpointLoaderSimple",
    inputs: {
      ckpt_name: "dreamshaper_8.safetensors",
    },
  },
  "31": {
    class_type: "KSampler",
    inputs: {
      seed: 1119851866655636,
      steps: 30,
      cfg: 7,
      sampler_name: "dpmpp_2m",
      scheduler: "normal",
      denoise: 1,
      model: ["30", 0],
      positive: ["6", 0],
      negative: ["33", 0],
      latent_image: ["27", 0],
    },
  },
  "27": {
    class_type: "EmptyLatentImage",
    inputs: {
      width: 768,
      height: 768,
      batch_size: 1,
    },
  },
  "8": {
    class_type: "VAEDecode",
    inputs: {
      samples: ["31", 0],
      vae: ["30", 2],
    },
  },
  "9": {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: "ComfyUI",
      images: ["8", 0],
    },
  },
  "33": {
    class_type: "CLIPTextEncode",
    inputs: {
      text: "",
      clip: ["30", 1],
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

function Sd15Workflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  workflow["30"].inputs.ckpt_name = overrides.modelFile || workflow["30"].inputs.ckpt_name;
  workflow["6"].inputs.text = overrides.prompt || "";
  workflow["33"].inputs.text = overrides.negativePrompt || "";
  workflow["31"].inputs.seed = toPositiveInt(overrides.seed, workflow["31"].inputs.seed);
  workflow["31"].inputs.steps = toPositiveInt(overrides.steps, 30);
  workflow["31"].inputs.cfg = toNumber(overrides.cfg, 7.0);
  workflow["27"].inputs.width = toPositiveInt(overrides.width, 768);
  workflow["27"].inputs.height = toPositiveInt(overrides.height, 768);
  return workflow;
}

module.exports = Sd15Workflow;
