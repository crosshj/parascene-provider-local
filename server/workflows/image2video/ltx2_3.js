"use strict";

const path = require("path");
const fs = require("fs");
const {
  formatLtx2TextGeneratePrompt,
  resolvePromptMagic,
} = require("../_ltx-prompt-magic.js");
const { durationSecondsToLtxFrames } = require("../_ltx-duration.js");

/** Match TextGenerateLTX2Prompt template budget; keep image-conditioned TextGenerate. */
const TEXT_GENERATE_MAX_LENGTH = 2048;

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_3.json"), "utf8"),
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
 * LTX 2.3 image-to-video workflow (template ltx2_3.json).
 *
 * Overrides: prompt, negativePrompt, seed, inputImageFilename,
 * promptMagic, width, height, fps, length/framesNumber, durationSeconds,
 * checkpointBasename (checkpoint loader ckpt_name fields).
 *
 * Node map:
 *   "287" - LoadImage
 *   "267:266" - PrimitiveStringMultiline (prompt)
 *   "267:274" - TextGenerate (prompt magic)
 *   "267:276" - ComfySwitchNode (raw vs enhanced)
 *   "267:277" - PrimitiveBoolean (Prompt Magic)
 *   "267:240" - CLIPTextEncode (positive)
 *   "267:247" - CLIPTextEncode (negative)
 */
function LtxImage2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const userPrompt =
    overrides.prompt !== undefined && overrides.prompt !== null
      ? String(overrides.prompt)
      : workflow["267:266"]?.inputs?.value ?? "";
  const promptMagic = resolvePromptMagic(
    overrides.promptMagic ?? overrides.prompt_magic,
    true,
  );

  if (overrides.inputImageFilename && workflow["287"]?.inputs) {
    workflow["287"].inputs.image = String(overrides.inputImageFilename);
  }

  if (workflow["267:266"]?.inputs) {
    workflow["267:266"].inputs.value = userPrompt;
  }

  if (workflow["267:277"]?.inputs) {
    workflow["267:277"].inputs.value = promptMagic;
  }

  if (workflow["267:240"]?.inputs) {
    workflow["267:240"].inputs.text = promptMagic
      ? ["267:274", 0]
      : ["267:266", 0];
  }

  if (workflow["267:275"]?.inputs) {
    workflow["267:275"].inputs.source = promptMagic
      ? ["267:274", 0]
      : ["267:266", 0];
  }

  if (promptMagic && workflow["267:274"]?.inputs) {
    workflow["267:274"].inputs.prompt = formatLtx2TextGeneratePrompt(
      userPrompt,
      { mode: "i2v" },
    );
    workflow["267:274"].inputs.use_default_template = false;
    workflow["267:274"].inputs.max_length = TEXT_GENERATE_MAX_LENGTH;
  }

  if (workflow["267:247"]?.inputs) {
    workflow["267:247"].inputs.text =
      overrides.negativePrompt !== undefined
        ? String(overrides.negativePrompt ?? "")
        : workflow["267:247"].inputs.text;
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["267:216"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["267:216"]?.inputs) {
    workflow["267:216"].inputs.noise_seed = seed;
  }
  if (seed !== undefined && workflow["267:237"]?.inputs) {
    workflow["267:237"].inputs.noise_seed = seed + 1;
  }
  if (
    seed !== undefined &&
    promptMagic &&
    workflow["267:274"]?.inputs &&
    Object.prototype.hasOwnProperty.call(
      workflow["267:274"].inputs,
      "sampling_mode.seed",
    )
  ) {
    workflow["267:274"].inputs["sampling_mode.seed"] = seed;
  }

  if (overrides.width !== undefined && workflow["267:257"]?.inputs) {
    workflow["267:257"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["267:257"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["267:258"]?.inputs) {
    workflow["267:258"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["267:258"].inputs.value,
    );
  }

  const defaultFps = workflow["267:260"]?.inputs?.value;
  const fps =
    overrides.fps !== undefined
      ? toPositiveInt(overrides.fps, defaultFps)
      : defaultFps;
  if (fps !== undefined && workflow["267:260"]?.inputs) {
    workflow["267:260"].inputs.value = fps;
  }

  const explicitLength =
    overrides.length ?? overrides.framesNumber ?? overrides.frames;
  const lengthFrames =
    explicitLength !== undefined
      ? toPositiveInt(explicitLength, workflow["267:225"]?.inputs?.value)
      : durationSecondsToLtxFrames(
          toNumber(overrides.durationSeconds, DEFAULT_DURATION_SECONDS),
          fps,
        );
  if (lengthFrames !== undefined && workflow["267:225"]?.inputs) {
    workflow["267:225"].inputs.value = lengthFrames;
  }

  const ckpt =
    overrides.checkpointBasename &&
    String(overrides.checkpointBasename).trim();
  if (ckpt) {
    if (workflow["267:236"]?.inputs) {
      workflow["267:236"].inputs.ckpt_name = ckpt;
    }
    if (workflow["267:243"]?.inputs) {
      workflow["267:243"].inputs.ckpt_name = ckpt;
    }
  }

  return workflow;
}

module.exports = LtxImage2VideoWorkflow;
