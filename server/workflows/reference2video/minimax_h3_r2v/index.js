"use strict";

const path = require("path");
const fs = require("fs");
const { resolveAspectRatioDimensions } = require("../../../lib/aspect-ratio.js");
const {
  resolveWorkflowDurationSeconds,
  clampDurationSeconds,
} = require("../../_duration.js");

const IMAGE_NODE_IDS = [
  "137",
  "139",
  "150",
  "151",
  "152",
  "153",
  "154",
  "155",
  "156",
];
/** LoadVideo nodes — MiniMax wants IMAGE frames, so builder wires GetVideoComponents. */
const VIDEO_NODE_IDS = ["140", "141", "142"];
const VIDEO_FRAME_NODE_IDS = ["160", "161", "162"];
const AUDIO_NODE_IDS = ["143", "144", "145"];

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * MiniMax H3 Ref2VA omni-reference workflow.
 *
 * Overrides:
 *   prompt, seed, durationSeconds, aspectRatio, ref_image_size,
 *   inputImageFilenames (≤9), inputVideoFilenames (≤3), inputAudioFilenames (≤3),
 *   diffusionModelComfyName
 */
function createMinimaxR2vWorkflow(templateFile) {
  const WORKFLOW_TEMPLATE = JSON.parse(
    fs.readFileSync(path.join(__dirname, templateFile), "utf8"),
  );

  return function MinimaxReference2VideoWorkflow(overrides = {}) {
    const workflow = JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
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
      const loadId = VIDEO_NODE_IDS[i];
      const framesId = VIDEO_FRAME_NODE_IDS[i];
      if (i < videos.length && workflow[loadId]?.inputs) {
        workflow[loadId].inputs.file = String(videos[i]);
        // MiniMaxH3ReferenceToVideo.ref_videos.* expects IMAGE, not VIDEO.
        node.inputs[`ref_videos.ref_video_${i}`] = [framesId, 0];
      } else {
        delete workflow[loadId];
        delete workflow[framesId];
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

    const duration = clampDurationSeconds(
      resolveWorkflowDurationSeconds(overrides, workflow["132"]?.inputs?.value),
      { min: 4, max: 15 },
    );
    if (duration !== undefined && workflow["132"]?.inputs) {
      workflow["132"].inputs.value = duration;
    }

    const aspect =
      overrides.aspectRatio || overrides.aspect_ratio || overrides.aspect;
    if (overrides.width !== undefined && overrides.height !== undefined) {
      node.inputs.width = toPositiveInt(overrides.width, node.inputs.width);
      node.inputs.height = toPositiveInt(overrides.height, node.inputs.height);
    } else if (aspect && node?.inputs) {
      const key = String(aspect).trim();
      const dims = resolveAspectRatioDimensions(key, 1024, 1024);
      node.inputs.width = dims.width;
      node.inputs.height = dims.height;
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
  };
}

const MinimaxReference2VideoWorkflow = createMinimaxR2vWorkflow(
  "minimax_h3_r2v.json",
);
MinimaxReference2VideoWorkflow.turbo = createMinimaxR2vWorkflow(
  "minimax_h3_r2v_turbo.json",
);
MinimaxReference2VideoWorkflow.pdd = createMinimaxR2vWorkflow(
  "minimax_h3_r2v_pdd.json",
);

module.exports = MinimaxReference2VideoWorkflow;
