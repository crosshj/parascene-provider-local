"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { getServiceRoot, loadConfig } = require("../config");
const { createLogger } = require("../utils/logger");
const { healthzHandler } = require("../api/healthz");
const { createStatusHandler } = require("../api/status");
const { createGitHubWebhookHandler } = require("../api/githubWebhook");
const { createProviderApiHandler } = require("../api/providerApi");
const { UpdateQueue } = require("../updater/updateQueue");
const { GpuProbe } = require("../gpu/gpuProbe");
const { WorkerManager } = require("./workerManager");

const serviceRoot = getServiceRoot(__dirname);
const config = loadConfig(serviceRoot);
const log = createLogger(config.dataRoot || serviceRoot);

const startTime = Date.now();
let workerManager;
let updateQueue;
let gpuProbe;

function ensureDirs() {
  const root = config.dataRoot || serviceRoot;
  const runtimeDir = path.join(root, "runtime");
  const logsDir = path.join(root, "logs");
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
    gpu: gpuProbe ? gpuProbe.getStatus() : {},
    updater: updateQueue ? updateQueue.getStatus() : {},
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
    dataRoot: config.dataRoot,
    log,
    mode: process.env.WORKER_MODE || "normal",
    impl: process.env.WORKER_IMPL || "python",
  });
  updateQueue = new UpdateQueue({
    serviceRoot,
    dataRoot: config.dataRoot,
    log,
  });
  updateQueue.start();

  gpuProbe = new GpuProbe({
    serviceRoot,
    dataRoot: config.dataRoot,
    log,
    onFailure: ({ at, state }) => {
      const worker = workerManager ? workerManager.getStatus() : {};
      if (worker && worker.state === "unhealthy") {
        log.warn("gpu.probe.escalate.worker.restart", {
          at,
          workerState: worker.state,
          gpuStatus: state.status,
          gpuLastError: state.lastError,
        });
        workerManager.requestRestart("gpu_failure_and_worker_unhealthy");
      }
    },
  });
  gpuProbe.start();

  const statusHandler = createStatusHandler(getStatusState);
  const githubWebhookHandler = createGitHubWebhookHandler({
    config,
    log,
    updateQueue,
  });
  const providerApiHandler = createProviderApiHandler({
    log,
  });

  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] || "/";
    if (req.method === "GET" && url === "/healthz") {
      return healthzHandler(req, res);
    }
    if (req.method === "GET" && url === "/status") {
      return statusHandler(req, res);
    }
    if (req.method === "POST" && url === "/webhooks/github") {
      githubWebhookHandler(req, res).catch((err) => {
        log.error("webhook.github.unhandled", { error: err.message });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Internal error" }));
        }
      });
      return;
    }

    providerApiHandler(req, res)
      .then((handled) => {
        if (handled) {
          return;
        }
        if (res.headersSent) {
          return;
        }
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Not found" }));
      })
      .catch((err) => {
        log.error("api.unhandled", { error: err.message });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Internal error" }));
        }
      });
    return;
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
    try {
      if (updateQueue) {
        await updateQueue.stop();
      }
    } catch (err) {
      log.error("service.stop.updater.error", { error: err.message });
    }
    try {
      if (gpuProbe) {
        gpuProbe.stop();
      }
    } catch (err) {
      log.error("service.stop.gpu.error", { error: err.message });
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
