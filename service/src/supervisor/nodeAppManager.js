"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const DEFAULT_HEALTH_TIMEOUT_MS = 30000;
const HEALTH_POLL_MS = 500;

function resolveReleaseRoot(dataRoot) {
  const currentPath = path.join(dataRoot || "", "runtime", "current");
  try {
    if (fs.existsSync(currentPath)) {
      return fs.realpathSync(currentPath);
    }
  } catch (_) {
    // ignore
  }
  return process.cwd();
}

function waitForHealth(host, port, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      if (Date.now() >= deadline) {
        reject(new Error("Node app health check timed out"));
        return;
      }
      const req = http.request(
        {
          host,
          port,
          path: "/api/health",
          method: "GET",
          timeout: 2000,
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          schedule();
        },
      );
      req.on("error", () => schedule());
      req.on("timeout", () => {
        req.destroy();
        schedule();
      });
      req.end();
    }

    function schedule() {
      setTimeout(attempt, HEALTH_POLL_MS);
    }

    attempt();
  });
}

const WORKER_PID_FILE = "runtime/.worker.pid";

/**
 * If a worker PID file exists under dataRoot, kill that process (orphan from a
 * previous run) and remove the file. Ensures we don't leave a Python worker
 * running when the server was hard-killed. Call before starting the Node app.
 */
function killOrphanWorker(dataRoot, log) {
  if (!dataRoot) return;
  const pidPath = path.join(dataRoot, WORKER_PID_FILE);
  if (!fs.existsSync(pidPath)) return;
  let pid;
  try {
    pid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
  } catch (err) {
    if (log) log.warn("nodeapp.orphan_worker.read_failed", { path: pidPath, error: err.message });
    try {
      fs.unlinkSync(pidPath);
    } catch (_) {}
    return;
  }
  if (!pid || isNaN(pid)) {
    try {
      fs.unlinkSync(pidPath);
    } catch (_) {}
    return;
  }
  try {
    process.kill(pid, 0);
  } catch {
    if (log) log.info("nodeapp.orphan_worker.stale", { pid, path: pidPath });
    try {
      fs.unlinkSync(pidPath);
    } catch (_) {}
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    if (log) log.info("nodeapp.orphan_worker.killed", { pid, path: pidPath });
  } catch (err) {
    if (log) log.warn("nodeapp.orphan_worker.kill_failed", { pid, error: err.message });
  }
  try {
    fs.unlinkSync(pidPath);
  } catch (_) {}
}

/**
 * Kill a specific process if it is still running. Used after rollout to clean up
 * the previous server's worker if it survived (e.g. old Node was SIGKILL'd).
 * Does not touch the PID file.
 */
function cleanupWorkerPid(pid, log) {
  if (pid == null || !Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 0);
  } catch {
    return; // process already gone
  }
  try {
    process.kill(pid, "SIGTERM");
    if (log) log.info("nodeapp.previous_worker.killed", { pid });
  } catch (err) {
    if (log) log.warn("nodeapp.previous_worker.kill_failed", { pid, error: err.message });
  }
}

/**
 * Fetch /api/health from a Node app and return the parsed JSON body.
 */
function getHealthJson(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path: "/api/health",
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            resolve({});
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Health request timed out"));
    });
    req.end();
  });
}

function startNodeApp({ releaseRoot, port, dataRoot, log, skipOrphanCleanup = false }) {
  if (!skipOrphanCleanup) {
    killOrphanWorker(dataRoot, log);
  }

  const serverPath = path.join(releaseRoot, "server", "server.js");
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Node server not found: ${serverPath}`);
  }

  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
  };
  if (dataRoot != null && dataRoot !== "") {
    env.DATA_ROOT = dataRoot;
    env.OUTPUT_DIR = path.join(dataRoot, "outputs");
  }

  const child = spawn("node", [serverPath], {
    cwd: releaseRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (log) {
    child.stdout?.on("data", (chunk) =>
      log.info("nodeapp.stdout", { msg: String(chunk).trim() }),
    );
    child.stderr?.on("data", (chunk) =>
      log.warn("nodeapp.stderr", { msg: String(chunk).trim() }),
    );
  }

  child.on("error", (err) => {
    if (log) log.error("nodeapp.error", { error: err.message });
  });

  return child;
}

module.exports = {
  resolveReleaseRoot,
  waitForHealth,
  startNodeApp,
  killOrphanWorker,
  cleanupWorkerPid,
  getHealthJson,
};
