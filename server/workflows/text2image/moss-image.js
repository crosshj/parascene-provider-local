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

/** MOSS Image text-to-image graph from the inbox template. */
function MossImageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (workflow["19"]?.class_type === "ResolutionSelector") {
    delete workflow["19"];
  }

  if (overrides.prompt != null && workflow["18:17"]?.inputs) {
    workflow["18:17"].inputs.value = String(overrides.prompt);
  }
  if (workflow["18:16"]?.inputs) {
    workflow["18:16"].inputs.switch = false;
  }

  if (overrides.seed !== undefined && workflow["18:7"]?.inputs) {
    workflow["18:7"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["18:7"].inputs.seed,
    );
  }
  if (overrides.steps !== undefined && workflow["18:7"]?.inputs) {
    workflow["18:7"].inputs.steps = toPositiveInt(
      overrides.steps,
      workflow["18:7"].inputs.steps,
    );
  }
  if (overrides.cfg !== undefined && workflow["18:7"]?.inputs) {
    workflow["18:7"].inputs.cfg = toNumber(
      overrides.cfg,
      workflow["18:7"].inputs.cfg,
    );
  }
  if (overrides.width !== undefined && workflow["18:6"]?.inputs) {
    workflow["18:6"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["18:6"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["18:6"]?.inputs) {
    workflow["18:6"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["18:6"].inputs.height,
    );
  }

  return workflow;
}

module.exports = MossImageWorkflow;
