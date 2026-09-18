"use strict";

const path = require("path");
const fs = require("fs");
const { durationSecondsToLtxFrames } = require("../_ltx-duration.js");
const { resolvePromptMagic } = require("../_ltx-prompt-magic.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_5_t2a.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_DURATION_SECONDS = 5;

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.5 text-to-audio (soundscape / SFX). Local-only graph.
 *
 * Overrides: prompt, negativePrompt, seed, durationSeconds, fps,
 * promptMagic, diffusionModelComfyName.
 */
function Ltx25Text2AudioWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  // Graph default is off; video LTX defaults on.
  const promptMagic = resolvePromptMagic(
    overrides.promptMagic ?? overrides.prompt_magic,
    false,
  );

  if (overrides.prompt !== undefined && workflow["6"]?.inputs) {
    workflow["6"].inputs.value = String(overrides.prompt ?? "");
  }
  if (overrides.negativePrompt !== undefined && workflow["7"]?.inputs) {
    workflow["7"].inputs.value = String(overrides.negativePrompt ?? "");
  }
  if (workflow["2:5556"]?.inputs) {
    workflow["2:5556"].inputs.switch = promptMagic;
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["4:5566"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["4:5566"]?.inputs) {
    workflow["4:5566"].inputs.noise_seed = seed;
  }
  if (seed !== undefined && workflow["2:5549"]?.inputs) {
    workflow["2:5549"].inputs["sampling_mode.seed"] = seed;
  }

  const defaultFps = workflow["10"]?.inputs?.value;
  const fps =
    overrides.fps !== undefined
      ? toPositiveInt(overrides.fps, defaultFps)
      : defaultFps;
  if (fps !== undefined && workflow["10"]?.inputs) {
    workflow["10"].inputs.value = fps;
  }

  const durationSeconds = toNumber(
    overrides.durationSeconds ?? overrides.duration_seconds,
    workflow["11"]?.inputs?.value ?? DEFAULT_DURATION_SECONDS,
  );
  if (workflow["11"]?.inputs) {
    workflow["11"].inputs.value = durationSeconds;
  }

  const lengthFrames = durationSecondsToLtxFrames(
    durationSeconds,
    Number(fps) > 0 ? Number(fps) : 24,
  );
  if (workflow["2:4988"]?.inputs) {
    workflow["2:4988"].inputs.value = lengthFrames;
  }

  if (overrides.diffusionModelComfyName && workflow["1:28"]?.inputs) {
    workflow["1:28"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = Ltx25Text2AudioWorkflow;
