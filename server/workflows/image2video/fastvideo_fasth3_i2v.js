"use strict";

const path = require("path");
const fs = require("fs");
const { resolveAspectRatioDimensions } = require("../../lib/aspect-ratio.js");
const {
  resolveWorkflowDurationSeconds,
  clampDurationSeconds,
} = require("../_duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fastvideo_fasth3_i2v.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * FastH3 image-to-video (MiniMax H3 + sparse attention). First frame only.
 * Same graph is also used for text2video: omit inputImageFilename and the
 * start-frame / size chain is stripped so MiniMaxH3ImageToVideo runs prompt-only.
 *
 * Overrides: prompt, seed, durationSeconds, aspectRatio, width, height,
 * inputImageFilename, diffusionModelComfyName.
 */
function FastH3Image2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const node = workflow["105:104"];
  if (!node?.inputs) return workflow;

  if (overrides.prompt !== undefined) {
    node.inputs.prompt = String(overrides.prompt ?? "");
  }

  const first = overrides.inputImageFilename
    ? String(overrides.inputImageFilename)
    : null;
  if (first && workflow["136"]?.inputs) {
    workflow["136"].inputs.image = first;
    node.inputs.first_frame = ["136", 0];
  } else {
    delete node.inputs.first_frame;
    delete workflow["136"];
    delete workflow["141"];
    delete workflow["142"];
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["105:15"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["105:15"]?.inputs) {
    workflow["105:15"].inputs.noise_seed = seed;
  }

  const duration = clampDurationSeconds(
    resolveWorkflowDurationSeconds(
      overrides,
      workflow["105:111"]?.inputs?.value,
    ),
    { min: 4, max: 15 },
  );
  if (duration !== undefined && workflow["105:111"]?.inputs) {
    workflow["105:111"].inputs.value = duration;
  }

  const aspect =
    overrides.aspectRatio || overrides.aspect_ratio || overrides.aspect;
  if (aspect && node?.inputs) {
    const dims = resolveAspectRatioDimensions(String(aspect).trim(), 1024, 1024);
    node.inputs.width = dims.width;
    node.inputs.height = dims.height;
  } else if (!first && node?.inputs) {
    node.inputs.width = toPositiveInt(overrides.width, 768);
    node.inputs.height = toPositiveInt(overrides.height, 768);
  }
  if (overrides.diffusionModelComfyName && workflow["105:6"]?.inputs) {
    workflow["105:6"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = FastH3Image2VideoWorkflow;
