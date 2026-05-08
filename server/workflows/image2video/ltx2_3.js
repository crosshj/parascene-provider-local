"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_3.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.3 image-to-video workflow (template ltx2_3.json).
 *
 * Overrides: prompt, negativePrompt, seed, inputImageFilename,
 * width, height, checkpointBasename (checkpoint loader ckpt_name fields).
 */
function LtxImage2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputImageFilename && workflow["287"]?.inputs) {
    workflow["287"].inputs.image = String(overrides.inputImageFilename);
  }

  if (workflow["267:266"]?.inputs) {
    workflow["267:266"].inputs.value =
      overrides.prompt !== undefined && overrides.prompt !== null
        ? String(overrides.prompt)
        : workflow["267:266"].inputs.value;
  }

  if (workflow["267:247"]?.inputs) {
    workflow["267:247"].inputs.text =
      overrides.negativePrompt !== undefined
        ? String(overrides.negativePrompt ?? "")
        : workflow["267:247"].inputs.text;
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["267:216"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["267:216"]?.inputs) {
    workflow["267:216"].inputs.noise_seed = seed;
  }
  if (seed !== undefined && workflow["267:237"]?.inputs) {
    workflow["267:237"].inputs.noise_seed = seed + 1;
  }

  if (overrides.width !== undefined && workflow["267:257"]?.inputs) {
    workflow["267:257"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["267:257"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["267:258"]?.inputs) {
    workflow["267:258"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["267:258"].inputs.value,
    );
  }

  const ckpt =
    overrides.checkpointBasename &&
    String(overrides.checkpointBasename).trim();
  if (ckpt) {
    if (workflow["267:236"]?.inputs) {
      workflow["267:236"].inputs.ckpt_name = ckpt;
    }
    if (workflow["267:243"]?.inputs) {
      workflow["267:243"].inputs.ckpt_name = ckpt;
    }
  }

  return workflow;
}

module.exports = LtxImage2VideoWorkflow;
