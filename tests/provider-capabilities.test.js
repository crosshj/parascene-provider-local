/* eslint-env jest */

"use strict";

const {
  BASE_PROVIDER_CAPABILITIES,
} = require("../server/configs/provider-api-config.js");
const {
  IMAGE2IMAGE_MODEL_PRESETS,
} = require("../server/configs/api-model-aliases.js");
const { WORKFLOWS } = require("../server/workflows/_index.js");

describe("static provider image capabilities", () => {
  it.each([
    "diffusion_models/flux3/flux3-image-klein-base-int8-convrot.safetensors",
    "diffusion_models/qwen-image/qwen_image_2.1_int8_convrot.safetensors",
    "diffusion_models/moss/moss_image_sft_int8_convrot.safetensors",
  ])("advertises text-to-image model %s", (modelValue) => {
    const options =
      BASE_PROVIDER_CAPABILITIES.methods.text2image.fields.model.options;
    expect(options.some((option) => option.value === modelValue)).toBe(true);
  });

  it.each([
    ["flux3_klein_i2i", "image2image-flux3-klein"],
    ["qwen_image_2_1_i2i", "image2image-qwen-image-2_1"],
    ["qwen_image_2_1_turbo_i2i", "image2image-qwen-image-2_1_turbo"],
    ["moss_image_i2i", "image2image-moss-image"],
  ])(
    "advertises and resolves image-to-image model %s",
    (modelValue, workflowId) => {
      const options =
        BASE_PROVIDER_CAPABILITIES.methods.image2image.fields.model.options;
      expect(options.some((option) => option.value === modelValue)).toBe(true);
      expect(IMAGE2IMAGE_MODEL_PRESETS[modelValue].managedWorkflowId).toBe(
        workflowId,
      );
      expect(WORKFLOWS[workflowId]).toEqual(expect.any(Function));
    },
  );
});