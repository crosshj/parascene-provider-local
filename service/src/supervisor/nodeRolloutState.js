"use strict";

const fs = require("fs");
const path = require("path");

const FILE_NAME = "node-rollout.json";

function rolloutStatePath(dataRoot) {
  return path.join(dataRoot || "", "runtime", FILE_NAME);
}

function readNodeRollout(dataRoot) {
  try {
    const filePath = rolloutStatePath(dataRoot);
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeNodeRollout(dataRoot, record = {}) {
  const filePath = rolloutStatePath(dataRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    ok: Boolean(record.ok),
    at: record.at || new Date().toISOString(),
    source: record.source || "rollout",
    releaseDir: record.releaseDir || null,
    port: record.port ?? null,
    error: record.ok ? null : String(record.error || "cutover failed"),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * True when the live Node public dir belongs to releaseId.
 * null when either side is missing.
 */
function apiPublicDirMatchesRelease(publicDir, releaseId) {
  if (!publicDir || !releaseId) return null;
  const dir = String(publicDir).replace(/\\/g, "/");
  return dir.includes(String(releaseId));
}

module.exports = {
  rolloutStatePath,
  readNodeRollout,
  writeNodeRollout,
  apiPublicDirMatchesRelease,
};
