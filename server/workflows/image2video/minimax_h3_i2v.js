"use strict";

const path = require("path");
const fs = require("fs");
const { resolveAspectRatioDimensions } = require("../../lib/aspect-ratio.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "minimax_h3_i2v.json"), "utf8"),
);

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

function applyOutputSize(node, overrides) {
  if (!node?.inputs) return;
  if (overrides.width !== undefined && overrides.height !== undefined) {
    node.inputs.width = toPositiveInt(overrides.width, node.inputs.width);
    node.inputs.height = toPositiveInt(overrides.height, node.inputs.height);
    return;
  }
  const aspect =
    overrides.aspectRatio || overrides.aspect_ratio || overrides.aspect;
  if (!aspect) return;
  const dims = resolveAspectRatioDimensions(String(aspect).trim(), 1024, 1024);
  node.inputs.width = dims.width;
  node.inputs.height = dims.height;
}

/**
 * MiniMax H3 FL2VA image-to-video / flf2va (native AV).
 *
 * Overrides: prompt, seed, durationSeconds, aspectRatio / width / height,
 * inputImageFilename (first_frame), endImageFilename (last_frame),
 * diffusionModelComfyName.
 *
 * When endImageFilename is omitted, last_frame is removed from the node
 * (single-image i2v). When both omitted, behaves like t2v on this graph.
 */
function MinimaxImage2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const node = workflow["105:104"];
  if (!node?.inputs) return workflow;

  if (overrides.prompt !== undefined) {
    node.inputs.prompt = String(overrides.prompt ?? "");
  }

  const first = overrides.inputImageFilename
    ? String(overrides.inputImageFilename)
    : null;
  const last = overrides.endImageFilename
    ? String(overrides.endImageFilename)
    : null;

  if (first && workflow["114"]?.inputs) {
    workflow["114"].inputs.image = first;
    node.inputs.first_frame = ["114", 0];
  } else {
    delete node.inputs.first_frame;
    delete workflow["114"];
  }

  if (last && workflow["121"]?.inputs) {
    workflow["121"].inputs.image = last;
    node.inputs.last_frame = ["121", 0];
  } else {
    delete node.inputs.last_frame;
    delete workflow["121"];
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["105:15"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["105:15"]?.inputs) {
    workflow["105:15"].inputs.noise_seed = seed;
  }

  const duration = toNumber(
    overrides.durationSeconds ?? overrides.duration_seconds,
    workflow["105:111"]?.inputs?.value ?? 5,
  );
  if (workflow["105:111"]?.inputs) {
    workflow["105:111"].inputs.value = Math.min(15, Math.max(4, duration));
  }

  applyOutputSize(node, overrides);

  if (overrides.diffusionModelComfyName && workflow["105:6"]?.inputs) {
    workflow["105:6"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = MinimaxImage2VideoWorkflow;
