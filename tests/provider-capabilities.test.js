/* eslint-env jest */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  BASE_PROVIDER_CAPABILITIES,
} = require("../server/configs/provider-api-config.js");
const {
  IMAGE2IMAGE_MODEL_PRESETS,
} = require("../server/configs/api-model-aliases.js");
const { WORKFLOWS } = require("../server/workflows/_index.js");

describe("static provider image capabilities", () => {
  it.each([
    [
      "diffusion_models/flux3-image-klein-base-int8-convrot.safetensors",
      "flux3-image-klein-base-int8-convrot.safetensors",
      "text2image-flux3-klein",
    ],
    [
      "diffusion_models/qwen_image_2.1_int8_convrot.safetensors",
      "qwen_image_2.1_int8_convrot.safetensors",
      "text2image-qwen-image-2_1",
    ],
    [
      "diffusion_models/moss_image_sft_int8_convrot.safetensors",
      "moss_image_sft_int8_convrot.safetensors",
      "text2image-moss-image",
    ],
  ])("advertises text-to-image model %s", (modelValue) => {
    const options =
      BASE_PROVIDER_CAPABILITIES.methods.text2image.fields.model.options;
    expect(options.some((option) => option.value === modelValue)).toBe(true);
  });

  it("resolves root-level diffusion models to their managed workflows", () => {
    const modelsBase = fs.mkdtempSync(path.join(os.tmpdir(), "model-registry-"));
    const diffusionDir = path.join(modelsBase, "diffusion_models");
    fs.mkdirSync(diffusionDir);
    const modelFiles = [
      [
        "flux3-image-klein-base-int8-convrot.safetensors",
        "text2image-flux3-klein",
      ],
      ["qwen_image_2.1_int8_convrot.safetensors", "text2image-qwen-image-2_1"],
      ["moss_image_sft_int8_convrot.safetensors", "text2image-moss-image"],
    ];
    const previousModelsBase = process.env.MODELS_BASE;

    try {
      for (const [file] of modelFiles) {
        fs.writeFileSync(path.join(diffusionDir, file), "");
      }
      process.env.MODELS_BASE = modelsBase;

      jest.isolateModules(() => {
        const { getModels } = require("../server/lib/model-registry.js");
        const models = getModels();
        for (const [file, workflowId] of modelFiles) {
          const entry = models.find(
            (model) => model.modelId === `diffusion_models/${file}`,
          );
          expect(entry).toBeDefined();
          expect(entry.managedWorkflowId).toBe(workflowId);
        }
      });
    } finally {
      if (previousModelsBase === undefined) {
        delete process.env.MODELS_BASE;
      } else {
        process.env.MODELS_BASE = previousModelsBase;
      }
      fs.rmSync(modelsBase, { recursive: true, force: true });
    }
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