"use strict";

const path = require("path");
const fs = require("fs");
const { durationSecondsToLtxFrames } = require("../_ltx-duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_5_t2v.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_DURATION_SECONDS = 9;

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.5 text-to-video (template ltx2_5_t2v.json).
 *
 * Overrides: prompt, negativePrompt, seed, width, height, fps, durationSeconds,
 * diffusionModelComfyName.
 */
function Ltx25Text2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (workflow["405:376"]?.inputs) {
    workflow["405:376"].inputs.value =
      overrides.prompt !== undefined
        ? String(overrides.prompt)
        : workflow["405:376"].inputs.value;
  }
  if (workflow["405:373"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["405:373"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["405:338"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined) {
    if (workflow["405:338"]?.inputs) workflow["405:338"].inputs.noise_seed = seed;
    if (workflow["405:339"]?.inputs)
      workflow["405:339"].inputs.noise_seed = seed + 1;
  }

  if (overrides.width !== undefined && workflow["405:372"]?.inputs) {
    workflow["405:372"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["405:372"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["405:360"]?.inputs) {
    workflow["405:360"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["405:360"].inputs.value,
    );
  }

  const defaultFps = workflow["405:361"]?.inputs?.value;
  const fps =
    overrides.fps !== undefined
      ? toPositiveInt(overrides.fps, defaultFps)
      : defaultFps;
  if (fps !== undefined && workflow["405:361"]?.inputs) {
    workflow["405:361"].inputs.value = fps;
  }

  const durationSeconds = toNumber(
    overrides.durationSeconds ?? overrides.duration_seconds,
    workflow["405:362"]?.inputs?.value ?? DEFAULT_DURATION_SECONDS,
  );
  if (workflow["405:362"]?.inputs) {
    workflow["405:362"].inputs.value = Math.max(1, Math.round(durationSeconds));
  }

  if (overrides.diffusionModelComfyName && workflow["405:384"]?.inputs) {
    workflow["405:384"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  durationSecondsToLtxFrames(
    durationSeconds,
    Number(fps) > 0 ? Number(fps) : 24,
  );

  return workflow;
}

module.exports = Ltx25Text2VideoWorkflow;
