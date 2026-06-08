// comfy-args.js
// Centralized argument builder for Comfy jobs (text2image, image2image, etc.)

const { sanitizePromptText } = require("../handlers/generate.js");
const { resolveModel } = require("../lib/model-registry.js");
const {
  downloadImagesToComfyInput,
  COMFY_INPUT_DIR,
} = require("../generator/image-input.js");
const {
  getImage2videoPreset,
  getImage2imagePreset,
  getText2videoPreset,
  buildSyntheticImage2videoRegistryEntry,
  buildSyntheticImage2imageRegistryEntry,
  buildSyntheticText2videoRegistryEntry,
  IMAGE2VIDEO_MODEL_PRESETS,
  IMAGE2IMAGE_MODEL_PRESETS,
  TEXT2VIDEO_MODEL_PRESETS,
} = require("../configs/api-model-aliases.js");
const { _loadTemplateDefaults } = require("../workflows/_defaults.js");
const {
  resolveGenerationDimensions,
  resolveAspectRatioFromInputImage,
} = require("../lib/aspect-ratio.js");

function normalizeInputImages(body) {
  if (Array.isArray(body.input_images)) {
    return body.input_images.map((v) => String(v || "").trim()).filter(Boolean);
  }
  return [];
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

    return {
      payload: {
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
      },
      entry,
      method,
    };
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
    const entry = buildSyntheticImage2videoRegistryEntry(presetKey, preset);
    const inputImages = normalizeInputImages(body);
    if (!inputImages.length) {
      throw new Error("image2video requires input_images to be provided.");
    }
    const files = await downloadImagesToComfyInput(inputImages);
    const [filename] = files;
    if (!filename)
      throw new Error("Failed to prepare input image for image2video.");

    const { width, height, inputFilename } =
      await prepareInputImageAspectRatio(body, filename, preset.managedWorkflowId);

    return {
      payload: {
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
        inputImageFilename: inputFilename,
        expectVideo: true,
      },
      entry,
      method,
    };
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

module.exports = { buildComfyArgs };
