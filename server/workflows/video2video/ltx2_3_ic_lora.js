"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_3_ic_lora.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.3 IC-LoRA video control (video + optional start image).
 */
function LtxIcLoraWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputVideoFilename && workflow["199"]?.inputs) {
    workflow["199"].inputs.file = String(overrides.inputVideoFilename);
  }
  if (overrides.inputImageFilename && workflow["200"]?.inputs) {
    workflow["200"].inputs.image = String(overrides.inputImageFilename);
  }

  const promptNode = workflow["129:209"] || workflow["129:128"];
  if (promptNode?.inputs && overrides.prompt !== undefined) {
    if ("prompt" in promptNode.inputs) {
      promptNode.inputs.prompt = String(overrides.prompt ?? "");
    } else if ("text" in promptNode.inputs) {
      promptNode.inputs.text = String(overrides.prompt ?? "");
    }
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

  const ckpt =
    overrides.checkpointBasename &&
    String(overrides.checkpointBasename).trim();
  if (ckpt && workflow["129:127"]?.inputs) {
    workflow["129:127"].inputs.ckpt_name = ckpt;
  }

  return workflow;
}

module.exports = LtxIcLoraWorkflow;
