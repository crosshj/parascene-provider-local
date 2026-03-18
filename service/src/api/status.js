"use strict";

const path = require("path");

/**
 * GET /status — runtime information.
 * Phase 1: version, uptime, parentPid; worker/gpu/updater are empty stubs.
 */
function createStatusHandler(getState) {
  return function statusHandler(_req, res) {
    const state = typeof getState === "function" ? getState() : {};
    const cwdAbs = process.cwd();
    const serviceRoot = state.serviceRoot || cwdAbs;
    const workingDirectory = path.relative(serviceRoot, cwdAbs) || ".";
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
