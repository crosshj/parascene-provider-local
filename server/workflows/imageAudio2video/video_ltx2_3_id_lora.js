"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "video_ltx2_3_id_lora.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.3 ID-LoRA talkvid (identity image + audio).
 */
function LtxIdLoraWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputImageFilename && workflow["269"]?.inputs) {
    workflow["269"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.inputAudioFilename && workflow["276"]?.inputs) {
    workflow["276"].inputs.audio = String(overrides.inputAudioFilename);
  }
  if (workflow["340:319"]?.inputs && overrides.prompt !== undefined) {
    workflow["340:319"].inputs.value = String(overrides.prompt ?? "");
  }
  if (workflow["340:314"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["340:314"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["340:285"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined) {
    if (workflow["340:285"]?.inputs) workflow["340:285"].inputs.noise_seed = seed;
    if (workflow["340:286"]?.inputs)
      workflow["340:286"].inputs.noise_seed = seed + 1;
  }

  if (overrides.width !== undefined && workflow["340:330"]?.inputs) {
    workflow["340:330"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["340:330"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["340:324"]?.inputs) {
    workflow["340:324"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["340:324"].inputs.value,
    );
  }

  const ckpt =
    overrides.checkpointBasename &&
    String(overrides.checkpointBasename).trim();
  if (ckpt && workflow["340:317"]?.inputs) {
    workflow["340:317"].inputs.ckpt_name = ckpt;
  }

  return workflow;
}

module.exports = LtxIdLoraWorkflow;
