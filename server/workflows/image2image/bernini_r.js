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

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * Wan Bernini-R image editing.
 * Overrides: prompt, negativePrompt, seed, inputImageFilename, width, height.
 */
function BerniniRImage2ImageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputImageFilename && workflow["114"]?.inputs) {
    workflow["114"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.prompt !== undefined && workflow["76:120"]?.inputs) {
    workflow["76:120"].inputs.value = String(overrides.prompt ?? "");
  }
  if (overrides.negativePrompt !== undefined && workflow["76:4"]?.inputs) {
    workflow["76:4"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, 0)
      : undefined;
  if (seed !== undefined && workflow["76:19"]?.inputs) {
    workflow["76:19"].inputs.noise_seed = seed;
  }

  if (workflow["116"]?.inputs) {
    const longer = Math.max(
      toPositiveInt(overrides.width, 0),
      toPositiveInt(overrides.height, 0),
    );
    if (longer > 0) {
      workflow["116"].inputs["resize_type.longer_size"] = longer;
    }
  }

  return workflow;
}

module.exports = BerniniRImage2ImageWorkflow;
