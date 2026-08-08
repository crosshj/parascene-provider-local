"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_3_style_transition.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_DURATION_SECONDS = 6;

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.3 style transition (flf + transition LoRA).
 */
function LtxStyleTransitionWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputImageFilename && workflow["138"]?.inputs) {
    workflow["138"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.endImageFilename && workflow["137"]?.inputs) {
    workflow["137"].inputs.image = String(overrides.endImageFilename);
  }
  if (workflow["139:128"]?.inputs && overrides.prompt !== undefined) {
    workflow["139:128"].inputs.text = String(overrides.prompt ?? "");
  }
  if (workflow["139:112"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["139:112"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["139:100"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["139:100"]?.inputs) {
    workflow["139:100"].inputs.noise_seed = seed;
  }

  if (overrides.width !== undefined && workflow["139:113"]?.inputs) {
    workflow["139:113"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["139:113"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["139:98"]?.inputs) {
    workflow["139:98"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["139:98"].inputs.value,
    );
  }

  const fps =
    overrides.fps !== undefined
      ? toPositiveInt(overrides.fps, workflow["139:114"]?.inputs?.value)
      : workflow["139:114"]?.inputs?.value ?? 25;
  if (workflow["139:114"]?.inputs) workflow["139:114"].inputs.value = fps;

  const duration = toNumber(
    overrides.durationSeconds,
    DEFAULT_DURATION_SECONDS,
  );
  if (workflow["139:143"]?.inputs) {
    workflow["139:143"].inputs.value = Math.max(1, Math.round(duration));
  }

  const ckpt =
    overrides.checkpointBasename &&
    String(overrides.checkpointBasename).trim();
  if (ckpt && workflow["139:127"]?.inputs) {
    workflow["139:127"].inputs.ckpt_name = ckpt;
  }

  return workflow;
}

module.exports = LtxStyleTransitionWorkflow;
