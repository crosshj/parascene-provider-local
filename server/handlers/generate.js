// handlers/generate.js
// Image generation via managed Comfy (HTTP API).

"use strict";

const { randomInt } = require("crypto");

const { readJson, sendJson } = require("../lib.js");
const { resolveModel } = require("./models.js");
const {
  runComfyGeneration,
  isManagedComfyWorkflowSupported,
} = require("../generator/comfy/index.js");
const {
  downloadImagesToComfyInput,
} = require("../generator/comfy/image-input.js");

function sanitizePromptText(value) {
  if (value == null) return "";
  let out = String(value).normalize("NFKC");
  const map = {
    "\u2018": "\u0027",
    "\u2019": "\u0027",
    "\u201A": "\u0027",
    "\u201B": "\u0027",
    "\u2032": "\u0027",
    "\u201C": "\u0022",
    "\u201D": "\u0022",
    "\u201E": "\u0022",
    "\u201F": "\u0022",
    "\u2033": "\u0022",
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
    "\u2026": "...",
    "\u00A0": " ",
  };
  out = out.replace(
    /[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u201F\u2033\u2013\u2014\u2212\u2026\u00A0]/g,
    (ch) => map[ch] ?? ch,
  );
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return out.trim();
}

function handleGenerate(req, res, ctx) {
  if (!ctx.outputDir) {
    return sendJson(res, 503, { error: "OUTPUT_DIR not configured" });
  }
  readJson(req)
    .then((body) => {
      const prompt = sanitizePromptText(body.prompt);
      if (!prompt) {
        return sendJson(res, 400, { error: "Missing required field: prompt" });
      }

      const modelName = String(body.model || "").trim();
      if (!modelName) {
        return sendJson(res, 400, { error: "Missing required field: model" });
      }

      const entry = resolveModel(modelName);
      if (!entry) {
        return sendJson(res, 400, {
          error: `Unknown model: "${modelName}". Check GET /api/models.`,
        });
      }

      if (!isManagedComfyWorkflowSupported(entry)) {
        return sendJson(res, 400, {
          error:
            "This model has no registered Comfy workflow. Pick another model or add a workflow in server/generator/workflows.",
        });
      }

      const negative_prompt = sanitizePromptText(body.negative_prompt || "");
      const method = String(body.method || "").trim() || "text2img";

      const seed =
        Number.isInteger(body.seed) && body.seed >= 0
          ? body.seed
          : randomInt(1, 2_147_483_647);

      // Helper to actually invoke the comfy client once we've resolved
      // which workflow id and extra overrides to use.
      function runWithWorkflow(managedWorkflowId, extraOverrides = {}) {
        return runComfyGeneration(
          {
            family: entry.family,
            managedWorkflowId,
            modelFile: entry.file,
            modelPath: entry.fullPath,
            comfyCheckpointGroup: entry.comfyCheckpointGroup,
            diffusionModelComfyName: entry.diffusionModelComfyName,
            loadKind: entry.loadKind,
            prompt,
            negativePrompt: negative_prompt,
            seed,
            width: body.width,
            height: body.height,
            steps: body.steps,
            cfg: body.cfg,
            ...extraOverrides,
          },
          ctx.outputDir,
        );
      }

      let generationPromise;

      if (method === "image2image" && entry.family === "sdxl") {
        const imageUrl = String(body.image_url || "").trim();
        if (!imageUrl) {
          return sendJson(res, 400, {
            error: "image2image requires image_url to be provided.",
          });
        }

        generationPromise = downloadImagesToComfyInput([imageUrl]).then(
          (files) => {
            const [filename] = files;
            if (!filename) {
              throw new Error("Failed to prepare input image for image2image.");
            }
            return runWithWorkflow("image2image-sdxl-checkpoint", {
              inputImageFilename: filename,
            });
          },
        );
      } else {
        // Default: text2img (or anything else not yet specialized) sticks to
        // the model's registered managedWorkflowId.
        generationPromise = runWithWorkflow(entry.managedWorkflowId);
      }

      return generationPromise.then((result) => {
        if (!result?.ok || !result.file_name) {
          return sendJson(res, 500, {
            error: result?.error ?? "Generator did not return an image.",
          });
        }
        sendJson(res, 200, {
          ok: true,
          file_name: result.file_name,
          image_url: `/outputs/${result.file_name}`,
          seed: result.seed,
          family: result.family,
          model: result.model,
          elapsed_ms: result.elapsed_ms,
          backend: "comfy",
        });
      });
    })
    .catch((err) =>
      sendJson(res, 500, { error: err.message ?? "Generation failed." }),
    );
}

module.exports = {
  handleGenerate,
  sanitizePromptText,
};
