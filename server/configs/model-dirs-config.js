"use strict";

const MODELS_BASE = process.env.MODELS_BASE || "D:\\comfy_models";

const DIFFUSION_MODELS_SEGMENT = "diffusion_models";

// Order matters — first match wins if a file appears in multiple dirs.
// loadKind: how Comfy graphs expect weights to be loaded.
// managedWorkflowId: which server/workflows builder to use (null = excluded from API).
const MODEL_DIRS = [
  {
    rel: "diffusion_models\\qwen",
    family: "qwen",
    loadKind: "diffusion_model",
    managedWorkflowId: "text2image-qwen-diffusion",
    comfyCheckpointGroup: null,
  },
  {
    rel: "diffusion_models\\z-image",
    family: "z-image",
    loadKind: "diffusion_model",
    managedWorkflowId: "text2image-zimage-diffusion",
    comfyCheckpointGroup: null,
  },
  {
    rel: "diffusion_models\\flux",
    family: "flux",
    loadKind: "diffusion_model",
    managedWorkflowId: "text2image-flux-diffusion",
    comfyCheckpointGroup: null,
  },
  {
    rel: "checkpoints\\FLUX1",
    family: "flux",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-flux-checkpoint",
    comfyCheckpointGroup: "FLUX1",
  },
  {
    rel: "checkpoints\\1.5",
    family: "sd15",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-sd15-checkpoint",
    comfyCheckpointGroup: "1.5",
  },
  {
    rel: "checkpoints\\qwen",
    family: "qwen",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-qwen-checkpoint",
    comfyCheckpointGroup: "qwen",
  },
  {
    rel: "checkpoints\\pony",
    family: "pony",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-pony-checkpoint",
    comfyCheckpointGroup: "pony",
  },
  {
    rel: "checkpoints\\xl",
    family: "sdxl",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-sdxl-checkpoint",
    comfyCheckpointGroup: "xl",
  },
  // Narrow dirs: only place files intended for these graphs (see TODO.md).
  {
    rel: "diffusion_models\\wan\\i2v",
    family: "wan-i2v",
    loadKind: "diffusion_model",
    managedWorkflowId: "image2video-wan2_2_14B",
    comfyCheckpointGroup: null,
  },
  {
    rel: "checkpoints\\ltx\\i2v",
    family: "ltx-i2v",
    loadKind: "checkpoint",
    managedWorkflowId: "image2video-ltx2_3",
    comfyCheckpointGroup: "ltx",
  },
];

const FILENAME_OVERRIDES = [
  { test: /flux/i, family: "flux" },
  { test: /z-image/i, family: "z-image" },
  { test: /pony/i, family: "sdxl" },
  { test: /xl/i, family: "sdxl" },
  { test: /sdxl/i, family: "sdxl" },
  { test: /sd_xl/i, family: "sdxl" },
];

module.exports = {
  MODELS_BASE,
  DIFFUSION_MODELS_SEGMENT,
  MODEL_DIRS,
  FILENAME_OVERRIDES,
};
