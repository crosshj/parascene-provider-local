"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "wan2_2_14B.json"), "utf8"),
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
 * Wan 2.2 image-to-video workflow (template wan2_2_14B.json).
 *
 * Overrides: prompt, negativePrompt, seed, inputImageFilename,
 * width, height, fps, steps, cfg, diffusionModelComfyName (WAN dual UNET pair).
 */
function WanImage2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (
    overrides.inputImageFilename &&
    workflow["97"]?.inputs
  ) {
    workflow["97"].inputs.image = String(overrides.inputImageFilename);
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

  if (overrides.fps !== undefined && workflow["129:94"]?.inputs) {
    workflow["129:94"].inputs.fps = toNumber(
      overrides.fps,
      workflow["129:94"].inputs.fps,
    );
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

module.exports = WanImage2VideoWorkflow;
