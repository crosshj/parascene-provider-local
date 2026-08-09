"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "bernini_r.json"), "utf8"),
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

/**
 * Wan Bernini-R video editing (video + prompt; no reference image).
 * Overrides: prompt, negativePrompt, seed, inputVideoFilename,
 * durationSeconds, startOffsetSeconds, fps, width, height.
 */
function BerniniRVideo2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputVideoFilename && workflow["47"]?.inputs) {
    workflow["47"].inputs.file = String(overrides.inputVideoFilename);
  }
  if (overrides.prompt !== undefined && workflow["298:297"]?.inputs) {
    workflow["298:297"].inputs.value = String(overrides.prompt ?? "");
  }
  if (overrides.negativePrompt !== undefined && workflow["298:267"]?.inputs) {
    workflow["298:267"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  // prepareControlVideo already windows the clip; slice from start of staged file.
  if (workflow["109"]?.inputs) {
    workflow["109"].inputs.start_time = 0;
    const duration = toNumber(
      overrides.durationSeconds ?? overrides.duration_seconds,
      workflow["109"].inputs.duration ?? 5,
    );
    if (duration > 0) {
      workflow["109"].inputs.duration = duration;
    }
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, 0)
      : undefined;
  if (seed !== undefined && workflow["298:275"]?.inputs) {
    workflow["298:275"].inputs.noise_seed = seed;
  }

  if (
    overrides.width !== undefined &&
    workflow["298:278"]?.inputs &&
    typeof workflow["298:278"].inputs.width === "number"
  ) {
    workflow["298:278"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["298:278"].inputs.width,
    );
  }
  if (
    overrides.height !== undefined &&
    workflow["298:278"]?.inputs &&
    typeof workflow["298:278"].inputs.height === "number"
  ) {
    workflow["298:278"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["298:278"].inputs.height,
    );
  }

  return workflow;
}

module.exports = BerniniRVideo2VideoWorkflow;
