"use strict";

const path = require("path");
const fs = require("fs");
const { durationSecondsToLtxFrames } = require("../_ltx-duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_3_flf2v.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_DURATION_SECONDS = 9;

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.3 first/last-frame image-to-video (template ltx2_3_flf2v.json).
 *
 * Overrides: prompt, negativePrompt, seed, inputImageFilename, endImageFilename,
 * width, height, fps, length/framesNumber, durationSeconds, checkpointBasename.
 */
function LtxFlf2vWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputImageFilename && workflow["31"]?.inputs) {
    workflow["31"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.endImageFilename && workflow["39"]?.inputs) {
    workflow["39"].inputs.image = String(overrides.endImageFilename);
  }

  if (workflow["128"]?.inputs) {
    workflow["128"].inputs.text =
      overrides.prompt !== undefined && overrides.prompt !== null
        ? String(overrides.prompt)
        : workflow["128"].inputs.text;
  }

  if (workflow["112"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["112"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["100"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["100"]?.inputs) {
    workflow["100"].inputs.noise_seed = seed;
  }

  if (overrides.width !== undefined && workflow["113"]?.inputs) {
    workflow["113"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["113"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["98"]?.inputs) {
    workflow["98"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["98"].inputs.value,
    );
  }

  const defaultFps = workflow["114"]?.inputs?.value;
  const fps =
    overrides.fps !== undefined
      ? toPositiveInt(overrides.fps, defaultFps)
      : defaultFps;
  if (fps !== undefined && workflow["114"]?.inputs) {
    workflow["114"].inputs.value = fps;
  }

  const explicitLength =
    overrides.length ?? overrides.framesNumber ?? overrides.frames;
  const lengthFrames =
    explicitLength !== undefined
      ? toPositiveInt(explicitLength, workflow["102"]?.inputs?.value)
      : durationSecondsToLtxFrames(
          toNumber(overrides.durationSeconds, DEFAULT_DURATION_SECONDS),
          fps,
        );
  if (lengthFrames !== undefined && workflow["102"]?.inputs) {
    workflow["102"].inputs.value = lengthFrames;
  }

  const ckpt =
    overrides.checkpointBasename &&
    String(overrides.checkpointBasename).trim();
  if (ckpt) {
    if (workflow["103"]?.inputs) workflow["103"].inputs.ckpt_name = ckpt;
    if (workflow["126"]?.inputs) workflow["126"].inputs.ckpt_name = ckpt;
    if (workflow["127"]?.inputs) workflow["127"].inputs.ckpt_name = ckpt;
  }

  return workflow;
}

module.exports = LtxFlf2vWorkflow;
