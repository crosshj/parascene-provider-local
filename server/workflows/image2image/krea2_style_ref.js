"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "krea2_style_ref.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

function applySize(workflow, nodeId, width, height) {
  const node = workflow[nodeId];
  if (!node?.inputs) return;
  if (width !== undefined) {
    node.inputs.width = toPositiveInt(width, node.inputs.width);
  }
  if (height !== undefined) {
    node.inputs.height = toPositiveInt(height, node.inputs.height);
  }
}

/**
 * Krea2 turbo style-reference image2image (template krea2_style_ref.json).
 *
 * Overrides: prompt, seed, inputImageFilename, width, height,
 * diffusionModelComfyName.
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

  applySize(workflow, "30:5", overrides.width, overrides.height);
  applySize(workflow, "30:61", overrides.width, overrides.height);
  applySize(workflow, "30:64", overrides.width, overrides.height);

  if (overrides.diffusionModelComfyName && workflow["30:10"]?.inputs) {
    workflow["30:10"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = Krea2StyleRefWorkflow;
