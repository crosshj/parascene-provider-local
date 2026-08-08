"use strict";

const fs = require("fs");
const path = require("path");

const INPUT_TTL_SECONDS = Number(process.env.INPUT_TTL_SECONDS) || 86400;
const OUTPUT_TTL_SECONDS = Number(process.env.OUTPUT_TTL_SECONDS) || 3600;
const JOB_META_TTL_SECONDS = Number(process.env.JOB_META_TTL_SECONDS) || 604800;
const CLEANUP_INTERVAL_SECONDS =
  Number(process.env.CLEANUP_INTERVAL_SECONDS) || 300;

const INPUT_FILE_RE =
  /^(input|audio|video|upload|datauri)_(\d+)_/;

function expiresAtFromNow(ttlSeconds) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function expiresAtFromUnix(unixSeconds, ttlSeconds) {
  return new Date((Number(unixSeconds) + ttlSeconds) * 1000).toISOString();
}

function parseInputTimestamp(filename) {
  const m = String(filename || "").match(INPUT_FILE_RE);
  if (!m) return null;
  const ts = Number(m[2]);
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Last-used unix seconds for a staged input: max(filename stamp, mtime).
 * Filename stamp is create time; mtime is bumped when the file is reused.
 */
function getInputLastUsedUnix(filePath, filename) {
  const fromName = parseInputTimestamp(filename);
  let fromMtime = null;
  try {
    const st = fs.statSync(filePath);
    fromMtime = Math.floor(st.mtimeMs / 1000);
  } catch {
    // missing file
  }
  if (fromName == null && fromMtime == null) return null;
  if (fromName == null) return fromMtime;
  if (fromMtime == null) return fromName;
  return Math.max(fromName, fromMtime);
}

/**
 * Reset input TTL by touching mtime (filename stamp stays so /api/files refs remain valid).
 * @returns {{ filename: string, expires_at: string } | null}
 */
function touchInputFile(inputDir, filename, { ttlSeconds = INPUT_TTL_SECONDS } = {}) {
  const safe = path.basename(String(filename || ""));
  if (!safe || safe === "." || safe === "..") return null;
  if (parseInputTimestamp(safe) == null) return null;
  const full = path.join(inputDir, safe);
  if (!fs.existsSync(full)) return null;
  const now = new Date();
  try {
    fs.utimesSync(full, now, now);
  } catch {
    return null;
  }
  const lastUsed = Math.floor(now.getTime() / 1000);
  return {
    filename: safe,
    expires_at: expiresAtFromUnix(lastUsed, ttlSeconds),
  };
}

function expiresAtForInputFile(inputDir, filename, { ttlSeconds = INPUT_TTL_SECONDS } = {}) {
  const safe = path.basename(String(filename || ""));
  const full = path.join(inputDir, safe);
  const lastUsed = getInputLastUsedUnix(full, safe);
  if (lastUsed == null) return null;
  return expiresAtFromUnix(lastUsed, ttlSeconds);
}

function listPinnedInputFilenames(getJobs) {
  const pinned = new Set();
  if (typeof getJobs !== "function") return pinned;
  for (const job of getJobs()) {
    if (!job || (job.status !== "pending" && job.status !== "running")) continue;
    const p = job.payload || {};
    for (const key of [
      "inputImageFilename",
      "endImageFilename",
      "inputAudioFilename",
      "inputVideoFilename",
    ]) {
      if (p[key]) pinned.add(String(p[key]));
    }
    for (const arrKey of [
      "inputImageFilenames",
      "inputAudioFilenames",
      "inputVideoFilenames",
    ]) {
      const arr = p[arrKey];
      if (Array.isArray(arr)) {
        for (const name of arr) if (name) pinned.add(String(name));
      }
    }
  }
  return pinned;
}

function sweepInputDir(inputDir, { now = Math.floor(Date.now() / 1000), pinned = new Set(), ttlSeconds = INPUT_TTL_SECONDS } = {}) {
  if (!inputDir || !fs.existsSync(inputDir)) {
    return { deleted: [], skipped: 0 };
  }
  const deleted = [];
  let skipped = 0;
  for (const file of fs.readdirSync(inputDir)) {
    const full = path.join(inputDir, file);
    const lastUsed = getInputLastUsedUnix(full, file);
    if (lastUsed == null) {
      skipped += 1;
      continue;
    }
    if (pinned.has(file)) {
      skipped += 1;
      continue;
    }
    if (now - lastUsed < ttlSeconds) continue;
    try {
      fs.unlinkSync(full);
      deleted.push(file);
    } catch {
      // best-effort
    }
  }
  return { deleted, skipped };
}

function sweepJobOutputs(getJobs, markDataRemoved, {
  nowMs = Date.now(),
  outputTtlSeconds = OUTPUT_TTL_SECONDS,
  metaTtlSeconds = JOB_META_TTL_SECONDS,
} = {}) {
  if (typeof getJobs !== "function") {
    return { outputsRemoved: 0, jobsPurged: 0 };
  }
  let outputsRemoved = 0;
  let jobsPurged = 0;
  for (const job of getJobs()) {
    if (!job || !job.id) continue;
    const terminal =
      job.status === "succeeded" ||
      job.status === "failed" ||
      job.status === "cancelled";
    if (!terminal) continue;

    const completedMs = Date.parse(job.completed_at || job.created_at || 0);
    if (!Number.isFinite(completedMs)) continue;
    const ageSec = (nowMs - completedMs) / 1000;

    if (
      ageSec >= outputTtlSeconds &&
      !job.data_removed &&
      job.result?.file_name &&
      job.outputDir
    ) {
      const filePath = path.join(job.outputDir, path.basename(job.result.file_name));
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // best-effort
      }
      if (typeof markDataRemoved === "function") {
        markDataRemoved(job.id);
      } else {
        job.data_removed = true;
        if (job.result) {
          job.result.file_name = null;
          job.result.image_url = null;
          job.result.data_removed = true;
        }
      }
      outputsRemoved += 1;
    }

    if (ageSec >= metaTtlSeconds && typeof markDataRemoved === "function") {
      // meta purge handled by scheduler.removeJob if provided via second hook
    }
  }
  return { outputsRemoved, jobsPurged };
}

let _timer = null;

function startRetentionSweeper({
  getComfyInputDir,
  getJobs,
  markDataRemoved,
  removeExpiredJobs,
} = {}) {
  if (_timer) return;
  const tick = () => {
    try {
      const inputDir =
        typeof getComfyInputDir === "function" ? getComfyInputDir() : null;
      const pinned = listPinnedInputFilenames(getJobs);
      const inputResult = sweepInputDir(inputDir, { pinned });
      const outputResult = sweepJobOutputs(getJobs, markDataRemoved);
      if (typeof removeExpiredJobs === "function") {
        removeExpiredJobs(JOB_META_TTL_SECONDS);
      }
      if (inputResult.deleted.length || outputResult.outputsRemoved) {
        console.log(
          `[retention] inputs_deleted=${inputResult.deleted.length} outputs_removed=${outputResult.outputsRemoved}`,
        );
      }
    } catch (err) {
      console.warn(`[retention] sweep failed: ${err.message}`);
    }
  };
  tick();
  _timer = setInterval(tick, CLEANUP_INTERVAL_SECONDS * 1000);
  if (typeof _timer.unref === "function") _timer.unref();
}

function stopRetentionSweeper() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = {
  INPUT_TTL_SECONDS,
  OUTPUT_TTL_SECONDS,
  JOB_META_TTL_SECONDS,
  CLEANUP_INTERVAL_SECONDS,
  expiresAtFromNow,
  expiresAtFromUnix,
  parseInputTimestamp,
  getInputLastUsedUnix,
  touchInputFile,
  expiresAtForInputFile,
  sweepInputDir,
  sweepJobOutputs,
  listPinnedInputFilenames,
  startRetentionSweeper,
  stopRetentionSweeper,
};
