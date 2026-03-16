"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { getServiceRoot, loadConfig } = require("../config");
const { createLogger } = require("../utils/logger");
const { healthzHandler } = require("../api/healthz");
const { createStatusHandler } = require("../api/status");
const { WorkerManager } = require("./workerManager");

const serviceRoot = getServiceRoot(__dirname);
const config = loadConfig(serviceRoot);
const log = createLogger(serviceRoot);

const startTime = Date.now();
let workerManager;

function ensureDirs() {
  const runtimeDir = path.join(serviceRoot, "runtime");
  const logsDir = path.join(serviceRoot, "logs");
  for (const dir of [runtimeDir, logsDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      log.error("service.start", { error: err.message, dir });
    }
  }
}

function getStatusState() {
  return {
    version: config.version,
    uptimeMs: Date.now() - startTime,
    worker: workerManager ? workerManager.getStatus() : {},
    gpu: {},
    updater: {},
  };
}

function main() {
  ensureDirs();

  const serviceAccount = process.env.USERNAME || process.env.USER || "unknown";
  const workingDir = process.cwd();
  const hostname = os.hostname();

  log.info("service.start", {
    timestamp: new Date().toISOString(),
    hostname,
    version: config.version,
    serviceAccount,
    workingDirectory: workingDir,
    processPid: process.pid,
  });

  workerManager = new WorkerManager({
    serviceRoot,
    log,
    mode: process.env.WORKER_MODE || "normal",
  });

  const statusHandler = createStatusHandler(getStatusState);

  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] || "/";
    if (req.method === "GET" && url === "/healthz") {
      return healthzHandler(req, res);
    }
    if (req.method === "GET" && url === "/status") {
      return statusHandler(req, res);
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  });

  let workersStarted = false;
  server.listen(config.port, () => {
    if (!workersStarted) {
      workerManager.start();
      workersStarted = true;
    }
    log.info("service.listen", { port: config.port });
  });

  server.on("error", (err) => {
    log.error("service.listen.error", { error: err.message });
    process.exitCode = 1;
    shutdown("listen_error");
  });

  let shuttingDown = false;
  async function shutdown(reason) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info("service.stop", { reason });
    try {
      if (workerManager) {
        await workerManager.stop();
      }
    } catch (err) {
      log.error("service.stop.worker.error", { error: err.message });
    }
    server.close(() => process.exit(0));
  }

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

main();
