"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "sdxl-checkpoint.json"),
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
 * SDXL image-to-image workflow builder.
 *
 * Expected overrides:
 * - prompt: text prompt
 * - negativePrompt: negative prompt
 * - seed, steps, cfg: sampler controls
 * - inputImageFilename: basename in ComfyUI's input directory
 */
function SDXLImageToImageWorkflow(overrides = {}) {
  try {
    const workflow = cloneBaseWorkflow();

    // Prompt / negative prompt
    workflow["6"].inputs.text = overrides.prompt || "";
    if (workflow["33"] && workflow["33"].inputs) {
      workflow["33"].inputs.text = overrides.negativePrompt || "";
    }

    // Sampler controls on node "31"
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

    // Image input on node "34" (LoadImage)
    if (
      overrides.inputImageFilename &&
      workflow["34"] &&
      workflow["34"].inputs
    ) {
      workflow["34"].inputs.image = String(overrides.inputImageFilename);
    }

    return workflow;
  } catch (err) {
    console.error(
      "[SDXL IMAGE2IMAGE WORKFLOW ERROR] Error building workflow for overrides:",
      overrides,
      "Error:",
      err,
    );
    throw err;
  }
}

module.exports = SDXLImageToImageWorkflow;

