"use strict";

const BASE_MODELS_RESPONSE = {
  ok: true,
  models: [], // filled dynamically from disk scan, includes defaults
  methods: {
    text2img: {
      id: "text2img",
      async: false,
      name: "Text To Image",
      description: "Generate an image from text.",
      intent: "image_generate",
      fields: {
        model: {
          label: "Model",
          type: "select",
          required: true,
          options: [], // filled in by server/handlers/models.js
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
      async: false,
      name: "Image To Image",
      description: "Generate an image from an input image and text.",
      intent: "image_mutate",
      fields: {
        model: {
          label: "Model",
          type: "select",
          required: true,
          options: [], // filled in by server/handlers/models.js
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
        image_url: {
          label: "Image URL",
          type: "text",
          required: true,
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
      },
    },
  },
};

module.exports = {
  BASE_MODELS_RESPONSE,
};
