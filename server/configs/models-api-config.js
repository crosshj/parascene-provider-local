"use strict";

const BASE_MODELS_RESPONSE = {
  ok: true,
  policy: {
    defaultManagedComfyFamilies: [],
  },
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
      },
    },
    image2image: {
      id: "image2image",
      async: false,
      name: "Image To Image",
      description: "Generate an image from an input image and text.",
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
        image_url: {
          label: "Image URL",
          type: "text",
          required: true,
        },
      },
    },
  },
};

module.exports = {
  BASE_MODELS_RESPONSE,
};

