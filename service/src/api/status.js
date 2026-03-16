'use strict';

/**
 * GET /status — runtime information.
 * Phase 1: version, uptime, parentPid; worker/gpu/updater are empty stubs.
 */
function createStatusHandler(getState) {
  return function statusHandler(_req, res) {
    const state = typeof getState === 'function' ? getState() : {};
    const payload = {
      version: state.version || '0.0.0',
      uptime: state.uptimeMs != null ? state.uptimeMs : 0,
      parentPid: process.pid,
      worker: state.worker != null ? state.worker : {},
      gpu: state.gpu != null ? state.gpu : {},
      updater: state.updater != null ? state.updater : {},
    };
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(payload, null, 2));
  };
}

module.exports = {
  createStatusHandler,
};
