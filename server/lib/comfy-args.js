// comfy-args.js
// Centralized argument builder for Comfy jobs (text2image, image2image, etc.)

const { sanitizePromptText } = require("../handlers/generate.js");
const { resolveModel } = require("../lib/model-registry.js");
const { downloadImagesToComfyInput } = require("../generator/image-input.js");
const {
  getImage2videoPreset,
  buildSyntheticImage2videoRegistryEntry,
  IMAGE2VIDEO_MODEL_PRESETS,
} = require("../configs/api-model-aliases.js");

function normalizeInputImages(body) {
  if (Array.isArray(body.input_images)) {
    return body.input_images.map((v) => String(v || "").trim()).filter(Boolean);
  }
  return [];
}

/**
 * Build the argument payload for Comfy jobs, given user args/body and outputDir.
 * image2video uses preset keys from configs/api-model-aliases.js (no registry scan).
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
        width: body.width,
        height: body.height,
        steps: body.steps,
        cfg: body.cfg,
        fps: body.fps,
        inputImageFilename: filename,
        expectVideo: true,
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

  if (method === "image2image" && entry.family === "sdxl") {
    const inputImages = normalizeInputImages(body);
    if (!inputImages.length) {
      throw new Error("image2image requires input_images to be provided.");
    }
    const files = await downloadImagesToComfyInput(inputImages);
    const [filename] = files;
    if (!filename)
      throw new Error("Failed to prepare input image for image2image.");
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
        width: body.width,
        height: body.height,
        steps: body.steps,
        cfg: body.cfg,
        denoise: body.denoise,
        inputImageFilename: filename,
      },
      entry,
      method,
    };
  }

  if (
    String(entry.managedWorkflowId || "").startsWith("image2video-") &&
    method !== "image2video"
  ) {
    throw new Error('Selected model requires method "image2video".');
  }

  // Default: text2image or other
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
      width: body.width,
      height: body.height,
      steps: body.steps,
      cfg: body.cfg,
      denoise: body.denoise,
    },
    entry,
    method,
  };
}

module.exports = { buildComfyArgs };
