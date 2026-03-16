'use strict';

/**
 * GET /healthz — liveness probe.
 * Returns 200 and { ok: true }.
 */
function healthzHandler(_req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}

module.exports = {
  healthzHandler,
};
