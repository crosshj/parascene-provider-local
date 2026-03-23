"use strict";

const path = require("path");
const fs = require("fs");
const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "text2image-sd15-checkpoint.json"),
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

function Sd15Workflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  if (overrides.modelFile) {
    const group = overrides.comfyCheckpointGroup || "1.5";
    workflow["30"].inputs.ckpt_name = group + "\\" + overrides.modelFile;
  }
  workflow["6"].inputs.text = overrides.prompt || "";
  workflow["33"].inputs.text = overrides.negativePrompt || "";
  workflow["31"].inputs.seed = toPositiveInt(
    overrides.seed,
    workflow["31"].inputs.seed,
  );
  workflow["31"].inputs.steps = toPositiveInt(overrides.steps, 30);
  workflow["31"].inputs.cfg = toNumber(overrides.cfg, 7.0);
  workflow["27"].inputs.width = toPositiveInt(overrides.width, 768);
  workflow["27"].inputs.height = toPositiveInt(overrides.height, 768);
  return workflow;
}

module.exports = Sd15Workflow;
