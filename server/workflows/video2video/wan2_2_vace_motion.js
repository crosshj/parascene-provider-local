"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "wan2_2_vace_motion.json"), "utf8"),
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

function patchWanUnetPair(workflow, diffusionModelComfyName) {
  const dn = diffusionModelComfyName;
  if (!dn || typeof dn !== "string") return;
  let low = dn;
  let high = dn;
  if (dn.includes("low_noise")) {
    high = dn.replace(/low_noise/g, "high_noise");
  } else if (dn.includes("high_noise")) {
    low = dn.replace(/high_noise/g, "low_noise");
  } else {
    return;
  }
  if (workflow["21"]?.inputs) workflow["21"].inputs.unet_name = low;
  if (workflow["20"]?.inputs) workflow["20"].inputs.unet_name = high;
}

/**
 * Wan 2.2 Fun VACE motion transfer (control video + character reference image).
 *
 * Overrides: prompt, negativePrompt, seed, inputVideoFilename, inputImageFilename,
 * width, height, fps, length/frames, durationSeconds, steps, cfg, strength,
 * diffusionModelComfyName.
 */
function WanVaceMotionTransferWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputVideoFilename && workflow["10"]?.inputs) {
    workflow["10"].inputs.file = String(overrides.inputVideoFilename);
  }
  if (overrides.inputImageFilename && workflow["12"]?.inputs) {
    workflow["12"].inputs.image = String(overrides.inputImageFilename);
  }

  if (workflow["30"]?.inputs) {
    workflow["30"].inputs.text = overrides.prompt ?? "";
  }
  if (workflow["31"]?.inputs) {
    workflow["31"].inputs.text = overrides.negativePrompt ?? "";
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["60"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined) {
    if (workflow["60"]?.inputs) workflow["60"].inputs.noise_seed = seed;
    if (workflow["61"]?.inputs) workflow["61"].inputs.noise_seed = seed;
  }

  if (overrides.width !== undefined && workflow["40"]?.inputs) {
    workflow["40"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["40"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["40"]?.inputs) {
    workflow["40"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["40"].inputs.height,
    );
  }

  if (overrides.strength !== undefined && workflow["40"]?.inputs) {
    workflow["40"].inputs.strength = toNumber(
      overrides.strength,
      workflow["40"].inputs.strength,
    );
  }

  const defaultFps = workflow["90"]?.inputs?.fps ?? 16;
  const fps =
    overrides.fps !== undefined
      ? toNumber(overrides.fps, defaultFps)
      : defaultFps;
  if (workflow["90"]?.inputs && fps !== undefined) {
    workflow["90"].inputs.fps = fps;
  }

  const explicitLength =
    overrides.length ?? overrides.framesNumber ?? overrides.frames;
  if (explicitLength !== undefined && workflow["40"]?.inputs) {
    workflow["40"].inputs.length = toPositiveInt(
      explicitLength,
      workflow["40"].inputs.length,
    );
  } else if (
    overrides.durationSeconds !== undefined &&
    workflow["40"]?.inputs
  ) {
    const frames = Math.max(
      1,
      Math.round(
        toNumber(overrides.durationSeconds, 0) * (Number(fps) > 0 ? fps : 16),
      ),
    );
    if (frames > 0) workflow["40"].inputs.length = frames;
  }

  if (overrides.steps !== undefined) {
    const steps = toPositiveInt(overrides.steps, 20);
    const split = Math.max(1, Math.floor(steps / 2));
    if (workflow["60"]?.inputs) {
      workflow["60"].inputs.steps = steps;
      workflow["60"].inputs.end_at_step = split;
    }
    if (workflow["61"]?.inputs) {
      workflow["61"].inputs.steps = steps;
      workflow["61"].inputs.start_at_step = split;
      workflow["61"].inputs.end_at_step = steps;
    }
  }

  if (overrides.cfg !== undefined) {
    const cfg = toNumber(overrides.cfg, 3.5);
    if (workflow["60"]?.inputs) workflow["60"].inputs.cfg = cfg;
    if (workflow["61"]?.inputs) workflow["61"].inputs.cfg = cfg;
  }

  patchWanUnetPair(workflow, overrides.diffusionModelComfyName);

  return workflow;
}

module.exports = WanVaceMotionTransferWorkflow;
