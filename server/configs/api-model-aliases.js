"use strict";

/**
 * Capability flags advertised to clients (honest cross-family matrix).
 * - flf: first+last frame via second image (generated audio where nativeAudio)
 * - nativeAudio: graph emits soundtrack
 * - userAudio: caller-supplied audio conditioning
 * - multiRefImages / refVideo / refAudio: omni-reference slots
 */
function caps(list) {
  return list;
}

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
    capabilities: caps(["i2v", "flf"]),
    nativeAudio: false,
    flfWorkflowId: "image2video-wan2_2_14B_flf2v",
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
    capabilities: caps(["i2v", "flf"]),
    nativeAudio: true,
    flfWorkflowId: "image2video-ltx2_3_flf2v",
  },
  ltx_style_transition: {
    managedWorkflowId: "image2video-ltx2_3_style_transition",
    family: "ltx-style-transition",
    loadKind: "checkpoint",
    modelFile: "ltx-2.3-22b-distilled-fp8.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "ltx",
    diffusionModelComfyName: null,
    checkpointBasename: "ltx-2.3-22b-distilled-fp8.safetensors",
    capabilities: caps(["flf", "style_transition"]),
    nativeAudio: true,
    requiresEndFrame: true,
  },
  minimax_i2v: {
    managedWorkflowId: "image2video-minimax_h3_i2v",
    family: "minimax-i2v",
    loadKind: "diffusion_model",
    modelFile: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName:
      "minimax\\minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    checkpointBasename: undefined,
    capabilities: caps(["i2v", "flf"]),
    nativeAudio: true,
    // Same FL2VA graph handles flf via last_frame.
    flfWorkflowId: "image2video-minimax_h3_i2v",
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
    capabilities: caps(["i2i"]),
  },
  qwen_edit_i2i: {
    managedWorkflowId: "image2image-qwen-edit-4step",
    family: "qwen-i2i",
    loadKind: "diffusion_model",
    modelFile: "qwen_image_edit_fp8_e4m3fn.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: null,
    capabilities: caps(["i2i"]),
  },
  qwen_rapid_i2i: {
    managedWorkflowId: "image2image-qwen-rapid-aio",
    family: "qwen-i2i",
    loadKind: "checkpoint",
    modelFile: "Qwen-Rapid-AIO-NSFW-v9.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "qwen",
    diffusionModelComfyName: null,
    capabilities: caps(["i2i"]),
  },
  omnigen2_edit_i2i: {
    managedWorkflowId: "image2image-omnigen2-edit",
    family: "omnigen2-i2i",
    loadKind: "diffusion_model",
    modelFile: "omnigen2_fp16.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: null,
    capabilities: caps(["i2i"]),
  },
  bernini_r_i2i: {
    managedWorkflowId: "image2image-bernini_r",
    family: "bernini-r",
    loadKind: "diffusion_model",
    modelFile: "wan2.2_bernini_r_high_noise_fp8_scaled.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName:
      "wan2.2_bernini_r_high_noise_fp8_scaled.safetensors",
    capabilities: caps(["i2i"]),
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
    capabilities: preset.capabilities || [],
    nativeAudio: Boolean(preset.nativeAudio),
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
    capabilities: caps(["t2v"]),
    nativeAudio: false,
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
    capabilities: caps(["t2v"]),
    nativeAudio: true,
  },
  minimax_t2v: {
    managedWorkflowId: "text2video-minimax_h3_t2v",
    family: "minimax-t2v",
    loadKind: "diffusion_model",
    modelFile: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName:
      "minimax\\minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    checkpointBasename: undefined,
    capabilities: caps(["t2v"]),
    nativeAudio: true,
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
    capabilities: caps(["a2v", "userAudio"]),
    nativeAudio: true,
  },
  ltx_id_lora: {
    managedWorkflowId: "audio2video-ltx2_3_id_lora",
    family: "ltx-id",
    loadKind: "checkpoint",
    modelFile: "ltx-2.3-22b-dev-fp8.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "ltx",
    diffusionModelComfyName: null,
    checkpointBasename: "ltx-2.3-22b-dev-fp8.safetensors",
    capabilities: caps(["a2v", "userAudio", "identity"]),
    nativeAudio: true,
    requiresReferenceImage: true,
  },
};

function getAudio2videoPreset(clientModelField) {
  const q = String(clientModelField || "").trim();
  return AUDIO2VIDEO_MODEL_PRESETS[q] ?? null;
}

function buildSyntheticAudio2videoRegistryEntry(presetKey, preset) {
  return buildSyntheticPresetRegistryEntry("audio2video", presetKey, preset);
}

/**
 * Fixed-model video2video presets.
 *
 * Wan Fun VACE (wan_v2v / wan_motion) is parked — graphs + builders remain under
 * server/workflows/video2video/ and _index.js, but are not API-exposed. See
 * video-capability-notes.md § "Parked: Wan Fun VACE".
 */
const VIDEO2VIDEO_MODEL_PRESETS = {
  // wan_v2v: {
  //   managedWorkflowId: "video2video-wan2_2_vace_v2v",
  //   family: "wan-v2v",
  //   loadKind: "diffusion_model",
  //   modelFile: "wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors",
  //   modelPath: "",
  //   comfyCheckpointGroup: null,
  //   diffusionModelComfyName:
  //     "wan\\wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors",
  //   checkpointBasename: undefined,
  //   requiresReferenceImage: false,
  //   capabilities: caps(["v2v", "refVideo"]),
  //   nativeAudio: false,
  // },
  // wan_motion: {
  //   managedWorkflowId: "video2video-wan2_2_vace_motion",
  //   family: "wan-motion",
  //   loadKind: "diffusion_model",
  //   modelFile: "wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors",
  //   modelPath: "",
  //   comfyCheckpointGroup: null,
  //   diffusionModelComfyName:
  //     "wan\\wan2.2_fun_vace_low_noise_14B_fp8_scaled.safetensors",
  //   checkpointBasename: undefined,
  //   requiresReferenceImage: true,
  //   capabilities: caps(["motion", "refVideo"]),
  //   nativeAudio: false,
  // },
  ltx_ic_lora: {
    managedWorkflowId: "video2video-ltx2_3_ic_lora",
    family: "ltx-ic",
    loadKind: "checkpoint",
    modelFile: "ltx-2.3-22b-distilled-fp8.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "ltx",
    diffusionModelComfyName: null,
    checkpointBasename: "ltx-2.3-22b-distilled-fp8.safetensors",
    requiresReferenceImage: true,
    capabilities: caps(["v2v", "control", "refVideo"]),
    nativeAudio: true,
    videoInputProfile: {
      targetFps: 25,
      defaultDurationSeconds: 5,
      maxLongerEdge: 1344,
    },
  },
  wan_animate: {
    managedWorkflowId: "video2video-wan_animate_2",
    family: "wan-animate",
    loadKind: "diffusion_model",
    modelFile: "wan_animate_2_int8_convrot.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: "wan_animate_2_int8_convrot.safetensors",
    checkpointBasename: undefined,
    requiresReferenceImage: true,
    capabilities: caps(["v2v", "motion", "refVideo"]),
    nativeAudio: true,
    videoInputProfile: {
      targetFps: 16,
      defaultDurationSeconds: 5,
      maxLongerEdge: 960,
    },
  },
  bernini_r_v2v: {
    managedWorkflowId: "video2video-bernini_r",
    family: "bernini-r",
    loadKind: "diffusion_model",
    modelFile: "wan2.2_bernini_r_high_noise_fp8_scaled.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName:
      "wan2.2_bernini_r_high_noise_fp8_scaled.safetensors",
    checkpointBasename: undefined,
    requiresReferenceImage: false,
    capabilities: caps(["v2v", "refVideo"]),
    nativeAudio: true,
    videoInputProfile: {
      targetFps: 16,
      defaultDurationSeconds: 5,
      maxLongerEdge: 960,
    },
  },
  wan_scail: {
    managedWorkflowId: "video2video-wan_scail_2",
    family: "wan-scail",
    loadKind: "diffusion_model",
    modelFile: "wan2.1_14B_SCAIL_2_int8_convrot.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: "wan2.1_14B_SCAIL_2_int8_convrot.safetensors",
    checkpointBasename: undefined,
    requiresReferenceImage: true,
    capabilities: caps(["v2v", "motion", "refVideo"]),
    nativeAudio: true,
    videoInputProfile: {
      targetFps: 16,
      defaultDurationSeconds: 5,
      maxLongerEdge: 960,
    },
  },
  wan_scail_fp16: {
    managedWorkflowId: "video2video-wan_scail_2",
    family: "wan-scail",
    loadKind: "diffusion_model",
    modelFile: "wan2.1_14B_SCAIL_2_fp16.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: "wan2.1_14B_SCAIL_2_fp16.safetensors",
    checkpointBasename: undefined,
    requiresReferenceImage: true,
    capabilities: caps(["v2v", "motion", "refVideo"]),
    nativeAudio: true,
    videoInputProfile: {
      targetFps: 16,
      defaultDurationSeconds: 5,
      maxLongerEdge: 960,
    },
  },
};

function getVideo2videoPreset(clientModelField) {
  const q = String(clientModelField || "").trim();
  return VIDEO2VIDEO_MODEL_PRESETS[q] ?? null;
}

function buildSyntheticVideo2videoRegistryEntry(presetKey, preset) {
  return buildSyntheticPresetRegistryEntry("video2video", presetKey, preset);
}

/** Omni-reference / multi-ref presets. */
const REFERENCE2VIDEO_MODEL_PRESETS = {
  minimax_r2v: {
    managedWorkflowId: "reference2video-minimax_h3_r2v",
    family: "minimax-r2v",
    loadKind: "diffusion_model",
    modelFile: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    modelPath: "",
    comfyCheckpointGroup: null,
    diffusionModelComfyName:
      "minimax\\minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    checkpointBasename: undefined,
    capabilities: caps(["r2v", "multiRefImages", "refVideo", "refAudio"]),
    nativeAudio: true,
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
  },
  ltx_ingredients: {
    managedWorkflowId: "reference2video-ltx2_3_ic_lora_ingredients",
    family: "ltx-ingredients",
    loadKind: "checkpoint",
    modelFile: "ltx-2.3-22b-distilled-fp8.safetensors",
    modelPath: "",
    comfyCheckpointGroup: "ltx",
    diffusionModelComfyName: null,
    checkpointBasename: "ltx-2.3-22b-distilled-fp8.safetensors",
    capabilities: caps(["r2v", "multiRefImages"]),
    nativeAudio: true,
    maxRefImages: 1,
    maxRefVideos: 0,
    maxRefAudios: 0,
  },
};

function getReference2videoPreset(clientModelField) {
  const q = String(clientModelField || "").trim();
  return REFERENCE2VIDEO_MODEL_PRESETS[q] ?? null;
}

function buildSyntheticReference2videoRegistryEntry(presetKey, preset) {
  return buildSyntheticPresetRegistryEntry("reference2video", presetKey, preset);
}

/** Flat capability matrix for GET /api (and docs). */
function buildCapabilityMatrix() {
  const rows = [];
  const groups = [
    ["text2video", TEXT2VIDEO_MODEL_PRESETS],
    ["image2video", IMAGE2VIDEO_MODEL_PRESETS],
    ["audio2video", AUDIO2VIDEO_MODEL_PRESETS],
    ["video2video", VIDEO2VIDEO_MODEL_PRESETS],
    ["reference2video", REFERENCE2VIDEO_MODEL_PRESETS],
  ];
  for (const [method, presets] of groups) {
    for (const [key, preset] of Object.entries(presets)) {
      rows.push({
        method,
        model: key,
        family: preset.family,
        capabilities: preset.capabilities || [],
        nativeAudio: Boolean(preset.nativeAudio),
        flf: (preset.capabilities || []).includes("flf"),
        maxRefImages: preset.maxRefImages,
        maxRefVideos: preset.maxRefVideos,
        maxRefAudios: preset.maxRefAudios,
      });
    }
  }
  return rows;
}

module.exports = {
  IMAGE2VIDEO_MODEL_PRESETS,
  IMAGE2IMAGE_MODEL_PRESETS,
  TEXT2VIDEO_MODEL_PRESETS,
  AUDIO2VIDEO_MODEL_PRESETS,
  VIDEO2VIDEO_MODEL_PRESETS,
  REFERENCE2VIDEO_MODEL_PRESETS,
  getImage2videoPreset,
  getImage2imagePreset,
  getText2videoPreset,
  getAudio2videoPreset,
  getVideo2videoPreset,
  getReference2videoPreset,
  buildSyntheticImage2videoRegistryEntry,
  buildSyntheticImage2imageRegistryEntry,
  buildSyntheticText2videoRegistryEntry,
  buildSyntheticAudio2videoRegistryEntry,
  buildSyntheticVideo2videoRegistryEntry,
  buildSyntheticReference2videoRegistryEntry,
  buildCapabilityMatrix,
};
