"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "minimax_h3_t2v.json"), "utf8"),
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
 * MiniMax H3 FL2VA text-to-video (native AV).
 *
 * Overrides: prompt, seed, durationSeconds, aspectRatio / aspect_ratio,
 * diffusionModelComfyName, megapixels.
 */
function MinimaxText2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const node = workflow["105:104"];
  if (!node?.inputs) return workflow;

  if (overrides.prompt !== undefined) {
    node.inputs.prompt = String(overrides.prompt ?? "");
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

  const aspect =
    overrides.aspectRatio || overrides.aspect_ratio || overrides.aspect;
  if (aspect && workflow["115"]?.inputs) {
    const key = String(aspect).trim();
    workflow["115"].inputs.aspect_ratio =
      ASPECT_TO_SELECTOR[key] || workflow["115"].inputs.aspect_ratio;
  }
  if (
    overrides.megapixels !== undefined &&
    workflow["115"]?.inputs &&
    Number.isFinite(Number(overrides.megapixels))
  ) {
    workflow["115"].inputs.megapixels = Number(overrides.megapixels);
  }

  if (
    overrides.diffusionModelComfyName &&
    workflow["105:6"]?.inputs
  ) {
    workflow["105:6"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = MinimaxText2VideoWorkflow;
