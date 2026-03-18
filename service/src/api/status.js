"use strict";

const path = require("path");

function relativeToService(p, serviceRoot) {
  if (!p) return ".";
  const rel = path.relative(serviceRoot, p);
  if (!rel || rel === "") return ".";
  // If outside serviceRoot, keep absolute to avoid ".." segments.
  if (rel.startsWith("..")) return p;
  return rel;
}

/**
 * GET /status — runtime information.
 */
function createStatusHandler(getState) {
  return function statusHandler(_req, res) {
    const state = typeof getState === "function" ? getState() : {};
    const cwdAbs = process.cwd();
    const serviceRoot = state.serviceRoot || cwdAbs;
    const workingDirectory = relativeToService(cwdAbs, serviceRoot);
    const payload = {
      version: state.version || "0.0.0",
      uptime: state.uptimeMs != null ? state.uptimeMs : 0,
      parentPid: process.pid,
      workingDirectory,
      workingDirectoryAbs: cwdAbs,
      worker: state.worker != null ? state.worker : {},
      gpu: state.gpu != null ? state.gpu : {},
      updater: state.updater != null ? state.updater : {},
    };
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify(payload, null, 2));
  };
}

module.exports = {
  createStatusHandler,
};
