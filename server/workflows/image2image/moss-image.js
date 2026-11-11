"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "moss-image.json"), "utf8"),
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

/** MOSS Image image-edit graph from the inbox template. */
function MossImageImage2ImageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt != null && workflow["39"]?.inputs) {
    workflow["39"].inputs.prompt = String(overrides.prompt);
  }
  if (overrides.inputImageFilename && workflow["8"]?.inputs) {
    workflow["8"].inputs.image = String(overrides.inputImageFilename);
  }

  if (overrides.seed !== undefined && workflow["37"]?.inputs) {
    workflow["37"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["37"].inputs.seed,
    );
  }
  if (overrides.steps !== undefined && workflow["37"]?.inputs) {
    workflow["37"].inputs.steps = toPositiveInt(
      overrides.steps,
      workflow["37"].inputs.steps,
    );
  }
  if (overrides.cfg !== undefined && workflow["37"]?.inputs) {
    workflow["37"].inputs.cfg = toNumber(
      overrides.cfg,
      workflow["37"].inputs.cfg,
    );
  }
  if (overrides.width !== undefined && workflow["28"]?.inputs) {
    workflow["28"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["28"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["28"]?.inputs) {
    workflow["28"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["28"].inputs.height,
    );
  }

  return workflow;
}

module.exports = MossImageImage2ImageWorkflow;
