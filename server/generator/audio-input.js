"use strict";

const AUDIO_INPUT_TTL_SECONDS = Number(process.env.INPUT_TTL_SECONDS) || 86400;

/**
 * Resolves audio inputs (https URL, small data URI, or uploaded file ref)
 * into ComfyUI input filenames.
 *
 * @param {string[]} urlArray
 * @param {number} [ttlSeconds]
 * @returns {Promise<string[]>}
 */
async function downloadAudioToComfyInput(
  urlArray,
  ttlSeconds = AUDIO_INPUT_TTL_SECONDS,
) {
  const { resolveMediaInputs } = require("../lib/media-resolve.js");
  return resolveMediaInputs(urlArray, { kind: "audio", ttlSeconds });
}

module.exports = { downloadAudioToComfyInput, AUDIO_INPUT_TTL_SECONDS };
