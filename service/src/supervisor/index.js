"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const { getServiceRoot, loadConfig } = require("../config");
const { createLogger } = require("../utils/logger");
const { healthzHandler } = require("../api/healthz");
const { createStatusHandler } = require("../api/status");
const { createGitHubWebhookHandler } = require("../api/githubWebhook");
const { UpdateQueue } = require("../updater/updateQueue");
const { proxyRequest, isServiceRoute } = require("./proxy");
const {
  resolveReleaseRoot,
  startNodeApp,
  waitForHealth,
  getHealthJson,
  cleanupWorkerPid,
} = require("./nodeAppManager");
const { readDeployState, writeDeployState } = require("./deployState");

const serviceRoot = getServiceRoot(__dirname);
const config = loadConfig(serviceRoot);
const log = createLogger(config.dataRoot || serviceRoot);

const startTime = Date.now();
const GPU_POLL_INTERVAL_MS = Number.parseInt(
  process.env.GPU_PROBE_INTERVAL_MS || "30000",
  10,
);
let updateQueue;
let restartRequested = false;
let activeNodeTarget = null;
let nodeAppProcess = null;
let gpuPollTimer = null;

// Shared shutdown function accessible to requestServiceRestart
let shutdownFn;

function ensureDirs() {
  const root = config.dataRoot || serviceRoot;
  const runtimeDir = path.join(root, "runtime");
  const logsDir = path.join(root, "logs");
  const outputsDir = path.join(root, "outputs");
  for (const dir of [runtimeDir, logsDir, outputsDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      log.error("service.start", { error: err.message, dir });
    }
  }
}

function getStatusState() {
  let gpu = {};
  const gpuStatePath = path.join(config.dataRoot || serviceRoot, "runtime", "gpu-state.json");
  try {
    if (fs.existsSync(gpuStatePath)) {
      const raw = fs.readFileSync(gpuStatePath, "utf8");
      gpu = JSON.parse(raw);
    }
  } catch (_) {
    // use empty gpu if file missing or invalid
  }
  return {
    serviceRoot,
    version: config.version,
    uptimeMs: Date.now() - startTime,
    gpu,
    updater: updateQueue ? updateQueue.getStatus() : {},
  };
}

function fetchGpuFromNodeApp(target) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: target.host,
        port: target.port,
        path: "/api/gpu",
        method: "GET",
        timeout: 10000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function pollGpuAndEscalate() {
  const target = activeNodeTarget;
  if (!target) {
    return;
  }
  fetchGpuFromNodeApp(target).then((gpu) => {
    if (!gpu) {
      return;
    }
    const dataRoot = config.dataRoot || serviceRoot;
    const gpuStatePath = path.join(dataRoot, "runtime", "gpu-state.json");
    try {
      fs.mkdirSync(path.join(dataRoot, "runtime"), { recursive: true });
      fs.writeFileSync(gpuStatePath, JSON.stringify(gpu, null, 2));
    } catch (err) {
      log.warn("gpu.state.write_failed", { error: err.message });
    }
    if (gpu.status !== "degraded") {
      return;
    }
    log.warn("gpu.probe.escalate.nodeapp.restart", {
      gpuStatus: gpu.status,
      gpuLastError: gpu.lastError,
    });
    performNodeRollout(resolveReleaseRoot(config.dataRoot)).catch((err) => {
      log.error("gpu.probe.escalate.nodeapp.failed", { error: err.message });
    });
  });
}

function startGpuPollLoop() {
  if (gpuPollTimer) {
    return;
  }
  gpuPollTimer = setInterval(pollGpuAndEscalate, GPU_POLL_INTERVAL_MS);
}

function stopGpuPollLoop() {
  if (gpuPollTimer) {
    clearInterval(gpuPollTimer);
    gpuPollTimer = null;
  }
}

function requestServiceRestart(details = {}) {
  if (restartRequested) {
    log.warn("service.restart.already_requested", details);
    return;
  }

  restartRequested = true;
  log.warn("service.restart.requested", {
    strategy: "process_exit_with_graceful_shutdown",
    ...details,
  });

  setTimeout(() => {
    if (shutdownFn) {
      shutdownFn("restart_from_updater");
    } else {
      log.error("service.restart.shutdown_unavailable", details);
      process.exit(1);
    }
  }, 250);
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

  const nodeAppActivePort = config.ports?.nodeAppActive ?? 3091;
  const nodeAppStagingPort = config.ports?.nodeAppStaging ?? 3092;

  const POST_ROLLOUT_CLEANUP_DELAY_MS = Number(
    process.env.POST_ROLLOUT_CLEANUP_DELAY_MS || "2000",
    10,
  );

  async function performNodeRollout(releaseDir) {
    const stagingPort =
      (activeNodeTarget?.port === nodeAppActivePort
        ? nodeAppStagingPort
        : nodeAppActivePort);
    const releaseRoot = releaseDir || resolveReleaseRoot(config.dataRoot);

    // Get previous server's worker PID so we can clean it up after we tear down the old process.
    let previousWorkerPid = null;
    if (activeNodeTarget) {
      try {
        const health = await getHealthJson(
          activeNodeTarget.host,
          activeNodeTarget.port,
          3000,
        );
        const pid = health?.worker?.pid;
        if (pid != null && Number.isInteger(pid)) {
          previousWorkerPid = pid;
        }
      } catch (err) {
        log.warn("orchestrator.rollout.health_fetch", {
          error: err.message,
          port: activeNodeTarget.port,
        });
      }
    }

    const child = startNodeApp({
      releaseRoot,
      port: stagingPort,
      dataRoot: config.dataRoot || serviceRoot,
      log,
      skipOrphanCleanup: true,
    });
    await waitForHealth("127.0.0.1", stagingPort);

    const oldProcess = nodeAppProcess;
    activeNodeTarget = { host: "127.0.0.1", port: stagingPort };
    nodeAppProcess = child;
    if (oldProcess && oldProcess !== child) {
      try {
        oldProcess.kill("SIGTERM");
      } catch (_) {}
    }

    if (previousWorkerPid != null) {
      setTimeout(() => {
        cleanupWorkerPid(previousWorkerPid, log);
      }, POST_ROLLOUT_CLEANUP_DELAY_MS);
    }

    writeDeployState(config.dataRoot, {
      currentReleaseDir: releaseRoot,
      activeNodePort: stagingPort,
    });
    log.info("orchestrator.nodeapp.rolled", {
      port: stagingPort,
      releaseDir: releaseRoot,
      previousWorkerPid: previousWorkerPid ?? undefined,
    });
  }

  function performPythonRecycle() {
    log.info("orchestrator.python.recycle.requested", {});
    // Python is server-owned; the deploy already did a Node rollout, so the new server
    // will spawn a fresh worker on first generate. No second rollout.
  }

  updateQueue = new UpdateQueue({
    serviceRoot,
    dataRoot: config.dataRoot,
    log,
    onRestartRequired: requestServiceRestart,
    onRollingNodeRollout: performNodeRollout,
    onRollingPythonRecycle: performPythonRecycle,
  });
  updateQueue.start();

  startGpuPollLoop();

  const statusHandler = createStatusHandler(getStatusState);
  const githubWebhookHandler = createGitHubWebhookHandler({
    config,
    log,
    updateQueue,
  });

  const server = http.createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] || "/";

    if (isServiceRoute(urlPath)) {
      if (req.method === "GET" && urlPath === "/healthz") {
        return healthzHandler(req, res);
      }
      if (req.method === "GET" && urlPath === "/status") {
        return statusHandler(req, res);
      }
      if (req.method === "POST" && urlPath === "/webhooks/github") {
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
    }

    if (!activeNodeTarget) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "Service Unavailable",
          message: "Node app backend not ready",
        }),
      );
      return;
    }

    proxyRequest(req, res, activeNodeTarget);
  });

  server.listen(config.port, () => {
    log.info("service.listen", { port: config.port });

    const releaseRoot = resolveReleaseRoot(config.dataRoot);

    (async () => {
      try {
        const child = startNodeApp({
          releaseRoot,
          port: nodeAppActivePort,
          dataRoot: config.dataRoot || serviceRoot,
          log,
        });
        nodeAppProcess = child;
        await waitForHealth("127.0.0.1", nodeAppActivePort);
        activeNodeTarget = { host: "127.0.0.1", port: nodeAppActivePort };
        log.info("orchestrator.nodeapp.ready", {
          port: nodeAppActivePort,
          releaseRoot,
        });
        writeDeployState(config.dataRoot, {
          currentReleaseDir: releaseRoot,
          activeNodePort: nodeAppActivePort,
        });
      } catch (err) {
        log.error("orchestrator.nodeapp.start_failed", {
          error: err.message,
          port: nodeAppActivePort,
          releaseRoot,
        });
        if (nodeAppProcess) {
          try {
            nodeAppProcess.kill("SIGTERM");
          } catch (_) {}
          nodeAppProcess = null;
        }
      }
    })();
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
    const isDeploymentRestart = reason === "restart_from_updater";
    log.info("service.stop", {
      reason,
      type: isDeploymentRestart ? "deployment_restart" : "shutdown",
      timestamp: new Date().toISOString(),
    });
    if (nodeAppProcess) {
      try {
        nodeAppProcess.kill("SIGTERM");
      } catch (err) {
        log.error("service.stop.nodeapp.error", { error: err.message });
      }
      nodeAppProcess = null;
    }
    activeNodeTarget = null;

    try {
      if (updateQueue) {
        await updateQueue.stop();
      }
    } catch (err) {
      log.error("service.stop.updater.error", { error: err.message });
    }
    stopGpuPollLoop();
    const exitCode = isDeploymentRestart ? 1 : 0;
    const forcedExitTimer = setTimeout(
      () => {
        log.warn("service.stop.force_exit", {
          reason,
          exitCode,
        });
        process.exit(exitCode);
      },
      Number.parseInt(process.env.SERVICE_STOP_FORCE_EXIT_MS || "10000", 10),
    );
    forcedExitTimer.unref();

    server.close(() => {
      clearTimeout(forcedExitTimer);
      // Use exit code 1 for deployment restarts so WinSW will auto-restart.
      // Use exit code 0 for normal shutdowns.
      process.exit(exitCode);
    });
  }

  // Make shutdown available to requestServiceRestart
  shutdownFn = shutdown;

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

main();
