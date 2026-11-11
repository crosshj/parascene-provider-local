"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "qwen-image-2_1.json"), "utf8"),
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

/** Qwen Image 2.1 text-to-image workflow from the inbox template. */
function QwenImage21Workflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (workflow["13"]?.class_type === "ResolutionSelector") {
    delete workflow["13"];
  }

  if (workflow["459:474"]?.inputs) {
    workflow["459:474"].inputs.switch = false;
  }
  if (overrides.prompt != null && workflow["459:474"]?.inputs) {
    workflow["459:474"].inputs.on_false = String(overrides.prompt);
  }

  if (overrides.seed !== undefined && workflow["459:458"]?.inputs) {
    workflow["459:458"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["459:458"].inputs.seed,
    );
  }
  if (overrides.steps !== undefined && workflow["459:458"]?.inputs) {
    workflow["459:458"].inputs.steps = toPositiveInt(
      overrides.steps,
      workflow["459:458"].inputs.steps,
    );
  }
  if (overrides.cfg !== undefined && workflow["459:458"]?.inputs) {
    workflow["459:458"].inputs.cfg = toNumber(
      overrides.cfg,
      workflow["459:458"].inputs.cfg,
    );
  }
  if (overrides.width !== undefined && workflow["459:456"]?.inputs) {
    workflow["459:456"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["459:456"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["459:456"]?.inputs) {
    workflow["459:456"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["459:456"].inputs.height,
    );
  }

  return workflow;
}

module.exports = QwenImage21Workflow;
