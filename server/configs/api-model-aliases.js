"use strict";

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

/** Fixed-model image2image presets (no registry scan). SDXL uses checkpoint paths below. */
const IMAGE2IMAGE_MODEL_PRESETS = {
  flux_kontext_i2i: {
    managedWorkflowId: "image2image-flux-kontext",
    family: "flux-i2i",
    loadKind: "diffusion_model",
    modelFile: "flux1-dev-kontext_fp8_scaled.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: null,
  },
  qwen_edit_i2i: {
    managedWorkflowId: "image2image-qwen-edit-4step",
    family: "qwen-i2i",
    loadKind: "diffusion_model",
    modelFile: "qwen_image_edit_fp8_e4m3fn.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: null,
  },
  qwen_rapid_i2i: {
    managedWorkflowId: "image2image-qwen-rapid-aio",
    family: "qwen-i2i",
    loadKind: "checkpoint",
    modelFile: "Qwen-Rapid-AIO-NSFW-v9.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "qwen",
    diffusionModelComfyName: null,
  },
  omnigen2_edit_i2i: {
    managedWorkflowId: "image2image-omnigen2-edit",
    family: "omnigen2-i2i",
    loadKind: "diffusion_model",
    modelFile: "omnigen2_fp16.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: null,
  },
};

function getImage2videoPreset(clientModelField) {
  const q = String(clientModelField || "").trim();
  return IMAGE2VIDEO_MODEL_PRESETS[q] ?? null;
}

function getImage2imagePreset(clientModelField) {
  const q = String(clientModelField || "").trim();
  return IMAGE2IMAGE_MODEL_PRESETS[q] ?? null;
}

function buildSyntheticPresetRegistryEntry(prefix, presetKey, preset) {
  return {
    modelId: `${prefix}:${presetKey}`,
    name: presetKey,
    file: preset.modelFile,
    family: preset.family,
    fullPath: preset.modelPath ?? "",
    loadKind: preset.loadKind,
    managedWorkflowId: preset.managedWorkflowId,
    comfyCheckpointGroup: preset.comfyCheckpointGroup ?? null,
    diffusionModelComfyName: preset.diffusionModelComfyName ?? null,
    checkpointBasename: preset.checkpointBasename,
    defaults: {},
  };
}

function buildSyntheticImage2videoRegistryEntry(presetKey, preset) {
  return buildSyntheticPresetRegistryEntry("image2video", presetKey, preset);
}

function buildSyntheticImage2imageRegistryEntry(presetKey, preset) {
  return buildSyntheticPresetRegistryEntry("image2image", presetKey, preset);
}

/** Fixed-model text2video presets. */
const TEXT2VIDEO_MODEL_PRESETS = {
  wan_t2v: {
    managedWorkflowId: "text2video-wan2_2_t2v",
    family: "wan-t2v",
    loadKind: "checkpoint",
    modelFile: "wan2.2-t2v-rapid-aio-v10.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "WAN",
    diffusionModelComfyName: null,
    checkpointBasename: "WAN\\wan2.2-t2v-rapid-aio-v10.safetensors",
  },
  ltx_t2v: {
    managedWorkflowId: "text2video-ltx2_3_t2v",
    family: "ltx-t2v",
    loadKind: "checkpoint",
    modelFile: "ltx-2.3-22b-dev-fp8.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "ltx",
    diffusionModelComfyName: null,
    checkpointBasename: "ltx-2.3-22b-dev-fp8.safetensors",
  },
};

function getText2videoPreset(clientModelField) {
  const q = String(clientModelField || "").trim();
  return TEXT2VIDEO_MODEL_PRESETS[q] ?? null;
}

function buildSyntheticText2videoRegistryEntry(presetKey, preset) {
  return buildSyntheticPresetRegistryEntry("text2video", presetKey, preset);
}

/** Fixed-model audio2video presets. */
const AUDIO2VIDEO_MODEL_PRESETS = {
  ltx_a2v: {
    managedWorkflowId: "audio2video-ltx2_3_ia2v",
    family: "ltx-a2v",
    loadKind: "checkpoint",
    modelFile: "ltx-2.3-22b-dev-fp8.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "ltx",
    diffusionModelComfyName: null,
    checkpointBasename: "ltx-2.3-22b-dev-fp8.safetensors",
  },
};

function getAudio2videoPreset(clientModelField) {
  const q = String(clientModelField || "").trim();
  return AUDIO2VIDEO_MODEL_PRESETS[q] ?? null;
}

function buildSyntheticAudio2videoRegistryEntry(presetKey, preset) {
  return buildSyntheticPresetRegistryEntry("audio2video", presetKey, preset);
}

module.exports = {
  IMAGE2VIDEO_MODEL_PRESETS,
  IMAGE2IMAGE_MODEL_PRESETS,
  TEXT2VIDEO_MODEL_PRESETS,
  AUDIO2VIDEO_MODEL_PRESETS,
  getImage2videoPreset,
  getImage2imagePreset,
  getText2videoPreset,
  getAudio2videoPreset,
  buildSyntheticImage2videoRegistryEntry,
  buildSyntheticImage2imageRegistryEntry,
  buildSyntheticText2videoRegistryEntry,
  buildSyntheticAudio2videoRegistryEntry,
};
