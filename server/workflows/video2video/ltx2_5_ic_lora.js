"use strict";

const path = require("path");
const fs = require("fs");
const { durationSecondsToLtxFrames } = require("../_ltx-duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_5_ic_lora.json"), "utf8"),
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
 * LTX 2.5 IC-LoRA video control (video + start image). Local-only graph.
 *
 * Overrides: prompt, negativePrompt, inputVideoFilename, inputImageFilename,
 * width, height, durationSeconds, seed, diffusionModelComfyName.
 */
function Ltx25IcLoraWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputVideoFilename && workflow["5001"]?.inputs) {
    workflow["5001"].inputs.file = String(overrides.inputVideoFilename);
  }
  if (overrides.inputImageFilename && workflow["2004"]?.inputs) {
    workflow["2004"].inputs.image = String(overrides.inputImageFilename);
  }

  if (workflow["5508"]?.inputs && overrides.prompt !== undefined) {
    workflow["5508"].inputs.value = String(overrides.prompt ?? "");
  }
  if (workflow["5509"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["5509"].inputs.value = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["5516:4832"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["5516:4832"]?.inputs) {
    workflow["5516:4832"].inputs.noise_seed = seed;
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

  const durationSeconds = toNumber(
    overrides.durationSeconds ?? overrides.duration_seconds,
    null,
  );
  if (durationSeconds != null && workflow["9002:3059"]?.inputs) {
    const fps = toNumber(overrides.fps, 24);
    workflow["9002:3059"].inputs.length = durationSecondsToLtxFrames(
      durationSeconds,
      fps,
    );
  }

  if (overrides.diffusionModelComfyName && workflow["5004:5602"]?.inputs) {
    workflow["5004:5602"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = Ltx25IcLoraWorkflow;
