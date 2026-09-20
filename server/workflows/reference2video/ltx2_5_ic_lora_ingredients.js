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
 * LTX 2.5 IC-LoRA ingredients (character/prop sheet → video). Local-only.
 *
 * Uses core `LoraLoaderModelOnly` + `GetICLoRAParameters` + `LTXVAddGuide`
 * (same path as the 2.3 ingredients graph) instead of ComfyUI-LTXVideo's
 * `LTXICLoRALoaderModelOnly` / `LTXAddVideoICLoRAGuide`, which many workers
 * do not have installed.
 */
function Ltx25IcLoraIngredientsWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  const imageName =
    overrides.inputImageFilename ||
    (Array.isArray(overrides.inputImageFilenames)
      ? overrides.inputImageFilenames[0]
      : null);
  if (imageName && workflow["2004"]?.inputs) {
    workflow["2004"].inputs.image = String(imageName);
  }

  if (workflow["5508"]?.inputs && overrides.prompt !== undefined) {
    workflow["5508"].inputs.value = String(overrides.prompt ?? "");
  }
  if (workflow["5509"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["5509"].inputs.value = String(overrides.negativePrompt ?? "");
  }

  if (overrides.width !== undefined && workflow["9002:3059"]?.inputs) {
    workflow["9002:3059"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["9002:3059"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["9002:3059"]?.inputs) {
    workflow["9002:3059"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["9002:3059"].inputs.height,
    );
  }

  applyLtxDuration(workflow, overrides, {
    durationNodeId: "9008",
    fpsNodeId: "9007",
    lengthTargets: [
      { id: "9002:3059", field: "length" },
      { id: "9002:9012", field: "amount" },
      { id: "9002:9009", field: "frames_number" },
      { id: "5014:4988", field: "value" },
    ],
  });

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["5516:9017"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["5516:9017"]?.inputs) {
    workflow["5516:9017"].inputs.noise_seed = seed;
  }

  if (overrides.diffusionModelComfyName && workflow["5004:5602"]?.inputs) {
    workflow["5004:5602"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = Ltx25IcLoraIngredientsWorkflow;
