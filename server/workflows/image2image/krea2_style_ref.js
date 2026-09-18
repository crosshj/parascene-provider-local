"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "krea2_style_ref.json"), "utf8"),
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
 * Krea2 turbo style-reference image2image (template krea2_style_ref.json).
 *
 * Overrides: prompt, seed, inputImageFilename, aspectRatio.
 */
function Krea2StyleRefWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt !== undefined && workflow["30:19"]?.inputs) {
    workflow["30:19"].inputs.value = String(overrides.prompt ?? "");
  }
  if (overrides.inputImageFilename && workflow["69"]?.inputs) {
    workflow["69"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.seed !== undefined && workflow["30:63"]?.inputs) {
    workflow["30:63"].inputs.noise_seed = toPositiveInt(
      overrides.seed,
      workflow["30:63"].inputs.noise_seed,
    );
  }

  const aspect = overrides.aspectRatio || overrides.aspect_ratio;
  if (aspect && workflow["71"]?.inputs) {
    const key = String(aspect).trim();
    workflow["71"].inputs.aspect_ratio = RESOLUTION_LABELS[key] || key;
  }

  return workflow;
}

module.exports = Krea2StyleRefWorkflow;
