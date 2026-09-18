"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "krea2_turbo.json"), "utf8"),
);

const RESOLUTION_LABELS = {
  "1:1": "1:1 (Square)",
  "16:9": "16:9 (Landscape)",
  "9:16": "9:16 (Portrait)",
  "4:5": "4:5 (Portrait)",
};

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
 * Overrides: prompt, seed, aspectRatio, diffusionModelComfyName.
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

  const aspect = overrides.aspectRatio || overrides.aspect_ratio;
  if (aspect && workflow["49"]?.inputs) {
    const key = String(aspect).trim();
    workflow["49"].inputs.aspect_ratio = RESOLUTION_LABELS[key] || key;
  }

  if (overrides.diffusionModelComfyName && workflow["30:10"]?.inputs) {
    workflow["30:10"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = Krea2TurboWorkflow;
