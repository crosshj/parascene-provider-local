"use strict";

const path = require("path");
const fs = require("fs");
const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "text2image-flux-checkpoint.json"),
    "utf8",
  ),
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

function FluxWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  if (overrides.modelFile) {
    const group = overrides.comfyCheckpointGroup || "FLUX1";
    workflow["30"].inputs.ckpt_name = group + "\\" + overrides.modelFile;
  }
  workflow["6"].inputs.text = overrides.prompt || "";
  workflow["33"].inputs.text = overrides.negativePrompt || "";
  workflow["31"].inputs.seed = toPositiveInt(
    overrides.seed,
    workflow["31"].inputs.seed,
  );
  workflow["31"].inputs.steps = toPositiveInt(overrides.steps, 20);
  workflow["31"].inputs.cfg = toNumber(overrides.cfg, 1.0);
  workflow["27"].inputs.width = toPositiveInt(overrides.width, 1024);
  workflow["27"].inputs.height = toPositiveInt(overrides.height, 1024);
  return workflow;
}

module.exports = FluxWorkflow;
