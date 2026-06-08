"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_3_t2v.json"), "utf8"),
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
 * LTX 2.3 text-to-video workflow (template ltx2_3_t2v.json).
 *
 * Overrides: prompt, negativePrompt, seed, width, height, fps, length,
 * durationSeconds,
 * checkpointBasename (node "320" ckpt_name).
 *
 * Node map:
 *   "322" - PrimitiveStringMultiline (prompt)
 *   "317" - CLIPTextEncode (negative)
 *   "316" - PrimitiveInt (Width)
 *   "303" - PrimitiveInt (Height)
 *   "304" - PrimitiveInt (Frame Rate)
 *   "305" - PrimitiveInt (Length)
 *   "280" - RandomNoise (seed pass 1)
 *   "281" - RandomNoise (seed pass 2)
 *   "306" - PrimitiveBoolean (Switch to Text to Video?) — kept true
 *   "320" - CheckpointLoaderSimple (ckpt_name)
 */
function LtxText2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.checkpointBasename && workflow["320"]?.inputs) {
    workflow["320"].inputs.ckpt_name = String(overrides.checkpointBasename);
  }

  if (workflow["322"]?.inputs) {
    workflow["322"].inputs.value =
      overrides.prompt !== undefined
        ? String(overrides.prompt)
        : workflow["322"].inputs.value;
  }

  if (workflow["317"]?.inputs) {
    workflow["317"].inputs.text =
      overrides.negativePrompt !== undefined
        ? String(overrides.negativePrompt)
        : workflow["317"].inputs.text;
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["280"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined) {
    if (workflow["280"]?.inputs) workflow["280"].inputs.noise_seed = seed;
    if (workflow["281"]?.inputs) workflow["281"].inputs.noise_seed = seed + 1;
  }

  if (overrides.width !== undefined && workflow["316"]?.inputs) {
    workflow["316"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["316"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["303"]?.inputs) {
    workflow["303"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["303"].inputs.value,
    );
  }

  const defaultFps = workflow["304"]?.inputs?.value;
  const fps =
    overrides.fps !== undefined
      ? toPositiveInt(overrides.fps, defaultFps)
      : defaultFps;
  if (fps !== undefined && workflow["304"]?.inputs) {
    workflow["304"].inputs.value = fps;
  }

  const explicitLength =
    overrides.length ?? overrides.framesNumber ?? overrides.frames;
  const lengthFrames =
    explicitLength !== undefined
      ? toPositiveInt(explicitLength, workflow["305"]?.inputs?.value)
      : Math.max(
          1,
          Math.round(
            toNumber(overrides.durationSeconds, DEFAULT_DURATION_SECONDS) * fps,
          ),
        );
  if (lengthFrames !== undefined && workflow["305"]?.inputs) {
    workflow["305"].inputs.value = lengthFrames;
  }

  return workflow;
}

module.exports = LtxText2VideoWorkflow;
