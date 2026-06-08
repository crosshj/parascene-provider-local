"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "flux-kontext.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/** Fixed Flux Kontext edit graph (flux-kontext.json). */
function FluxKontextImage2ImageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt != null && workflow["8"]?.inputs) {
    workflow["8"].inputs.text = String(overrides.prompt);
  }
  if (overrides.inputImageFilename && workflow["4"]?.inputs) {
    workflow["4"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.seed !== undefined && workflow["7"]?.inputs) {
    workflow["7"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["7"].inputs.seed,
    );
  }

  return workflow;
}

module.exports = FluxKontextImage2ImageWorkflow;
