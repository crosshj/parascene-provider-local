"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "krea2_turbo.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * Krea2 turbo text-to-image (template krea2_turbo.json).
 *
 * Overrides: prompt, seed, width, height, diffusionModelComfyName.
 */
function Krea2TurboWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt !== undefined && workflow["30:19"]?.inputs) {
    workflow["30:19"].inputs.value = String(overrides.prompt ?? "");
  }

  if (overrides.seed !== undefined && workflow["30:3"]?.inputs) {
    workflow["30:3"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["30:3"].inputs.seed,
    );
  }

  if (overrides.width !== undefined && workflow["30:5"]?.inputs) {
    workflow["30:5"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["30:5"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["30:5"]?.inputs) {
    workflow["30:5"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["30:5"].inputs.height,
    );
  }

  if (overrides.diffusionModelComfyName && workflow["30:10"]?.inputs) {
    workflow["30:10"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = Krea2TurboWorkflow;
