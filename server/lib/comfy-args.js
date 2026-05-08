// comfy-args.js
// Centralized argument builder for Comfy jobs (text2image, image2image, etc.)

const { sanitizePromptText } = require("../handlers/generate.js");
const { resolveModel } = require("../lib/model-registry.js");
const { downloadImagesToComfyInput } = require("../generator/image-input.js");
const {
  expandImage2videoModelAlias,
} = require("../configs/api-model-aliases.js");

function normalizeInputImages(body) {
  if (Array.isArray(body.input_images)) {
    return body.input_images.map((v) => String(v || "").trim()).filter(Boolean);
  }
  return [];
}

/**
 * Build the argument payload for Comfy jobs, given user args/body and outputDir.
 * Handles text2image, image2image (SDXL), image2video (`model` aliases expanded via configs/api-model-aliases.js).
 * Returns a Promise that resolves to { payload, entry, method }.
 */
async function buildComfyArgs(body, outputDir) {
  const prompt = sanitizePromptText(body.prompt);
  if (!prompt) throw new Error("Missing required field: prompt");

  const method = String(body.method || "").trim() || "text2image";
  let modelName = String(body.model || "").trim();
  if (!modelName) throw new Error("Missing required field: model");
  if (method === "image2video") {
    modelName = expandImage2videoModelAlias(modelName);
  }

  const entry = resolveModel(modelName);
  if (!entry)
    throw new Error(`Unknown model: "${modelName}". Check GET /api/models.`);
  const negativePrompt = sanitizePromptText(body.negative_prompt || "");
  const seed =
    Number.isInteger(body.seed) && body.seed >= 0
      ? body.seed
      : Math.floor(Math.random() * 2_147_483_647) + 1;

  if (method === "image2video") {
    if (!String(entry.managedWorkflowId || "").startsWith("image2video-")) {
      throw new Error("Selected model does not support image2video.");
    }
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
        family: entry.family,
        managedWorkflowId: entry.managedWorkflowId,
        modelFile: entry.file,
        modelPath: entry.fullPath,
        comfyCheckpointGroup: entry.comfyCheckpointGroup,
        diffusionModelComfyName: entry.diffusionModelComfyName,
        loadKind: entry.loadKind,
        checkpointBasename:
          entry.loadKind === "checkpoint" ? entry.file : undefined,
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
