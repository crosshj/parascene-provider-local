"use strict";

function relativeToService(p, serviceRoot) {
  if (!p) return ".";
  // Convert absolute paths into "path relative to the directory named /service".
  const norm = String(p).replace(/\\/g, "/");
  const lower = norm.toLowerCase();
  const marker = "/service/";
  const idx = lower.lastIndexOf(marker);
  if (idx !== -1) {
    const rel = norm.slice(idx + marker.length);
    return rel || ".";
  }
  const marker2 = "/service";
  const idx2 = lower.lastIndexOf(marker2);
  if (idx2 !== -1) {
    const rel = norm.slice(idx2 + marker2.length).replace(/^\/+/, "");
    return rel || ".";
  }
  return ".";
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
