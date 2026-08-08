"use strict";

const VIDEO_INPUT_TTL_SECONDS = Number(process.env.INPUT_TTL_SECONDS) || 86400;

/**
 * Resolves video inputs (https URL or uploaded file ref — no data URIs)
 * into ComfyUI input filenames.
 *
 * @param {string[]} urlArray
 * @param {number} [ttlSeconds]
 * @returns {Promise<string[]>}
 */
async function downloadVideoToComfyInput(
  urlArray,
  ttlSeconds = VIDEO_INPUT_TTL_SECONDS,
) {
  const { resolveMediaInputs } = require("../lib/media-resolve.js");
  return resolveMediaInputs(urlArray, { kind: "video", ttlSeconds });
}

module.exports = { downloadVideoToComfyInput, VIDEO_INPUT_TTL_SECONDS };
