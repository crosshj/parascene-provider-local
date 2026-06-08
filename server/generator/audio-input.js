"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { COMFY_INPUT_DIR } = require("./image-input.js");

const AUDIO_INPUT_TTL_SECONDS = 86400; // 24 hours
const ALLOWED_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".m4a",
]);

/**
 * Downloads an array of audio URLs to the ComfyUI input directory.
 * Avoids duplicate downloads by hashing the URL and using a TTL for cache expiry.
 * Returns an array of filenames (not full paths) for use in workflows.
 *
 * @param {string[]} urlArray - Array of audio URLs
 * @param {number} ttlSeconds - Time-to-live in seconds for cached audio (default: 24h)
 * @returns {Promise<string[]>} - Array of filenames saved in COMFY_INPUT_DIR
 */
async function downloadAudioToComfyInput(urlArray, ttlSeconds = AUDIO_INPUT_TTL_SECONDS) {
  if (!Array.isArray(urlArray)) {
    throw new Error("Input must be an array of URLs");
  }
  fs.mkdirSync(COMFY_INPUT_DIR, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const filenames = [];
  for (const url of urlArray) {
    const pathname = new URL(url).pathname;
    const rawExt = path.extname(pathname).toLowerCase();
    const ext = ALLOWED_AUDIO_EXTENSIONS.has(rawExt) ? rawExt : ".mp3";
    const hash = crypto
      .createHash("md5")
      .update(url)
      .digest("hex")
      .slice(0, 12);
    const re = new RegExp(
      `^audio_(\\d+)_${hash.replace(/([.*+?^=!:${}()|[\]\/\\])/g, "\\$1")}${ext.replace(".", "\\.")}$`,
    );
    let found = null;
    let foundTimestamp = 0;
    for (const file of fs.readdirSync(COMFY_INPUT_DIR)) {
      const m = file.match(re);
      if (m) {
        found = file;
        foundTimestamp = parseInt(m[1], 10);
        break;
      }
    }
    let filename;
    if (found && now - foundTimestamp < ttlSeconds) {
      filename = found;
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch audio: ${url}`);
      filename = `audio_${now}_${hash}${ext}`;
      const outPath = path.join(COMFY_INPUT_DIR, filename);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(outPath, buffer);
    }
    filenames.push(filename);
  }
  return filenames;
}

module.exports = { downloadAudioToComfyInput, AUDIO_INPUT_TTL_SECONDS };
