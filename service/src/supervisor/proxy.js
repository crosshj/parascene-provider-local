"use strict";

const http = require("http");

/**
 * Forward an incoming HTTP request to a backend and pipe the response back.
 * Used by the orchestrator to proxy provider traffic to the Node app (3091/3092).
 */
function proxyRequest(req, res, target) {
  const { host, port } = target;
  const path = req.url || "/";
  const method = req.method || "GET";
  const headers = { ...req.headers };
  delete headers.host;

  const proxyReq = http.request(
    {
      host,
      port,
      path,
      method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "Bad Gateway",
          message: "Backend unreachable",
        }),
      );
    }
  });

  req.pipe(proxyReq, { end: true });
}

/**
 * Returns true if the path should be handled by the orchestrator itself
 * (health, status, webhooks). Everything else is proxied to the Node app.
 */
function isServiceRoute(urlPath) {
  const p = urlPath || "/";
  return (
    p === "/healthz" ||
    p === "/status" ||
    p === "/webhooks/github"
  );
}

module.exports = {
  proxyRequest,
  isServiceRoute,
};
