"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { COMFY_INPUT_DIR } = require("./image-input.js");

const VIDEO_INPUT_TTL_SECONDS = 86400; // 24 hours
const ALLOWED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".gif",
]);

/**
 * Downloads an array of video URLs to the ComfyUI input directory.
 * Avoids duplicate downloads by hashing the URL and using a TTL for cache expiry.
 * Returns an array of filenames (not full paths) for use in workflows.
 *
 * @param {string[]} urlArray
 * @param {number} [ttlSeconds]
 * @returns {Promise<string[]>}
 */
async function downloadVideoToComfyInput(
  urlArray,
  ttlSeconds = VIDEO_INPUT_TTL_SECONDS,
) {
  if (!Array.isArray(urlArray)) {
    throw new Error("Input must be an array of URLs");
  }
  fs.mkdirSync(COMFY_INPUT_DIR, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const filenames = [];
  for (const url of urlArray) {
    const pathname = new URL(url).pathname;
    const rawExt = path.extname(pathname).toLowerCase();
    const ext = ALLOWED_VIDEO_EXTENSIONS.has(rawExt) ? rawExt : ".mp4";
    const hash = crypto
      .createHash("md5")
      .update(url)
      .digest("hex")
      .slice(0, 12);
    const re = new RegExp(
      `^video_(\\d+)_${hash.replace(/([.*+?^=!:${}()|[\]\/\\])/g, "\\$1")}${ext.replace(".", "\\.")}$`,
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
      if (!res.ok) throw new Error(`Failed to fetch video: ${url}`);
      filename = `video_${now}_${hash}${ext}`;
      const outPath = path.join(COMFY_INPUT_DIR, filename);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(outPath, buffer);
    }
    filenames.push(filename);
  }
  return filenames;
}

module.exports = { downloadVideoToComfyInput, VIDEO_INPUT_TTL_SECONDS };
