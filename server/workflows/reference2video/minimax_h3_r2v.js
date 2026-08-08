"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "minimax_h3_r2v.json"), "utf8"),
);

const ASPECT_TO_SELECTOR = {
  "1:1": "1:1 (Square)",
  "16:9": "16:9 (Widescreen)",
  "9:16": "9:16 (Portrait Widescreen)",
  "4:5": "4:5 (Portrait)",
  "4:3": "4:3 (Standard)",
  "3:4": "3:4 (Portrait)",
  "21:9": "21:9 (Ultra-Widescreen)",
};

const IMAGE_NODE_IDS = ["137", "139", "150", "151", "152", "153", "154", "155", "156"];
const VIDEO_NODE_IDS = ["140", "141", "142"];
const AUDIO_NODE_IDS = ["143", "144", "145"];

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

/**
 * MiniMax H3 Ref2VA omni-reference workflow.
 *
 * Overrides:
 *   prompt, seed, durationSeconds, aspectRatio, ref_image_size,
 *   inputImageFilenames (≤9), inputVideoFilenames (≤3), inputAudioFilenames (≤3),
 *   diffusionModelComfyName
 */
function MinimaxReference2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const node = workflow["136"];
  if (!node?.inputs) return workflow;

  if (workflow["138"]?.inputs) {
    workflow["138"].inputs.value =
      overrides.prompt !== undefined
        ? String(overrides.prompt ?? "")
        : workflow["138"].inputs.value;
  }

  const images = Array.isArray(overrides.inputImageFilenames)
    ? overrides.inputImageFilenames.filter(Boolean).slice(0, 9)
    : [];
  const videos = Array.isArray(overrides.inputVideoFilenames)
    ? overrides.inputVideoFilenames.filter(Boolean).slice(0, 3)
    : [];
  const audios = Array.isArray(overrides.inputAudioFilenames)
    ? overrides.inputAudioFilenames.filter(Boolean).slice(0, 3)
    : [];

  // Clear all dynamic ref slots, then wire provided ones.
  for (const key of Object.keys(node.inputs)) {
    if (
      key.startsWith("ref_images.") ||
      key.startsWith("ref_videos.") ||
      key.startsWith("ref_audios.")
    ) {
      delete node.inputs[key];
    }
  }

  for (let i = 0; i < IMAGE_NODE_IDS.length; i++) {
    const id = IMAGE_NODE_IDS[i];
    if (i < images.length && workflow[id]?.inputs) {
      workflow[id].inputs.image = String(images[i]);
      node.inputs[`ref_images.ref_image_${i}`] = [id, 0];
    } else {
      delete workflow[id];
    }
  }

  for (let i = 0; i < VIDEO_NODE_IDS.length; i++) {
    const id = VIDEO_NODE_IDS[i];
    if (i < videos.length && workflow[id]?.inputs) {
      workflow[id].inputs.file = String(videos[i]);
      node.inputs[`ref_videos.ref_video_${i}`] = [id, 0];
    } else {
      delete workflow[id];
    }
  }

  for (let i = 0; i < AUDIO_NODE_IDS.length; i++) {
    const id = AUDIO_NODE_IDS[i];
    if (i < audios.length && workflow[id]?.inputs) {
      workflow[id].inputs.audio = String(audios[i]);
      node.inputs[`ref_audios.ref_audio_${i}`] = [id, 0];
    } else {
      delete workflow[id];
    }
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["129"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["129"]?.inputs) {
    workflow["129"].inputs.noise_seed = seed;
  }

  const duration = toNumber(
    overrides.durationSeconds ?? overrides.duration_seconds,
    workflow["132"]?.inputs?.value ?? 5,
  );
  if (workflow["132"]?.inputs) {
    workflow["132"].inputs.value = Math.min(15, Math.max(4, duration));
  }

  const aspect =
    overrides.aspectRatio || overrides.aspect_ratio || overrides.aspect;
  if (aspect && workflow["115"]?.inputs) {
    const key = String(aspect).trim();
    workflow["115"].inputs.aspect_ratio =
      ASPECT_TO_SELECTOR[key] || workflow["115"].inputs.aspect_ratio;
  }

  if (overrides.ref_image_size && node.inputs) {
    node.inputs.ref_image_size = String(overrides.ref_image_size);
  }

  if (overrides.diffusionModelComfyName && workflow["127"]?.inputs) {
    workflow["127"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = MinimaxReference2VideoWorkflow;
