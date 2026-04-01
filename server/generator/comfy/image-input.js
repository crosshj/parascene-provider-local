"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Directory where ComfyUI expects input images
const COMFY_INPUT_DIR = "D:/comfy/ComfyUI/input";
// Default TTL for cached images (in seconds)
const IMAGE_INPUT_TTL_SECONDS = 86400; // 24 hours

/**
 * Downloads an array of image URLs to the ComfyUI input directory.
 * Avoids duplicate downloads by hashing the URL and using a TTL for cache expiry.
 * Returns an array of filenames (not full paths) for use in workflows.
 *
 * @param {string[]} urlArray - Array of image URLs
 * @param {number} ttlSeconds - Time-to-live in seconds for cached images (default: 24h)
 * @returns {Promise<string[]>} - Array of filenames saved in COMFY_INPUT_DIR
 */

async function downloadImagesToComfyInput(urlArray) {
  if (!Array.isArray(urlArray))
    throw new Error("Input must be an array of URLs");
  fs.mkdirSync(COMFY_INPUT_DIR, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const filenames = [];
  for (const url of urlArray) {
    const ext = path.extname(new URL(url).pathname) || ".png";
    const hash = crypto
      .createHash("md5")
      .update(url)
      .digest("hex")
      .slice(0, 12);
    // Find any file matching input_<timestamp>_<hash><ext>
    const re = new RegExp(
      `^input_(\\d+)_${hash.replace(/([.*+?^=!:${}()|[\]\/\\])/g, "\\$1")}${ext.replace(".", "\\.")}$`,
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
    if (found && now - foundTimestamp < IMAGE_INPUT_TTL_SECONDS) {
      filename = found;
    } else {
      // Download and save new file
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
      filename = `input_${now}_${hash}${ext}`;
      const outPath = path.join(COMFY_INPUT_DIR, filename);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(outPath, buffer);
    }
    filenames.push(filename);
  }
  return filenames;
}

module.exports = { downloadImagesToComfyInput, COMFY_INPUT_DIR };
