"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "video_ltx2_3_ia2v.json"), "utf8"),
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
 * LTX 2.3 image+audio-to-video workflow (template video_ltx2_3_ia2v.json).
 *
 * Overrides: prompt, negativePrompt, seed, inputImageFilename, inputAudioFilename,
 * useStartingImage, width, height, fps, durationSeconds, checkpointBasename.
 *
 * Node map:
 *   "269" - LoadImage
 *   "276" - LoadAudio
 *   "340:305" - PrimitiveBoolean (Switch to Text to Video?)
 *   "340:319" - PrimitiveStringMultiline (prompt)
 *   "340:314" - CLIPTextEncode (negative)
 *   "340:330" - PrimitiveInt (Width)
 *   "340:324" - PrimitiveInt (Height)
 *   "340:323" - PrimitiveInt (Frame Rate)
 *   "340:331" - PrimitiveFloat (Duration seconds)
 *   "340:285" / "340:286" - RandomNoise (seed)
 *   "340:317" - CheckpointLoaderSimple (ckpt_name)
 */
function LtxAudio2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  // useStartingImage true = audio-only (Comfy toggle true); false = image+audio path.
  const switchToTextToVideo = overrides.useStartingImage === true;

  if (workflow["340:305"]?.inputs) {
    workflow["340:305"].inputs.value = switchToTextToVideo;
  }

  // Audio-only path: bypass TextGenerateLTX2Prompt (which requires LoadImage) and
  // encode the user prompt directly, matching ltx2_3_t2v behavior.
  if (switchToTextToVideo && workflow["340:306"]?.inputs) {
    workflow["340:306"].inputs.text = ["340:319", 0];
  }

  // Comfy validates LoadImage on every prompt; patch user image or placeholder.
  if (overrides.inputImageFilename && workflow["269"]?.inputs) {
    workflow["269"].inputs.image = String(overrides.inputImageFilename);
  }

  if (overrides.inputAudioFilename && workflow["276"]?.inputs) {
    workflow["276"].inputs.audio = String(overrides.inputAudioFilename);
    delete workflow["276"].inputs.audioUI;
  }

  if (workflow["340:319"]?.inputs) {
    workflow["340:319"].inputs.value =
      overrides.prompt !== undefined && overrides.prompt !== null
        ? String(overrides.prompt)
        : workflow["340:319"].inputs.value;
  }

  if (workflow["340:314"]?.inputs) {
    workflow["340:314"].inputs.text =
      overrides.negativePrompt !== undefined
        ? String(overrides.negativePrompt ?? "")
        : workflow["340:314"].inputs.text;
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["340:285"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["340:285"]?.inputs) {
    workflow["340:285"].inputs.noise_seed = seed;
  }
  if (seed !== undefined && workflow["340:286"]?.inputs) {
    workflow["340:286"].inputs.noise_seed = seed + 1;
  }

  if (overrides.width !== undefined && workflow["340:330"]?.inputs) {
    workflow["340:330"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["340:330"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["340:324"]?.inputs) {
    workflow["340:324"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["340:324"].inputs.value,
    );
  }

  const defaultFps = workflow["340:323"]?.inputs?.value;
  const fps =
    overrides.fps !== undefined
      ? toPositiveInt(overrides.fps, defaultFps)
      : defaultFps;
  if (fps !== undefined && workflow["340:323"]?.inputs) {
    workflow["340:323"].inputs.value = fps;
  }

  const durationSeconds = toNumber(
    overrides.durationSeconds,
    workflow["340:331"]?.inputs?.value ?? DEFAULT_DURATION_SECONDS,
  );
  if (workflow["340:331"]?.inputs) {
    workflow["340:331"].inputs.value = durationSeconds;
  }

  const ckpt =
    overrides.checkpointBasename &&
    String(overrides.checkpointBasename).trim();
  if (ckpt) {
    if (workflow["340:317"]?.inputs) {
      workflow["340:317"].inputs.ckpt_name = ckpt;
    }
    if (workflow["340:318"]?.inputs) {
      workflow["340:318"].inputs.ckpt_name = ckpt;
    }
  }

  return workflow;
}

module.exports = LtxAudio2VideoWorkflow;
