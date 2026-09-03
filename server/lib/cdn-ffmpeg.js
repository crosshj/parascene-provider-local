"use strict";

const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const { derivedPath, derivedCoverPath } = require("./cdn-store.js");

const execFileAsync = promisify(execFile);

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

async function probeDurationSeconds(filePath) {
  const { stdout } = await execFileAsync(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout || "{}");
  const n = Number(data.format?.duration);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseWindow(soRaw, duRaw) {
  const so = soRaw == null || soRaw === "" ? 0 : Number(soRaw);
  const du = duRaw == null || duRaw === "" ? null : Number(duRaw);
  if (!Number.isFinite(so) || so < 0) {
    throw new Error("so must be a non-negative number.");
  }
  if (du != null && (!Number.isFinite(du) || !(du > 0))) {
    throw new Error("du must be a positive number.");
  }
  return { so, du };
}

async function extractWindow({ srcPath, objectId, so, du, ext }) {
  const duration = await probeDurationSeconds(srcPath);
  if (!(duration > 0)) {
    throw new Error("Source has no duration.");
  }
  if (so >= duration) {
    throw new Error(
      `so (${so}) is beyond source duration (${duration.toFixed(2)}s).`,
    );
  }
  const available = duration - so;
  const want = du == null ? available : Math.min(du, available);
  if (!(want > 0)) {
    throw new Error("No media remains after applying so.");
  }
  const outExt = ext && String(ext).startsWith(".") ? ext : ".m4a";
  const outPath = derivedPath(objectId, so, want, outExt);
  try {
    const st = fs.statSync(outPath);
    if (st.size > 0) return { path: outPath, duration: want };
  } catch {
    // cache miss
  }
  try {
    await execFileAsync(
      FFMPEG,
      [
        "-y",
        "-ss",
        String(so),
        "-t",
        String(want),
        "-i",
        srcPath,
        "-vn",
        "-c:a",
        "copy",
        outPath,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return { path: outPath, duration: want };
  } catch {
    const aacPath = derivedPath(objectId, so, want, ".m4a");
    await execFileAsync(
      FFMPEG,
      [
        "-y",
        "-ss",
        String(so),
        "-t",
        String(want),
        "-i",
        srcPath,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        aacPath,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return { path: aacPath, duration: want };
  }
}

// Video still-at-time / last-frame is not here yet. When adding it, port
// desktop `extract_video_jpeg` (parascene-desktop docs/PLAN-blue-cdn-frames.md).
// Do not seek to duration-0.05 with -frames:v 1 — container duration often
// outlasts the last video packet (empty JPEG). Last visible frame is at-or-
// before the requested source time; only untrimmed/sentinel reads to EOF.
async function extractCover({ srcPath, objectId }) {
  const outPath = derivedCoverPath(objectId);
  try {
    const st = fs.statSync(outPath);
    if (st.size > 0) return { path: outPath };
  } catch {
    // cache miss
  }
  try {
    await execFileAsync(
      FFMPEG,
      [
        "-y",
        "-i",
        srcPath,
        "-an",
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outPath,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (err) {
    const stderr = String(err.stderr || err.message || "");
    const missing =
      stderr.includes("Stream map '0:v:0'") ||
      stderr.includes("matches no streams") ||
      stderr.includes("Output file does not contain any stream");
    const e = new Error(missing ? "No embedded artwork." : "Cover extract failed.");
    e.status = missing ? 404 : 400;
    throw e;
  }
  try {
    if (fs.statSync(outPath).size > 0) return { path: outPath };
  } catch {
    // fall through
  }
  const e = new Error("No embedded artwork.");
  e.status = 404;
  throw e;
}

module.exports = {
  probeDurationSeconds,
  parseWindow,
  extractWindow,
  extractCover,
};
