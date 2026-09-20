"use strict";

const path = require("path");
const fs = require("fs");
const { applyLtxDuration } = require("../_ltx-duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "ltx2_5_ic_lora_ingredients.json"),
    "utf8",
  ),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.5 IC-LoRA ingredients (character/prop sheet → video).
 *
 * Topology matches the working 2.3 ingredients graph (resize → repeat sheet →
 * LTXVAddGuide + GetICLoRAParameters) and the working 2.5 t2v loaders/sampler
 * (int8 convrot UNET/CLIP, DualCFG, ManualSigmas). Avoids ComfyUI-LTXVideo
 * custom nodes that this worker does not have.
 */
function Ltx25IcLoraIngredientsWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  const imageName =
    overrides.inputImageFilename ||
    (Array.isArray(overrides.inputImageFilenames)
      ? overrides.inputImageFilenames[0]
      : null);
  if (imageName && workflow["1"]?.inputs) {
    workflow["1"].inputs.image = String(imageName);
  }

  if (workflow["8"]?.inputs && overrides.prompt !== undefined) {
    workflow["8"].inputs.value = String(overrides.prompt ?? "");
  }
  if (workflow["9"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["9"].inputs.value = String(overrides.negativePrompt ?? "");
  }

  const width = toPositiveInt(overrides.width, workflow["17"]?.inputs?.width);
  const height = toPositiveInt(overrides.height, workflow["17"]?.inputs?.height);
  if (overrides.width !== undefined || overrides.height !== undefined) {
    if (workflow["17"]?.inputs) {
      workflow["17"].inputs.width = width;
      workflow["17"].inputs.height = height;
    }
    if (workflow["15"]?.inputs) {
      workflow["15"].inputs.target_width = width;
      workflow["15"].inputs.target_height = height;
    }
  }

  applyLtxDuration(workflow, overrides, {
    durationNodeId: "14",
    fpsNodeId: "13",
    lengthTargets: [
      { id: "17", field: "length" },
      { id: "16", field: "amount" },
      { id: "18", field: "frames_number" },
    ],
  });

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["21"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["21"]?.inputs) {
    workflow["21"].inputs.noise_seed = seed;
  }

  if (overrides.diffusionModelComfyName && workflow["3"]?.inputs) {
    workflow["3"].inputs.unet_name = String(overrides.diffusionModelComfyName);
  }

  return workflow;
}

module.exports = Ltx25IcLoraIngredientsWorkflow;
