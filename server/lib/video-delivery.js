"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * Transcode a Comfy video artifact to the delivery profile:
 * MP4 · H.264 yuv420p · AAC (if audio) · +faststart.
 * Preserves the source frame rate (does not force 24/30).
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {Promise<{ outputPath: string }>}
 */
async function transcodeToDeliveryMp4(inputPath, outputPath) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("Delivery transcode: input video missing.");
  }
  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  const tmpName = `deliv_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.mp4`;
  const tmpPath = path.join(os.tmpdir(), tmpName);

  const args = [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "fast",
    "-crf",
    "18",
    // Preserve input fps / timestamps (no -r).
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    // If source has no audio, still succeed.
    "-shortest",
    tmpPath,
  ];

  try {
    await execFileAsync(FFMPEG, args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    // Retry video-only when audio encode fails (silent Wan outputs, etc.).
    const videoOnly = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-an",
      "-movflags",
      "+faststart",
      tmpPath,
    ];
    try {
      await execFileAsync(FFMPEG, videoOnly, { maxBuffer: 16 * 1024 * 1024 });
    } catch (err2) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      throw new Error(
        `Delivery transcode failed: ${err2?.stderr || err?.stderr || err2?.message || err?.message || err2}`,
      );
    }
  }

  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size < 32) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw new Error("Delivery transcode failed: empty output.");
  }

  fs.copyFileSync(tmpPath, outputPath);
  try {
    fs.unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }
  return { outputPath };
}

module.exports = {
  transcodeToDeliveryMp4,
};
