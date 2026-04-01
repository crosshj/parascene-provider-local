// handlers/generate.js
// Image generation via managed Comfy (HTTP API).

"use strict";

const { randomInt } = require("crypto");

const { readJson, sendJson } = require("../lib/http.js");
const { resolveModel } = require("./models.js");
const {
  runComfyGeneration,
  isManagedComfyWorkflowSupported,
} = require("../generator/index.js");
const { downloadImagesToComfyInput } = require("../generator/image-input.js");

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
    .then(async (body) => {
      const { buildComfyArgs } = require("../lib/comfy-args.js");
      let comfy;
      try {
        comfy = await buildComfyArgs(body, ctx.outputDir);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const { payload } = comfy;
      const result = await runComfyGeneration(payload, ctx.outputDir);
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
    })
    .catch((err) =>
      sendJson(res, 500, { error: err.message ?? "Generation failed." }),
    );
}

module.exports = {
  handleGenerate,
  sanitizePromptText,
};
