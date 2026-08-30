"use strict";

const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const { derivedPath } = require("./cdn-store.js");

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

module.exports = {
  probeDurationSeconds,
  parseWindow,
  extractWindow,
};
