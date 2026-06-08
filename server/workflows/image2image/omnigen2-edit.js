"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "image_omnigen2_image_edit.json"),
    "utf8",
  ),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/** Fixed OmniGen2 edit graph. */
function Omnigen2EditImage2ImageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt != null && workflow["6"]?.inputs) {
    workflow["6"].inputs.text = String(overrides.prompt);
  }
  if (overrides.negativePrompt != null && workflow["7"]?.inputs) {
    workflow["7"].inputs.text = String(overrides.negativePrompt);
  }
  if (overrides.inputImageFilename && workflow["16"]?.inputs) {
    workflow["16"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.seed !== undefined && workflow["21"]?.inputs) {
    workflow["21"].inputs.noise_seed = toPositiveInt(
      overrides.seed,
      workflow["21"].inputs.noise_seed,
    );
  }

  return workflow;
}

module.exports = Omnigen2EditImage2ImageWorkflow;
