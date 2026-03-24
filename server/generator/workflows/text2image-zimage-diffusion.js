"use strict";

const path = require("path");
const fs = require("fs");
const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "text2image-zimage-diffusion.json"),
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

function ZimageWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  workflow["6"].inputs.text = overrides.prompt || "";
  if (overrides.seed !== undefined) {
    workflow["31"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["31"].inputs.seed,
    );
  }
  if (overrides.steps !== undefined) {
    workflow["31"].inputs.steps = toPositiveInt(
      overrides.steps,
      workflow["31"].inputs.steps,
    );
  }
  if (overrides.cfg !== undefined) {
    workflow["31"].inputs.cfg = toNumber(
      overrides.cfg,
      workflow["31"].inputs.cfg,
    );
  }
  if (overrides.width !== undefined) {
    workflow["39"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["39"].inputs.width,
    );
  }
  if (overrides.height !== undefined) {
    workflow["39"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["39"].inputs.height,
    );
  }
  return workflow;
}

module.exports = ZimageWorkflow;
