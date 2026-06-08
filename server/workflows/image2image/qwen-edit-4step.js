"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "image_qwen_image_edit_4_step.json"),
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

/** Fixed Qwen Image Edit 4-step graph. */
function QwenEdit4StepImage2ImageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt != null && workflow["76"]?.inputs) {
    workflow["76"].inputs.prompt = String(overrides.prompt);
  }
  if (overrides.negativePrompt != null && workflow["77"]?.inputs) {
    workflow["77"].inputs.prompt = String(overrides.negativePrompt);
  }
  if (overrides.inputImageFilename && workflow["78"]?.inputs) {
    workflow["78"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.seed !== undefined && workflow["3"]?.inputs) {
    workflow["3"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["3"].inputs.seed,
    );
  }

  return workflow;
}

module.exports = QwenEdit4StepImage2ImageWorkflow;
