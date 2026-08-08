"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "ltx2_3_ic_lora_ingredients.json"),
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
 * LTX 2.3 IC-LoRA ingredients (character/prop sheet → video).
 */
function LtxIcLoraIngredientsWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  const imageName =
    overrides.inputImageFilename ||
    (Array.isArray(overrides.inputImageFilenames)
      ? overrides.inputImageFilenames[0]
      : null);
  if (imageName && workflow["724"]?.inputs) {
    workflow["724"].inputs.image = String(imageName);
  }

  if (workflow["129:209"]?.inputs && overrides.prompt !== undefined) {
    workflow["129:209"].inputs.prompt = String(overrides.prompt ?? "");
  }
  if (workflow["129:112"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["129:112"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  if (overrides.width !== undefined && workflow["129:113"]?.inputs) {
    workflow["129:113"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["129:113"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["129:98"]?.inputs) {
    workflow["129:98"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["129:98"].inputs.value,
    );
  }

  const duration = toNumber(overrides.durationSeconds, null);
  if (duration != null && workflow["715"]?.inputs) {
    workflow["715"].inputs.value = Math.max(1, Math.round(duration));
  }

  const ckpt =
    overrides.checkpointBasename &&
    String(overrides.checkpointBasename).trim();
  if (ckpt && workflow["129:127"]?.inputs) {
    workflow["129:127"].inputs.ckpt_name = ckpt;
  }

  return workflow;
}

module.exports = LtxIcLoraIngredientsWorkflow;
