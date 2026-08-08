"use strict";

const fs = require("fs");
const path = require("path");
const { getComfyInputDir } = require("../lib/comfy-paths.js");

// Default TTL for cached images (in seconds)
const IMAGE_INPUT_TTL_SECONDS = Number(process.env.INPUT_TTL_SECONDS) || 86400;
// Comfy validates every LoadImage node even when bypassed in the graph.
const A2V_PLACEHOLDER_IMAGE_FILENAME = "a2v_placeholder.png";

/**
 * Resolves an array of image inputs (https URL, data URI, or uploaded file ref)
 * into ComfyUI input filenames.
 *
 * @param {string[]} urlArray
 * @returns {Promise<string[]>}
 */
async function downloadImagesToComfyInput(urlArray) {
  const { resolveMediaInputs } = require("../lib/media-resolve.js");
  return resolveMediaInputs(urlArray, {
    kind: "image",
    ttlSeconds: IMAGE_INPUT_TTL_SECONDS,
  });
}

/**
 * Ensures a tiny placeholder PNG exists in Comfy input for audio-only ia2v runs.
 * LoadImage nodes are validated on prompt submit even when the i2v path is bypassed.
 */
async function ensureAudio2videoPlaceholderImage() {
  const inputDir = getComfyInputDir();
  fs.mkdirSync(inputDir, { recursive: true });
  const outPath = path.join(inputDir, A2V_PLACEHOLDER_IMAGE_FILENAME);
  if (fs.existsSync(outPath)) {
    return A2V_PLACEHOLDER_IMAGE_FILENAME;
  }
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error(
      "Cannot create audio2video placeholder image: sharp is not installed.",
    );
  }
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toFile(outPath);
  return A2V_PLACEHOLDER_IMAGE_FILENAME;
}

module.exports = {
  downloadImagesToComfyInput,
  ensureAudio2videoPlaceholderImage,
  get COMFY_INPUT_DIR() {
    return getComfyInputDir();
  },
  A2V_PLACEHOLDER_IMAGE_FILENAME,
  IMAGE_INPUT_TTL_SECONDS,
};
