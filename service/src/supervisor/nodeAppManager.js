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

function normalizeFsPath(p) {
  return path.resolve(String(p || ""));
}

/**
 * True if /api/health payload was served from expectedReleaseRoot
 * (public_dir_abs is …/<release>/server/public).
 */
function healthMatchesRelease(health, expectedReleaseRoot) {
  if (!expectedReleaseRoot) return true;
  const expected = normalizeFsPath(expectedReleaseRoot);
  const abs = health && health.public_dir_abs;
  if (typeof abs === "string" && abs.trim()) {
    const resolved = normalizeFsPath(abs);
    return (
      resolved === expected ||
      resolved.startsWith(expected + path.sep)
    );
  }
  // Fallback when only relative public_dir is present.
  const rel = String((health && health.public_dir) || "");
  const releaseId = path.basename(expected);
  return Boolean(releaseId && rel.includes(releaseId));
}

function childExited(child) {
  return Boolean(child && (child.exitCode != null || child.signalCode != null));
}

/**
 * Wait until /api/health returns 200.
 * When expectedReleaseRoot is set, also require public_dir to belong to that release
 * so a stale process on the same port cannot satisfy the check.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 * @param {{ expectedReleaseRoot?: string, child?: import('child_process').ChildProcess }} [opts]
 */
function waitForHealth(host, port, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS, opts = {}) {
  const expectedReleaseRoot = opts.expectedReleaseRoot || null;
  const child = opts.child || null;

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let sawWrongRelease = false;
    let lastWrongPublicDir = null;

    function attempt() {
      if (childExited(child)) {
        reject(
          new Error(
            `Node app exited before becoming healthy (code=${child.exitCode}, signal=${child.signalCode})`,
          ),
        );
        return;
      }
      if (Date.now() >= deadline) {
        const hint = sawWrongRelease
          ? ` Staging port may be occupied by another release (public_dir=${lastWrongPublicDir || "?"}).`
          : "";
        reject(new Error(`Node app health check timed out.${hint}`));
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
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            raw += chunk;
          });
          res.on("end", () => {
            if (res.statusCode !== 200) {
              schedule();
              return;
            }
            let health = {};
            try {
              health = raw ? JSON.parse(raw) : {};
            } catch {
              schedule();
              return;
            }
            if (!healthMatchesRelease(health, expectedReleaseRoot)) {
              sawWrongRelease = true;
              lastWrongPublicDir =
                health.public_dir_abs || health.public_dir || null;
              schedule();
              return;
            }
            resolve(health);
          });
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

/**
 * If something already answers on host:port, ensure it is the expected release.
 * Connection errors mean the port is free (OK). Wrong release => throw.
 */
async function assertPortServesReleaseOrFree(
  host,
  port,
  expectedReleaseRoot,
  timeoutMs = 1500,
) {
  if (!expectedReleaseRoot) return { free: true };
  let health;
  try {
    health = await getHealthJson(host, port, timeoutMs);
  } catch {
    return { free: true };
  }
  if (healthMatchesRelease(health, expectedReleaseRoot)) {
    return { free: false, alreadyDesired: true, health };
  }
  const publicDir = health.public_dir_abs || health.public_dir || "?";
  throw new Error(
    `Port ${port} is occupied by another release (public_dir=${publicDir}); refusing rollout cutover`,
  );
}

const WORKER_PID_FILE = "runtime/.worker.pid";
const SCHEDULER_HOLD_FILE = "runtime/scheduler.hold";
const DEFAULT_COMFY_DRAIN_TIMEOUT_MS = 2_700_000; // 45m — one video job
// After the GPU finishes, the Node still downloads/transcodes the output.
// Wait a bounded extra window for that tail instead of killing a done job.
const DEFAULT_COMFY_DRAIN_TAIL_TIMEOUT_MS = 600_000; // 10m
const COMFY_DRAIN_POLL_MS = 2000;
const DRAIN_HEALTH_FAILURE_THRESHOLD = 3;

function schedulerHoldPath(dataRoot) {
  return path.join(dataRoot || "", SCHEDULER_HOLD_FILE);
}

function writeSchedulerHold(dataRoot, log) {
  if (!dataRoot) return null;
  const holdPath = schedulerHoldPath(dataRoot);
  try {
    fs.mkdirSync(path.dirname(holdPath), { recursive: true });
    fs.writeFileSync(holdPath, `${new Date().toISOString()}\n`);
    if (log) log.info("orchestrator.scheduler.hold", { path: holdPath });
  } catch (err) {
    if (log) {
      log.warn("orchestrator.scheduler.hold_failed", { error: err.message });
    }
  }
  return holdPath;
}

function clearSchedulerHold(dataRoot, log) {
  if (!dataRoot) return;
  const holdPath = schedulerHoldPath(dataRoot);
  try {
    fs.unlinkSync(holdPath);
    if (log) log.info("orchestrator.scheduler.release", { path: holdPath });
  } catch (err) {
    if (err && err.code !== "ENOENT" && log) {
      log.warn("orchestrator.scheduler.release_failed", { error: err.message });
    }
  }
}

/**
 * True when Comfy reports a running or queued prompt.
 * Unknown queue while Comfy is up is treated as busy so we do not cut over mid-job.
 */
function isComfyBusyFromHealth(health) {
  const comfy = health && health.comfy;
  if (!comfy || comfy.running !== true) return false;
  const q = comfy.queue;
  if (comfy.queue_http_status !== 200 || !q || typeof q !== "object") {
    return true;
  }
  const running = Array.isArray(q.queue_running) ? q.queue_running.length : 0;
  const pending = Array.isArray(q.queue_pending) ? q.queue_pending.length : 0;
  return running + pending > 0;
}

/** In-flight job count from the Node scheduler as reported by /api/health. */
function schedulerRunningCount(health) {
  const n = health && health.jobs && health.jobs.runningCount;
  return typeof n === "number" && n > 0 ? n : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the current generation is fully finished before a cutover.
 *
 * Two phases:
 * - Comfy busy (prompt on the GPU): wait up to timeoutMs.
 * - Comfy idle but scheduler still has a running job (Node is downloading /
 *   transcoding the output): wait up to tailTimeoutMs from the moment the
 *   GPU went idle. This bounds a stuck scheduler row so deploys cannot hang.
 *
 * timeoutMs <= 0 skips waiting entirely (used by GPU-degraded escalation,
 * which must never wait on the engine it is trying to recover).
 * Node unreachable (several consecutive probe failures) counts as idle.
 */
async function waitForComfyIdle(host, port, opts = {}) {
  const timeoutMs =
    opts.timeoutMs != null
      ? Number(opts.timeoutMs)
      : Number(process.env.COMFY_DRAIN_TIMEOUT_MS || DEFAULT_COMFY_DRAIN_TIMEOUT_MS);
  const tailTimeoutMs =
    opts.tailTimeoutMs != null
      ? Number(opts.tailTimeoutMs)
      : Number(
          process.env.COMFY_DRAIN_TAIL_TIMEOUT_MS ||
            DEFAULT_COMFY_DRAIN_TAIL_TIMEOUT_MS,
        );
  const pollMs = opts.pollMs != null ? Number(opts.pollMs) : COMFY_DRAIN_POLL_MS;
  const log = opts.log;
  const deadline = Date.now() + timeoutMs;
  let tailDeadline = null;
  let healthFailures = 0;

  while (Date.now() < deadline) {
    let health;
    try {
      health = await getHealthJson(host, port, opts.healthTimeoutMs || 3000);
      healthFailures = 0;
    } catch (err) {
      healthFailures += 1;
      if (healthFailures >= DRAIN_HEALTH_FAILURE_THRESHOLD) {
        if (log) {
          log.info("orchestrator.drain.node_unreachable", {
            error: err.message,
            port,
          });
        }
        return { idle: true, reason: "node_unreachable" };
      }
      await sleep(pollMs);
      continue;
    }

    const comfyBusy = isComfyBusyFromHealth(health);
    const runningJobs = schedulerRunningCount(health);
    if (!comfyBusy && runningJobs === 0) {
      return { idle: true, reason: "idle" };
    }

    if (comfyBusy) {
      tailDeadline = null;
    } else {
      // GPU done; Node is finishing the job (download / transcode).
      if (tailDeadline == null) tailDeadline = Date.now() + tailTimeoutMs;
      if (Date.now() >= tailDeadline) {
        if (log) {
          log.warn("orchestrator.drain.tail_timeout", { port, tailTimeoutMs });
        }
        return { idle: true, reason: "tail_timeout" };
      }
    }

    const q = health && health.comfy && health.comfy.queue;
    if (log) {
      log.info("orchestrator.drain.waiting", {
        port,
        comfyBusy,
        runningJobs,
        queueRunning: Array.isArray(q?.queue_running)
          ? q.queue_running.length
          : null,
        queuePending: Array.isArray(q?.queue_pending)
          ? q.queue_pending.length
          : null,
      });
    }
    await sleep(pollMs);
  }

  if (timeoutMs > 0 && log) {
    log.warn("orchestrator.drain.timeout", { port, timeoutMs });
  }
  return { idle: false, reason: "timeout" };
}

/**
 * If an engine PID file exists under dataRoot, kill that process (orphan from a
 * previous run) and remove the file. Ensures we don't leave a Comfy (or other engine)
 * process running when the server was hard-killed. Call before starting the Node app.
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
 * the previous server's generation engine if it survived (e.g. old Node was SIGKILL'd).
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
          if (res.statusCode !== 200) {
            reject(new Error(`Health HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            reject(new Error("Health response was not JSON"));
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
    env.CDN_DIR = path.join(dataRoot, "cdn");
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
  healthMatchesRelease,
  assertPortServesReleaseOrFree,
  startNodeApp,
  killOrphanWorker,
  cleanupWorkerPid,
  getHealthJson,
  schedulerHoldPath,
  writeSchedulerHold,
  clearSchedulerHold,
  isComfyBusyFromHealth,
  schedulerRunningCount,
  waitForComfyIdle,
};
