#!/usr/bin/env node
"use strict";

/**
 * Smoke test for the orchestrator (port 3090).
 * Hits service routes and verifies proxy to Node app when backend is up.
 * Run after starting the service: node service/scripts/smoke-test-orchestrator.js
 */

const http = require("http");

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3090";

function request(method, path) {
  const u = new URL(path, BASE);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 3090,
        path: u.pathname + u.search,
        method,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ statusCode: res.statusCode, body }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

async function main() {
  const checks = [];

  const healthz = await request("GET", "/healthz").catch((e) => ({
    statusCode: 0,
    body: e.message,
  }));
  checks.push({
    name: "GET /healthz",
    ok: healthz.statusCode === 200,
    status: healthz.statusCode,
  });

  const status = await request("GET", "/status").catch((e) => ({
    statusCode: 0,
    body: e.message,
  }));
  checks.push({
    name: "GET /status",
    ok: status.statusCode === 200,
    status: status.statusCode,
  });

  const apiHealth = await request("GET", "/api/health").catch((e) => ({
    statusCode: 0,
    body: e.message,
  }));
  checks.push({
    name: "GET /api/health (proxied)",
    ok: apiHealth.statusCode === 200 || apiHealth.statusCode === 503,
    status: apiHealth.statusCode,
    note:
      apiHealth.statusCode === 503
        ? "backend not ready (expected if Node app not up)"
        : undefined,
  });

  const failed = checks.filter((c) => !c.ok);
  checks.forEach((c) => {
    console.log(
      (c.ok ? "ok" : "FAIL") +
        " " +
        c.name +
        " " +
        c.status +
        (c.note ? " (" + c.note + ")" : ""),
    );
  });
  if (failed.length > 0) {
    process.exitCode = 1;
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
