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

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveSliceDurationSeconds(
  overrides,
  fps,
  explicitLength,
  fallbackSeconds,
) {
  if (overrides.durationSeconds !== undefined) {
    const fromDuration = toNumber(overrides.durationSeconds, 0);
    if (fromDuration > 0) return fromDuration;
  }
  if (explicitLength !== undefined) {
    const frames = toPositiveInt(explicitLength, 0);
    const useFps = Number(fps) > 0 ? Number(fps) : 25;
    if (frames > 0 && useFps > 0) {
      return frames / useFps;
    }
  }
  return fallbackSeconds;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.3 IC-LoRA video control (video + optional start image).
 *
 * Overrides: prompt, negativePrompt, inputVideoFilename, inputImageFilename,
 * width, height, durationSeconds, length/framesNumber/frames, checkpointBasename.
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

  const explicitLength =
    overrides.length ?? overrides.framesNumber ?? overrides.frames;
  const defaultFps = toNumber(workflow["129:114"]?.inputs?.value, 25);
  if (workflow["692"]?.inputs) {
    const fallbackSliceDuration = toNumber(workflow["692"].inputs.duration, 5);
    workflow["692"].inputs.duration = resolveSliceDurationSeconds(
      overrides,
      defaultFps,
      explicitLength,
      fallbackSliceDuration,
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
