"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "qwen-image-2_1_turbo.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function QwenImage21TurboWorkflow(overrides = {}) {
  const workflow = JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));

  if (workflow["13"]?.class_type === "ResolutionSelector") {
    delete workflow["13"];
  }
  if (workflow["459:474"]?.inputs) {
    workflow["459:474"].inputs.switch = false;
  }
  if (overrides.prompt != null && workflow["459:474"]?.inputs) {
    workflow["459:474"].inputs.on_false = String(overrides.prompt);
  }
  if (overrides.seed !== undefined && workflow["459:488"]?.inputs) {
    workflow["459:488"].inputs.noise_seed = toPositiveInt(
      overrides.seed,
      workflow["459:488"].inputs.noise_seed,
    );
  }
  if (overrides.cfg !== undefined && workflow["459:489"]?.inputs) {
    const cfg = Number(overrides.cfg);
    if (Number.isFinite(cfg)) workflow["459:489"].inputs.cfg = cfg;
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

module.exports = QwenImage21TurboWorkflow;