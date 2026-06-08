"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "Qwen-Rapid-AIO.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/** Fixed Qwen Rapid AIO edit graph. */
function QwenRapidAioImage2ImageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt != null && workflow["3"]?.inputs) {
    workflow["3"].inputs.prompt = String(overrides.prompt);
  }
  if (overrides.inputImageFilename && workflow["8"]?.inputs) {
    workflow["8"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.seed !== undefined && workflow["2"]?.inputs) {
    workflow["2"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["2"].inputs.seed,
    );
  }

  return workflow;
}

module.exports = QwenRapidAioImage2ImageWorkflow;
