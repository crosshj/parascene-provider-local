"use strict";

const path = require("path");
const fs = require("fs");
const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "flux-diffusion.json"), "utf8"),
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

function FluxDiffusionWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  if (overrides.diffusionModelComfyName) {
    workflow["38"].inputs.unet_name = overrides.diffusionModelComfyName;
  }
  workflow["6"].inputs.text = overrides.prompt || "";
  workflow["33"].inputs.text = overrides.negativePrompt || "";
  if (overrides.seed !== undefined) {
    workflow["31"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["31"].inputs.seed,
    );
  }
  if (overrides.steps !== undefined) {
    workflow["31"].inputs.steps = toPositiveInt(
      overrides.steps,
      workflow["31"].inputs.steps,
    );
  }
  if (overrides.cfg !== undefined) {
    workflow["31"].inputs.cfg = toNumber(
      overrides.cfg,
      workflow["31"].inputs.cfg,
    );
  }
  if (overrides.width !== undefined) {
    const w = toPositiveInt(
      overrides.width,
      workflow["27"].inputs.width,
    );
    workflow["27"].inputs.width = w;
    workflow["42"].inputs.width = w;
  }
  if (overrides.height !== undefined) {
    const h = toPositiveInt(
      overrides.height,
      workflow["27"].inputs.height,
    );
    workflow["27"].inputs.height = h;
    workflow["42"].inputs.height = h;
  }
  return workflow;
}

module.exports = FluxDiffusionWorkflow;
