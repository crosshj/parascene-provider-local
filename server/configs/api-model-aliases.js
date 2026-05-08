"use strict";

/**
 * Image-to-video does not use model-registry scanning: clients send preset keys from
 * GET /api (`provider-api-config`). Each preset carries workflow id + Comfy loader hints.
 * Weight files must exist where Comfy expects them for the workflow JSON.
 */

const IMAGE2VIDEO_MODEL_PRESETS = {
  wan_i2v: {
    managedWorkflowId: "image2video-wan2_2_14B",
    family: "wan-i2v",
    loadKind: "diffusion_model",
    modelFile: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName:
      "wan\\wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    checkpointBasename: undefined,
  },
  ltx_i2v: {
    managedWorkflowId: "image2video-ltx2_3",
    family: "ltx-i2v",
    loadKind: "checkpoint",
    modelFile: "ltx-2.3-22b-dev-fp8.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "ltx",
    diffusionModelComfyName: null,
    checkpointBasename: "ltx-2.3-22b-dev-fp8.safetensors",
  },
};

function getImage2videoPreset(clientModelField) {
  const q = String(clientModelField || "").trim();
  return IMAGE2VIDEO_MODEL_PRESETS[q] ?? null;
}

/** Registry-shaped row for scheduler metadata (not from disk scan). */
function buildSyntheticImage2videoRegistryEntry(presetKey, preset) {
  return {
    modelId: `image2video:${presetKey}`,
    name: presetKey,
    file: preset.modelFile,
    family: preset.family,
    fullPath: preset.modelPath ?? "",
    loadKind: preset.loadKind,
    managedWorkflowId: preset.managedWorkflowId,
    comfyCheckpointGroup: preset.comfyCheckpointGroup ?? null,
    diffusionModelComfyName: preset.diffusionModelComfyName ?? null,
    defaults: {},
  };
}

module.exports = {
  IMAGE2VIDEO_MODEL_PRESETS,
  getImage2videoPreset,
  buildSyntheticImage2videoRegistryEntry,
};
