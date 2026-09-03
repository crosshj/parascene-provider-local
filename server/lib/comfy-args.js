// comfy-args.js
// Centralized argument builder for Comfy jobs (text2image, image2image, etc.)

const { sanitizePromptText } = require("../handlers/generate.js");
const { resolveModel } = require("../lib/model-registry.js");
const {
  downloadImagesToComfyInput,
  ensureAudio2videoPlaceholderImage,
} = require("../generator/image-input.js");
const { getComfyInputDir } = require("./comfy-paths.js");
const { downloadAudioToComfyInput } = require("../generator/audio-input.js");
const { downloadVideoToComfyInput } = require("../generator/video-input.js");
const {
  prepareControlVideo,
  resolveStartOffsetSeconds,
} = require("./video-prepare.js");
const {
  getImage2videoPreset,
  getImage2imagePreset,
  getText2videoPreset,
  getAudio2videoPreset,
  getVideo2videoPreset,
  getReference2videoPreset,
  buildSyntheticImage2videoRegistryEntry,
  buildSyntheticImage2imageRegistryEntry,
  buildSyntheticText2videoRegistryEntry,
  buildSyntheticAudio2videoRegistryEntry,
  buildSyntheticVideo2videoRegistryEntry,
  buildSyntheticReference2videoRegistryEntry,
  IMAGE2VIDEO_MODEL_PRESETS,
  IMAGE2IMAGE_MODEL_PRESETS,
  TEXT2VIDEO_MODEL_PRESETS,
  AUDIO2VIDEO_MODEL_PRESETS,
  VIDEO2VIDEO_MODEL_PRESETS,
  REFERENCE2VIDEO_MODEL_PRESETS,
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
    inputDir: getComfyInputDir(),
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
      aspectRatio: body.aspect_ratio || body.aspectRatio,
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
    if (preset.requiresReferenceImage && !hasStartingImage) {
      throw new Error(
        `audio2video model "${presetKey}" requires input_images (identity/reference).`,
      );
    }
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
      aspectRatio: body.aspect_ratio || body.aspectRatio,
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

    const useFlf2v = Boolean(endFilename) || Boolean(preset.requiresEndFrame);
    if (preset.requiresEndFrame && !endFilename) {
      throw new Error(
        `Model "${presetKey}" requires two input_images (first and last frame).`,
      );
    }
    let managedWorkflowId = preset.managedWorkflowId;
    if (useFlf2v) {
      if (preset.flfWorkflowId) {
        managedWorkflowId = preset.flfWorkflowId;
      } else if (!preset.requiresEndFrame) {
        throw new Error(
          `Model "${presetKey}" does not support an end frame.`,
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
      aspectRatio: body.aspect_ratio || body.aspectRatio,
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

  if (method === "reference2video") {
    const presetKey = String(body.model || "").trim();
    if (!presetKey) throw new Error("Missing required field: model");
    const preset = getReference2videoPreset(presetKey);
    if (!preset) {
      const keys = Object.keys(REFERENCE2VIDEO_MODEL_PRESETS).join(", ");
      throw new Error(
        `Unknown reference2video model "${presetKey}". Use one of: ${keys}.`,
      );
    }
    const entry = buildSyntheticReference2videoRegistryEntry(presetKey, preset);
    const inputImages = normalizeInputImages(body);
    const inputVideoUrls = normalizeInputVideoUrls(body);
    const inputAudioUrls = normalizeInputAudioUrls(body);

    const maxImages = preset.maxRefImages ?? 9;
    const maxVideos = preset.maxRefVideos ?? 3;
    const maxAudios = preset.maxRefAudios ?? 3;
    if (inputImages.length > maxImages) {
      throw new Error(`reference2video allows at most ${maxImages} images.`);
    }
    if (inputVideoUrls.length > maxVideos) {
      throw new Error(`reference2video allows at most ${maxVideos} videos.`);
    }
    if (inputAudioUrls.length > maxAudios) {
      throw new Error(`reference2video allows at most ${maxAudios} audios.`);
    }
    if (!inputImages.length && !inputVideoUrls.length) {
      throw new Error(
        "reference2video requires at least one input image or input video.",
      );
    }
    if (inputAudioUrls.length && !inputImages.length && !inputVideoUrls.length) {
      throw new Error(
        "reference2video audio requires an accompanying image or video.",
      );
    }

    const inputImageFilenames = inputImages.length
      ? await downloadImagesToComfyInput(inputImages)
      : [];
    const inputVideoFilenames = inputVideoUrls.length
      ? await downloadVideoToComfyInput(inputVideoUrls)
      : [];
    const inputAudioFilenames = inputAudioUrls.length
      ? await downloadAudioToComfyInput(inputAudioUrls)
      : [];

    const defaults = { width: 768, height: 768 };
    let width;
    let height;
    if (inputImageFilenames[0]) {
      const resolved = await prepareInputImageAspectRatio(
        body,
        inputImageFilenames[0],
        preset.managedWorkflowId,
      );
      width = resolved.width;
      height = resolved.height;
    } else {
      ({ width, height } = resolveGenerationDimensions(body, defaults));
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
      inputImageFilenames,
      inputVideoFilenames,
      inputAudioFilenames,
      inputImageFilename: inputImageFilenames[0],
      aspectRatio: body.aspect_ratio || body.aspectRatio,
      ref_image_size: body.ref_image_size || body.refImageSize,
      expectVideo: true,
    };
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
    const [stagedVideoFilename] = videoFiles;
    if (!stagedVideoFilename) {
      throw new Error("Failed to prepare input video for video2video.");
    }

    const durationSeconds = resolveDurationSeconds(body);
    const startOffsetSeconds = resolveStartOffsetSeconds(body);
    const profile = preset.videoInputProfile || {
      targetFps: 16,
      defaultDurationSeconds: 5,
    };
    const prepared = await prepareControlVideo({
      filename: stagedVideoFilename,
      profile,
      startOffsetSeconds,
      durationSeconds,
    });

    // Prefer template dims (VACE = 640²). Do not fall through to 1024 via
    // aspect-ratio tables when the workflow base is 640.
    const defaults = getEntryDefaults(entry);
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
      fps: prepared.targetFps,
      length: body.length,
      strength: body.strength,
      inputVideoFilename: prepared.filename,
      startOffsetSeconds: prepared.startOffsetSeconds,
      durationSeconds: prepared.effectiveDurationSeconds,
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
