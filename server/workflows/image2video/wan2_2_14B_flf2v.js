"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "wan2_2_14B_flf2v.json"), "utf8"),
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
  if (workflow["129:96"]?.inputs) workflow["129:96"].inputs.unet_name = low;
  if (workflow["129:95"]?.inputs) workflow["129:95"].inputs.unet_name = high;
}

/**
 * Wan 2.2 first/last-frame image-to-video (template wan2_2_14B_flf2v.json).
 *
 * Overrides: prompt, negativePrompt, seed, inputImageFilename, endImageFilename,
 * width, height, fps, length/frames, durationSeconds, steps, cfg,
 * diffusionModelComfyName.
 */
function WanFlf2vWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputImageFilename && workflow["97"]?.inputs) {
    workflow["97"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.endImageFilename && workflow["99"]?.inputs) {
    workflow["99"].inputs.image = String(overrides.endImageFilename);
  }

  if (workflow["129:93"]?.inputs) {
    workflow["129:93"].inputs.text = overrides.prompt ?? "";
  }
  if (workflow["129:89"]?.inputs) {
    workflow["129:89"].inputs.text = overrides.negativePrompt ?? "";
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["129:86"]?.inputs?.noise_seed)
      : workflow["129:86"]?.inputs?.noise_seed;
  if (workflow["129:86"]?.inputs && seed !== undefined) {
    workflow["129:86"].inputs.noise_seed = seed;
  }
  if (workflow["129:85"]?.inputs && seed !== undefined) {
    workflow["129:85"].inputs.noise_seed = seed;
  }

  if (overrides.width !== undefined && workflow["129:98"]?.inputs) {
    workflow["129:98"].inputs.width = toPositiveInt(
      overrides.width,
      workflow["129:98"].inputs.width,
    );
  }
  if (overrides.height !== undefined && workflow["129:98"]?.inputs) {
    workflow["129:98"].inputs.height = toPositiveInt(
      overrides.height,
      workflow["129:98"].inputs.height,
    );
  }

  const defaultFps = workflow["129:94"]?.inputs?.fps ?? 16;
  const fps =
    overrides.fps !== undefined
      ? toNumber(overrides.fps, defaultFps)
      : defaultFps;
  if (workflow["129:94"]?.inputs && fps !== undefined) {
    workflow["129:94"].inputs.fps = fps;
  }

  const explicitLength =
    overrides.length ?? overrides.framesNumber ?? overrides.frames;
  if (explicitLength !== undefined && workflow["129:98"]?.inputs) {
    workflow["129:98"].inputs.length = toPositiveInt(
      explicitLength,
      workflow["129:98"].inputs.length,
    );
  } else if (
    overrides.durationSeconds !== undefined &&
    workflow["129:98"]?.inputs
  ) {
    const frames = Math.max(
      1,
      Math.round(
        toNumber(overrides.durationSeconds, 0) * (Number(fps) > 0 ? fps : 16),
      ),
    );
    if (frames > 0) workflow["129:98"].inputs.length = frames;
  }

  if (overrides.steps !== undefined && workflow["129:128"]?.inputs) {
    workflow["129:128"].inputs.value = toPositiveInt(
      overrides.steps,
      workflow["129:128"].inputs.value,
    );
  }
  if (overrides.steps !== undefined && workflow["129:118"]?.inputs) {
    workflow["129:118"].inputs.value = toPositiveInt(
      overrides.steps,
      workflow["129:118"].inputs.value,
    );
  }

  if (overrides.cfg !== undefined && workflow["129:126"]?.inputs) {
    workflow["129:126"].inputs.value = toNumber(
      overrides.cfg,
      workflow["129:126"].inputs.value,
    );
  }
  if (overrides.cfg !== undefined && workflow["129:122"]?.inputs) {
    workflow["129:122"].inputs.value = toNumber(
      overrides.cfg,
      workflow["129:122"].inputs.value,
    );
  }

  patchWanUnetPair(workflow, overrides.diffusionModelComfyName);

  return workflow;
}

module.exports = WanFlf2vWorkflow;
