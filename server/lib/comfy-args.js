// comfy-args.js
// Centralized argument builder for Comfy jobs (text2image, image2image, etc.)

const { sanitizePromptText } = require("../handlers/generate.js");
const { resolveModel } = require("../lib/model-registry.js");
const {
  downloadImagesToComfyInput,
  ensureAudio2videoPlaceholderImage,
  COMFY_INPUT_DIR,
} = require("../generator/image-input.js");
const { downloadAudioToComfyInput } = require("../generator/audio-input.js");
const { downloadVideoToComfyInput } = require("../generator/video-input.js");
const {
  getImage2videoPreset,
  getImage2imagePreset,
  getText2videoPreset,
  getAudio2videoPreset,
  getVideo2videoPreset,
  buildSyntheticImage2videoRegistryEntry,
  buildSyntheticImage2imageRegistryEntry,
  buildSyntheticText2videoRegistryEntry,
  buildSyntheticAudio2videoRegistryEntry,
  buildSyntheticVideo2videoRegistryEntry,
  IMAGE2VIDEO_MODEL_PRESETS,
  IMAGE2IMAGE_MODEL_PRESETS,
  TEXT2VIDEO_MODEL_PRESETS,
  AUDIO2VIDEO_MODEL_PRESETS,
  VIDEO2VIDEO_MODEL_PRESETS,
} = require("../configs/api-model-aliases.js");
const { _loadTemplateDefaults } = require("../workflows/_defaults.js");
const {
  resolveGenerationDimensions,
  resolveAspectRatioFromInputImage,
} = require("../lib/aspect-ratio.js");

function normalizeUrlArray(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function normalizeInputImages(body) {
  return normalizeUrlArray(body.input_images);
}

function normalizeInputAudioUrls(body) {
  return normalizeUrlArray(body.input_audio_urls);
}

function normalizeInputVideoUrls(body) {
  return normalizeUrlArray(body.input_video_urls);
}

/** Optional clip length for audio2video (seconds). */
function resolveDurationSeconds(body) {
  const raw =
    body.duration_seconds ?? body.durationSeconds ?? body.duration ?? null;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Keep within the same window the desktop editor enforces for add-asset A2V.
  return Math.min(15, Math.max(1, Math.round(n * 10) / 10));
}

function getEntryDefaults(entry) {
  if (entry?.defaults && Number.isFinite(entry.defaults.width)) {
    return entry.defaults;
  }
  const fromTemplate = _loadTemplateDefaults(entry?.managedWorkflowId);
  if (fromTemplate) return fromTemplate;
  return { width: 1024, height: 1024, steps: 20, cfg: 7 };
}

async function prepareInputImageAspectRatio(body, filename, managedWorkflowId) {
  const defaults = _loadTemplateDefaults(managedWorkflowId) || {
    width: 1024,
    height: 1024,
  };
  return resolveAspectRatioFromInputImage({
    body,
    inputFilename: filename,
    inputDir: COMFY_INPUT_DIR,
    baseWidth: defaults.width,
    baseHeight: defaults.height,
  });
}

/**
 * Build the argument payload for Comfy jobs, given user args/body and outputDir.
 * image2video / image2image use preset keys from configs/api-model-aliases.js.
 */
async function buildComfyArgs(body, outputDir) {
  const prompt = sanitizePromptText(body.prompt);
  if (!prompt) throw new Error("Missing required field: prompt");

  const method = String(body.method || "").trim() || "text2image";
  const negativePrompt = sanitizePromptText(body.negative_prompt || "");
  const seed =
    Number.isInteger(body.seed) && body.seed >= 0
      ? body.seed
      : Math.floor(Math.random() * 2_147_483_647) + 1;

  if (method === "text2video") {
    const presetKey = String(body.model || "").trim();
    if (!presetKey) throw new Error("Missing required field: model");
    const preset = getText2videoPreset(presetKey);
    if (!preset) {
      const keys = Object.keys(TEXT2VIDEO_MODEL_PRESETS).join(", ");
      throw new Error(
        `Unknown text2video model "${presetKey}". Use one of: ${keys}.`,
      );
    }
    const entry = buildSyntheticText2videoRegistryEntry(presetKey, preset);
    const defaults = { width: 768, height: 768 };
    const { width, height } = resolveGenerationDimensions(body, defaults);
    const payload = {
      family: preset.family,
      managedWorkflowId: preset.managedWorkflowId,
      modelFile: preset.modelFile,
      modelPath: preset.modelPath,
      comfyCheckpointGroup: preset.comfyCheckpointGroup,
      diffusionModelComfyName: preset.diffusionModelComfyName,
      loadKind: preset.loadKind,
      checkpointBasename: preset.checkpointBasename,
      prompt,
      negativePrompt,
      seed,
      width,
      height,
      steps: body.steps,
      cfg: body.cfg,
      fps: body.fps,
      length: body.length,
      expectVideo: true,
    };
    const durationSeconds = resolveDurationSeconds(body);
    if (durationSeconds !== undefined) {
      payload.durationSeconds = durationSeconds;
    }

    return { payload, entry, method };
  }

  if (method === "audio2video") {
    const presetKey = String(body.model || "").trim();
    if (!presetKey) throw new Error("Missing required field: model");
    const preset = getAudio2videoPreset(presetKey);
    if (!preset) {
      const keys = Object.keys(AUDIO2VIDEO_MODEL_PRESETS).join(", ");
      throw new Error(
        `Unknown audio2video model "${presetKey}". Use one of: ${keys}.`,
      );
    }
    const entry = buildSyntheticAudio2videoRegistryEntry(presetKey, preset);
    const inputAudioUrls = normalizeInputAudioUrls(body);
    if (!inputAudioUrls.length) {
      throw new Error("audio2video requires input_audio_urls to be provided.");
    }
    const audioFiles = await downloadAudioToComfyInput(inputAudioUrls);
    const [audioFilename] = audioFiles;
    if (!audioFilename) {
      throw new Error("Failed to prepare input audio for audio2video.");
    }

    const inputImages = normalizeInputImages(body);
    const hasStartingImage = inputImages.length > 0;
    let width;
    let height;
    let inputImageFilename;

    if (hasStartingImage) {
      const files = await downloadImagesToComfyInput(inputImages);
      const [filename] = files;
      if (!filename) {
        throw new Error("Failed to prepare input image for audio2video.");
      }
      const resolved = await prepareInputImageAspectRatio(
        body,
        filename,
        preset.managedWorkflowId,
      );
      width = resolved.width;
      height = resolved.height;
      inputImageFilename = resolved.inputFilename;
    } else {
      const defaults = { width: 768, height: 768 };
      ({ width, height } = resolveGenerationDimensions(body, defaults));
      inputImageFilename = await ensureAudio2videoPlaceholderImage();
    }

    const payload = {
      family: preset.family,
      managedWorkflowId: preset.managedWorkflowId,
      modelFile: preset.modelFile,
      modelPath: preset.modelPath,
      comfyCheckpointGroup: preset.comfyCheckpointGroup,
      diffusionModelComfyName: preset.diffusionModelComfyName,
      loadKind: preset.loadKind,
      checkpointBasename: preset.checkpointBasename,
      prompt,
      negativePrompt,
      seed,
      width,
      height,
      steps: body.steps,
      cfg: body.cfg,
      fps: body.fps,
      inputAudioFilename: audioFilename,
      useStartingImage: !hasStartingImage,
      promptMagic: body.prompt_magic ?? body.promptMagic,
      expectVideo: true,
    };
    if (inputImageFilename) {
      payload.inputImageFilename = inputImageFilename;
    }
    const durationSeconds = resolveDurationSeconds(body);
    if (durationSeconds !== undefined) {
      payload.durationSeconds = durationSeconds;
    }

    return { payload, entry, method };
  }

  if (method === "image2video") {
    const presetKey = String(body.model || "").trim();
    if (!presetKey) throw new Error("Missing required field: model");
    const preset = getImage2videoPreset(presetKey);
    if (!preset) {
      const keys = Object.keys(IMAGE2VIDEO_MODEL_PRESETS).join(", ");
      throw new Error(
        `Unknown image2video model "${presetKey}". Use one of: ${keys}.`,
      );
    }
    const inputImages = normalizeInputImages(body);
    if (!inputImages.length) {
      throw new Error("image2video requires input_images to be provided.");
    }
    const files = await downloadImagesToComfyInput(inputImages);
    const [filename, endFilename] = files;
    if (!filename)
      throw new Error("Failed to prepare input image for image2video.");

    const useFlf2v = Boolean(endFilename);
    let managedWorkflowId = preset.managedWorkflowId;
    if (useFlf2v) {
      if (presetKey === "ltx_i2v") {
        managedWorkflowId = "image2video-ltx2_3_flf2v";
      } else if (presetKey === "wan_i2v") {
        managedWorkflowId = "image2video-wan2_2_14B_flf2v";
      } else {
        throw new Error(
          `Model "${presetKey}" does not support an end frame. Use wan_i2v or ltx_i2v.`,
        );
      }
    }

    const entry = {
      ...buildSyntheticImage2videoRegistryEntry(presetKey, preset),
      managedWorkflowId,
    };

    const { width, height, inputFilename } =
      await prepareInputImageAspectRatio(body, filename, managedWorkflowId);

    let endImageFilename;
    if (useFlf2v) {
      const endResolved = await prepareInputImageAspectRatio(
        body,
        endFilename,
        managedWorkflowId,
      );
      endImageFilename = endResolved.inputFilename;
    }

    const payload = {
      family: preset.family,
      managedWorkflowId,
      modelFile: preset.modelFile,
      modelPath: preset.modelPath,
      comfyCheckpointGroup: preset.comfyCheckpointGroup,
      diffusionModelComfyName: preset.diffusionModelComfyName,
      loadKind: preset.loadKind,
      checkpointBasename: preset.checkpointBasename,
      prompt,
      negativePrompt,
      seed,
      width,
      height,
      steps: body.steps,
      cfg: body.cfg,
      fps: body.fps,
      length: body.length,
      inputImageFilename: inputFilename,
      // LTX i2v prompt magic (Gemma TextGenerate); ignored by Wan / flf2v builders.
      promptMagic: body.prompt_magic ?? body.promptMagic,
      expectVideo: true,
    };
    if (endImageFilename) {
      payload.endImageFilename = endImageFilename;
    }
    const durationSeconds = resolveDurationSeconds(body);
    if (durationSeconds !== undefined) {
      payload.durationSeconds = durationSeconds;
    }

    return { payload, entry, method };
  }

  if (method === "video2video") {
    const presetKey = String(body.model || "").trim();
    if (!presetKey) throw new Error("Missing required field: model");
    const preset = getVideo2videoPreset(presetKey);
    if (!preset) {
      const keys = Object.keys(VIDEO2VIDEO_MODEL_PRESETS).join(", ");
      throw new Error(
        `Unknown video2video model "${presetKey}". Use one of: ${keys}.`,
      );
    }
    const entry = buildSyntheticVideo2videoRegistryEntry(presetKey, preset);
    const inputVideoUrls = normalizeInputVideoUrls(body);
    if (!inputVideoUrls.length) {
      throw new Error("video2video requires input_video_urls to be provided.");
    }
    const videoFiles = await downloadVideoToComfyInput(inputVideoUrls);
    const [inputVideoFilename] = videoFiles;
    if (!inputVideoFilename) {
      throw new Error("Failed to prepare input video for video2video.");
    }

    const defaults = { width: 640, height: 640 };
    const { width, height } = resolveGenerationDimensions(body, defaults);
    const payload = {
      family: preset.family,
      managedWorkflowId: preset.managedWorkflowId,
      modelFile: preset.modelFile,
      modelPath: preset.modelPath,
      comfyCheckpointGroup: preset.comfyCheckpointGroup,
      diffusionModelComfyName: preset.diffusionModelComfyName,
      loadKind: preset.loadKind,
      checkpointBasename: preset.checkpointBasename,
      prompt,
      negativePrompt,
      seed,
      width,
      height,
      steps: body.steps,
      cfg: body.cfg,
      fps: body.fps,
      length: body.length,
      strength: body.strength,
      inputVideoFilename,
      expectVideo: true,
    };

    if (preset.requiresReferenceImage) {
      const inputImages = normalizeInputImages(body);
      if (!inputImages.length) {
        throw new Error(
          `video2video model "${presetKey}" requires input_images (character/reference).`,
        );
      }
      const imageFiles = await downloadImagesToComfyInput(inputImages);
      const [imageFilename] = imageFiles;
      if (!imageFilename) {
        throw new Error("Failed to prepare reference image for video2video.");
      }
      const resolved = await prepareInputImageAspectRatio(
        body,
        imageFilename,
        preset.managedWorkflowId,
      );
      payload.inputImageFilename = resolved.inputFilename;
      payload.width = resolved.width;
      payload.height = resolved.height;
    }

    const durationSeconds = resolveDurationSeconds(body);
    if (durationSeconds !== undefined) {
      payload.durationSeconds = durationSeconds;
    }

    return { payload, entry, method };
  }

  if (method === "image2image") {
    const modelKey = String(body.model || "").trim();
    if (!modelKey) throw new Error("Missing required field: model");

    const inputImages = normalizeInputImages(body);
    if (!inputImages.length) {
      throw new Error("image2image requires input_images to be provided.");
    }
    const files = await downloadImagesToComfyInput(inputImages);
    const [filename] = files;
    if (!filename)
      throw new Error("Failed to prepare input image for image2image.");

    const preset = getImage2imagePreset(modelKey);
    if (preset) {
      const entry = buildSyntheticImage2imageRegistryEntry(modelKey, preset);
      const { width, height, inputFilename } =
        await prepareInputImageAspectRatio(
          body,
          filename,
          preset.managedWorkflowId,
        );

      return {
        payload: {
          family: preset.family,
          managedWorkflowId: preset.managedWorkflowId,
          modelFile: preset.modelFile,
          modelPath: preset.modelPath,
          comfyCheckpointGroup: preset.comfyCheckpointGroup,
          diffusionModelComfyName: preset.diffusionModelComfyName,
          loadKind: preset.loadKind,
          prompt,
          negativePrompt,
          seed,
          width,
          height,
          steps: body.steps,
          cfg: body.cfg,
          denoise: body.denoise,
          inputImageFilename: inputFilename,
        },
        entry,
        method,
      };
    }

    const entry = resolveModel(modelKey);
    if (!entry) {
      throw new Error(`Unknown model: "${modelKey}". Check GET /api models.`);
    }
    if (entry.family !== "sdxl") {
      throw new Error(
        `image2image model "${modelKey}" is not supported. Use an SDXL checkpoint or a fixed edit preset.`,
      );
    }

    const defaults = getEntryDefaults(entry);
    const { width, height, inputFilename } =
      await prepareInputImageAspectRatio(
        body,
        filename,
        "image2image-sdxl-checkpoint",
      );

    return {
      payload: {
        family: entry.family,
        managedWorkflowId: "image2image-sdxl-checkpoint",
        modelFile: entry.file,
        modelPath: entry.fullPath,
        comfyCheckpointGroup: entry.comfyCheckpointGroup,
        diffusionModelComfyName: entry.diffusionModelComfyName,
        loadKind: entry.loadKind,
        prompt,
        negativePrompt,
        seed,
        width,
        height,
        steps: body.steps,
        cfg: body.cfg,
        denoise: body.denoise,
        inputImageFilename: inputFilename,
      },
      entry,
      method,
    };
  }

  const modelName = String(body.model || "").trim();
  if (!modelName) throw new Error("Missing required field: model");

  const entry = resolveModel(modelName);
  if (!entry) {
    throw new Error(`Unknown model: "${modelName}". Check GET /api/models.`);
  }

  if (
    String(entry.managedWorkflowId || "").startsWith("image2video-") &&
    method !== "image2video"
  ) {
    throw new Error('Selected model requires method "image2video".');
  }

  const defaults = getEntryDefaults(entry);
  const { width, height } = resolveGenerationDimensions(body, defaults);

  return {
    payload: {
      family: entry.family,
      managedWorkflowId: entry.managedWorkflowId,
      modelFile: entry.file,
      modelPath: entry.fullPath,
      comfyCheckpointGroup: entry.comfyCheckpointGroup,
      diffusionModelComfyName: entry.diffusionModelComfyName,
      loadKind: entry.loadKind,
      prompt,
      negativePrompt,
      seed,
      width,
      height,
      steps: body.steps,
      cfg: body.cfg,
      denoise: body.denoise,
    },
    entry,
    method,
  };
}

module.exports = { buildComfyArgs, resolveDurationSeconds };
