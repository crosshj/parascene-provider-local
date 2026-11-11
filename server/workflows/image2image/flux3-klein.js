"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "flux3-klein.json"), "utf8"),
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

/** FLUX3 Klein image-edit graph from the inbox template. */
function Flux3KleinImage2ImageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt != null && workflow["49"]?.inputs) {
    workflow["49"].inputs.prompt = String(overrides.prompt);
  }
  if (workflow["51"]?.inputs) {
    workflow["51"].inputs.switch = true;
    workflow["51"].inputs.on_true = ["34", 0];
  }
  if (overrides.inputImageFilename && workflow["54"]?.inputs) {
    workflow["54"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.seed !== undefined && workflow["7"]?.inputs) {
    workflow["7"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["7"].inputs.seed,
    );
  }
  if (overrides.steps !== undefined && workflow["7"]?.inputs) {
    workflow["7"].inputs.steps = toPositiveInt(
      overrides.steps,
      workflow["7"].inputs.steps,
    );
  }
  if (overrides.cfg !== undefined && workflow["7"]?.inputs) {
    workflow["7"].inputs.cfg = toNumber(
      overrides.cfg,
      workflow["7"].inputs.cfg,
    );
  }
  if (overrides.width !== undefined && workflow["44"]?.inputs) {
    workflow["44"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["44"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["44"]?.inputs) {
    workflow["44"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["44"].inputs.height,
    );
  }

  return workflow;
}

module.exports = Flux3KleinImage2ImageWorkflow;
