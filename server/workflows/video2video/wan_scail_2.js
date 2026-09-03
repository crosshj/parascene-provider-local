"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "wan_scail_2.json"), "utf8"),
);

const UNET_IDS = ["213:154", "262:223"];
const POSITIVE_IDS = ["213:3", "262:258"];
const NEGATIVE_IDS = ["213:4", "262:257"];

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * Wan SCAIL2 character replacement (reference image + driving video).
 * Overrides: prompt, negativePrompt, seed, inputVideoFilename,
 * inputImageFilename, diffusionModelComfyName, width, height.
 */
function WanScail2Workflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputVideoFilename && workflow["155"]?.inputs) {
    workflow["155"].inputs.file = String(overrides.inputVideoFilename);
  }
  if (overrides.inputImageFilename && workflow["30"]?.inputs) {
    workflow["30"].inputs.image = String(overrides.inputImageFilename);
  }

  if (overrides.prompt !== undefined) {
    const text = String(overrides.prompt ?? "");
    for (const id of POSITIVE_IDS) {
      if (workflow[id]?.inputs) workflow[id].inputs.text = text;
    }
  }
  if (overrides.negativePrompt !== undefined) {
    const text = String(overrides.negativePrompt ?? "");
    for (const id of NEGATIVE_IDS) {
      if (workflow[id]?.inputs) workflow[id].inputs.text = text;
    }
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, 0)
      : undefined;
  if (seed !== undefined) {
    for (const id of ["213:19", "262:227"]) {
      if (workflow[id]?.inputs && "noise_seed" in workflow[id].inputs) {
        workflow[id].inputs.noise_seed = seed;
      }
    }
  }

  const dn = overrides.diffusionModelComfyName;
  if (dn && typeof dn === "string") {
    for (const id of UNET_IDS) {
      if (workflow[id]?.inputs) workflow[id].inputs.unet_name = dn;
    }
  }

  return workflow;
}

module.exports = WanScail2Workflow;
module.exports.UNET_IDS = UNET_IDS;
