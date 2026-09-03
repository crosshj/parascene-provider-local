"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { getComfyInputDir } = require("./comfy-paths.js");

const execFileAsync = promisify(execFile);

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * @typedef {object} VideoInputProfile
 * @property {number} [targetFps]
 * @property {number} [maxLongerEdge]
 * @property {number} [defaultDurationSeconds]
 */

/**
 * @typedef {object} ProbeResult
 * @property {number} durationSeconds
 * @property {number|null} fps
 * @property {number|null} width
 * @property {number|null} height
 */

function resolveStartOffsetSeconds(body) {
  const raw = body?.start_offset_seconds ?? body?.startOffsetSeconds ?? 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("start_offset_seconds must be a non-negative number.");
  }
  return n;
}

/**
 * Probe duration / fps / size via ffprobe.
 * @param {string} filePath
 * @returns {Promise<ProbeResult>}
 */
async function probeVideo(filePath) {
  const { stdout } = await execFileAsync(
    FFPROBE,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,avg_frame_rate:format=duration",
      "-of",
      "json",
      filePath,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout || "{}");
  const stream = Array.isArray(data.streams) ? data.streams[0] : null;
  const durationSeconds = Number(data.format?.duration);
  let fps = null;
  const rateStr =
    stream?.avg_frame_rate && stream.avg_frame_rate !== "0/0"
      ? stream.avg_frame_rate
      : stream?.r_frame_rate;
  if (typeof rateStr === "string" && rateStr.includes("/")) {
    const [a, b] = rateStr.split("/").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) fps = a / b;
  }
  return {
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    fps: Number.isFinite(fps) && fps > 0 ? fps : null,
    width: stream?.width != null ? Number(stream.width) : null,
    height: stream?.height != null ? Number(stream.height) : null,
  };
}

function computeWindow({
  sourceDuration,
  startOffsetSeconds,
  durationSeconds,
  defaultDurationSeconds = 5,
}) {
  const offset = Math.max(0, Number(startOffsetSeconds) || 0);
  if (!(sourceDuration > 0)) {
    throw new Error("Cannot prepare control video: source has no duration.");
  }
  if (offset >= sourceDuration) {
    throw new Error(
      `start_offset_seconds (${offset}) is beyond source duration (${sourceDuration.toFixed(2)}s).`,
    );
  }
  const available = sourceDuration - offset;
  let want =
    durationSeconds != null && Number.isFinite(Number(durationSeconds))
      ? Number(durationSeconds)
      : defaultDurationSeconds;
  if (!(want > 0)) want = defaultDurationSeconds;
  want = Math.min(15, Math.max(0.1, want));
  const effectiveDuration = Math.min(want, available);
  if (!(effectiveDuration > 0)) {
    throw new Error("No video remains after applying start_offset_seconds.");
  }
  return { offset, effectiveDuration, available };
}

function scaleFilter(width, height, maxLongerEdge) {
  const maxEdge = Number(maxLongerEdge);
  if (!(maxEdge > 0) || !(width > 0) || !(height > 0)) return null;
  const longer = Math.max(width, height);
  if (longer <= maxEdge) return null;
  // Keep aspect; force even dims for yuv420p.
  return `scale='if(gt(iw\\,ih)\\,${maxEdge}\\,-2)':'if(gt(ih\\,iw)\\,${maxEdge}\\,-2)'`;
}

/**
 * Seek / trim / resample (and optional downscale) a staged Comfy input video.
 *
 * @param {object} opts
 * @param {string} opts.filename - basename in Comfy input dir
 * @param {VideoInputProfile} [opts.profile]
 * @param {number} [opts.startOffsetSeconds]
 * @param {number} [opts.durationSeconds]
 * @returns {Promise<{ filename: string, effectiveDurationSeconds: number, targetFps: number, startOffsetSeconds: number }>}
 */
async function prepareControlVideo({
  filename,
  profile = {},
  startOffsetSeconds = 0,
  durationSeconds,
} = {}) {
  const safe = path.basename(String(filename || ""));
  if (!safe || safe !== filename) {
    throw new Error("Invalid control video filename.");
  }
  const inputDir = getComfyInputDir();
  const srcPath = path.join(inputDir, safe);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Control video not found in Comfy input: ${safe}`);
  }

  const probe = await probeVideo(srcPath);
  const targetFps = Number(profile.targetFps) > 0 ? Number(profile.targetFps) : 16;
  const defaultDurationSeconds =
    Number(profile.defaultDurationSeconds) > 0
      ? Number(profile.defaultDurationSeconds)
      : 5;

  const { offset, effectiveDuration } = computeWindow({
    sourceDuration: probe.durationSeconds,
    startOffsetSeconds,
    durationSeconds,
    defaultDurationSeconds,
  });

  const filters = [];
  const scale = scaleFilter(
    probe.width,
    probe.height,
    profile.maxLongerEdge,
  );
  if (scale) filters.push(scale);
  filters.push(`fps=${targetFps}`);

  const stamp = Date.now();
  const rand = crypto.randomBytes(4).toString("hex");
  const outName = `prep_${stamp}_${rand}.mp4`;
  const outPath = path.join(inputDir, outName);

  // Keep audio (trimmed to the same window) so graphs that remux source audio still work.
  const args = [
    "-y",
    "-ss",
    String(offset),
    "-t",
    String(effectiveDuration),
    "-i",
    srcPath,
    "-vf",
    filters.join(","),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outPath,
  ];

  try {
    await execFileAsync(FFMPEG, args, { maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Failed to prepare control video: ${err?.stderr || err?.message || err}`,
    );
  }

  if (!fs.existsSync(outPath)) {
    throw new Error("Failed to prepare control video: output missing.");
  }

  return {
    filename: outName,
    effectiveDurationSeconds: effectiveDuration,
    targetFps,
    startOffsetSeconds: offset,
  };
}

module.exports = {
  probeVideo,
  computeWindow,
  resolveStartOffsetSeconds,
  prepareControlVideo,
  scaleFilter,
};
