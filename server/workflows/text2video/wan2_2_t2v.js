"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "wan2.2-t2v-rapid-aio-example.json"),
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

/**
 * Wan 2.2 text-to-video workflow (template wan2.2-t2v-rapid-aio-example.json).
 *
 * Overrides: prompt, negativePrompt, seed, width, height, length, fps, steps,
 * checkpointBasename (ckpt_name in node "1").
 */
function WanText2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.checkpointBasename && workflow["1"]?.inputs) {
    workflow["1"].inputs.ckpt_name = String(overrides.checkpointBasename);
  }

  if (workflow["5"]?.inputs) {
    workflow["5"].inputs.text =
      overrides.prompt !== undefined ? String(overrides.prompt) : workflow["5"].inputs.text;
  }

  if (workflow["4"]?.inputs) {
    workflow["4"].inputs.text =
      overrides.negativePrompt !== undefined
        ? String(overrides.negativePrompt)
        : workflow["4"].inputs.text;
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["3"]?.inputs?.seed)
      : undefined;
  if (seed !== undefined && workflow["3"]?.inputs) {
    workflow["3"].inputs.seed = seed;
  }

  if (overrides.width !== undefined && workflow["6"]?.inputs) {
    workflow["6"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["6"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["6"]?.inputs) {
    workflow["6"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["6"].inputs.height,
    );
  }

  const explicitLength = overrides.length ?? overrides.framesNumber ?? overrides.frames;
  if (explicitLength !== undefined && workflow["6"]?.inputs) {
    workflow["6"].inputs.length = toPositiveInt(
      explicitLength,
      workflow["6"].inputs.length,
    );
  }

  if (overrides.fps !== undefined && workflow["11"]?.inputs) {
    workflow["11"].inputs.fps = toNumber(overrides.fps, workflow["11"].inputs.fps);
  }

  if (overrides.steps !== undefined && workflow["3"]?.inputs) {
    workflow["3"].inputs.steps = toPositiveInt(
      overrides.steps,
      workflow["3"].inputs.steps,
    );
  }

  return workflow;
}

module.exports = WanText2VideoWorkflow;
