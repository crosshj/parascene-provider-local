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
 * useStartingImage, promptMagic, width, height, fps, durationSeconds/duration_seconds,
 * checkpointBasename.
 *
 * Node map:
 *   "269" - LoadImage
 *   "276" - LoadAudio
 *   "340:305" - PrimitiveBoolean (Switch to Text to Video?)
 *   "340:319" - PrimitiveStringMultiline (prompt)
 *   "340:342" - TextGenerate (prompt magic)
 *   "340:348" - ComfySwitchNode (raw vs enhanced)
 *   "340:349" - PrimitiveBoolean (Prompt Magic)
 *   "340:306" - CLIPTextEncode (positive)
 *   "340:314" - CLIPTextEncode (negative)
 *   "340:330" - PrimitiveInt (Width)
 *   "340:324" - PrimitiveInt (Height)
 *   "340:323" - PrimitiveInt (Frame Rate)
 *   "340:331" - PrimitiveFloat (Duration seconds) → TrimAudioDuration
 *   "340:302" - EmptyLTXVLatentVideo (length baked as duration×fps+1)
 *   "340:285" / "340:286" - RandomNoise (seed)
 *   "340:317" - CheckpointLoaderSimple (ckpt_name)
 */
function LtxAudio2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  // useStartingImage true = audio-only (Comfy toggle true); false = image+audio path.
  const switchToTextToVideo = overrides.useStartingImage === true;
  const userPrompt =
    overrides.prompt !== undefined && overrides.prompt !== null
      ? String(overrides.prompt)
      : workflow["340:319"]?.inputs?.value ?? "";

  if (workflow["340:305"]?.inputs) {
    workflow["340:305"].inputs.value = switchToTextToVideo;
  }

  // Audio-only: no real first frame → skip I2V prompt magic (use raw prompt).
  // Image+audio: default magic on; override via promptMagic / prompt_magic.
  const promptMagic = switchToTextToVideo
    ? false
    : resolvePromptMagic(
        overrides.promptMagic ?? overrides.prompt_magic,
        true,
      );

  if (workflow["340:349"]?.inputs) {
    workflow["340:349"].inputs.value = promptMagic;
  }

  if (workflow["340:306"]?.inputs) {
    // Prefer direct wiring so TextGenerate is not executed when magic is off.
    workflow["340:306"].inputs.text = promptMagic
      ? ["340:342", 0]
      : ["340:319", 0];
  }

  if (workflow["340:343"]?.inputs) {
    workflow["340:343"].inputs.source = promptMagic
      ? ["340:342", 0]
      : ["340:319", 0];
  }

  if (promptMagic && workflow["340:342"]?.inputs) {
    // IA2V-specific enhance: lip-sync to supplied audio; don't invent competing dialogue/music.
    workflow["340:342"].inputs.prompt = formatLtx2TextGeneratePrompt(
      userPrompt,
      { mode: "ia2v" },
    );
    workflow["340:342"].inputs.use_default_template = false;
    workflow["340:342"].inputs.max_length = TEXT_GENERATE_MAX_LENGTH;
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
    workflow["340:319"].inputs.value = userPrompt;
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
  if (
    seed !== undefined &&
    promptMagic &&
    workflow["340:342"]?.inputs &&
    Object.prototype.hasOwnProperty.call(
      workflow["340:342"].inputs,
      "sampling_mode.seed",
    )
  ) {
    workflow["340:342"].inputs["sampling_mode.seed"] = seed;
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

  // Prefer camelCase (comfy payload) but accept snake_case if a caller bypasses buildComfyArgs.
  const durationSeconds = toNumber(
    overrides.durationSeconds ?? overrides.duration_seconds,
    workflow["340:331"]?.inputs?.value ?? DEFAULT_DURATION_SECONDS,
  );
  if (workflow["340:331"]?.inputs) {
    workflow["340:331"].inputs.value = durationSeconds;
  }

  // Bake latent frame count directly (duration × fps + 1). Relying only on the
  // Duration→MathExpression link left Blue producing ~9s video while audio was
  // already a 3s clip — set length explicitly like the i2v LTX builder.
  const lengthFrames = durationSecondsToLtxFrames(
    durationSeconds,
    Number(fps) > 0 ? Number(fps) : 24,
  );
  if (workflow["340:302"]?.inputs) {
    workflow["340:302"].inputs.length = lengthFrames;
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
