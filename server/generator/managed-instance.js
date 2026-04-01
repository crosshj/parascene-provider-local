"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const COMFY_ROOT = "D:/comfy";
const COMFY_HOST = "127.0.0.1";
const COMFY_PORT = 8188;
const COMFY_HEALTHCHECK_TIMEOUT_MS = 4_000;

/** DATA_ROOT/runtime when set (service); else repo runtime/ (standalone, aligns with scheduler jobs dir). */
function getEnginePidFilePath() {
  const dataRoot = process.env.DATA_ROOT;
  if (dataRoot) {
    return path.join(dataRoot, "runtime", ".worker.pid");
  }
  const repoRoot = path.dirname(path.dirname(__dirname));
  return path.join(repoRoot, "runtime", ".worker.pid");
}

function writeEnginePid(pid) {
  if (pid == null || !Number.isInteger(pid)) return;
  try {
    const pidFile = getEnginePidFilePath();
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(pid));
  } catch {
    /* ignore */
  }
}

function clearEnginePid() {
  try {
    fs.unlinkSync(getEnginePidFilePath());
  } catch {
    /* ignore */
  }
}

function killOrphanEngineFromPidFile() {
  const pidFile = getEnginePidFilePath();
  let pid;
  try {
    pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
  } catch {
    clearEnginePid();
    return;
  }
  if (!pid || isNaN(pid)) {
    clearEnginePid();
    return;
  }
  try {
    process.kill(pid, 0);
  } catch {
    console.log(`[comfy] stale engine PID file (process ${pid} gone), removed`);
    clearEnginePid();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[comfy] killed orphaned engine pid=${pid}`);
  } catch (err) {
    console.warn(`[comfy] failed to kill orphan pid=${pid}:`, err.message);
  }
  clearEnginePid();
}

if (!process.env.DATA_ROOT) {
  killOrphanEngineFromPidFile();
}

let _proc = null;
let _startingPromise = null;

function _url(pathname) {
  return `http://${COMFY_HOST}:${COMFY_PORT}${pathname}`;
}

async function _fetchJsonEndpoint(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    COMFY_HEALTHCHECK_TIMEOUT_MS,
  );
  try {
    const res = await fetch(_url(pathname), {
      method: "GET",
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      data,
    };
  } catch {
    return {
      ok: false,
      status: null,
      data: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function _fetchSystemStats() {
  return _fetchJsonEndpoint("/system_stats");
}

async function _fetchQueue() {
  return _fetchJsonEndpoint("/queue");
}

async function _healthcheck() {
  const stats = await _fetchSystemStats();
  return stats.ok;
}

function _resolvePython() {
  const embedded = path.join(COMFY_ROOT, "python_embeded", "python.exe");
  if (fs.existsSync(embedded)) return embedded;
  return "python";
}

function _spawnComfy() {
  // Kill any process listening on COMFY_PORT (Windows only)
  if (process.platform === "win32") {
    try {
      const netstatOut = execSync(
        `netstat -aon | findstr :${COMFY_PORT}.*LISTENING`,
        { encoding: "utf8" },
      );
      const lines = netstatOut.split("\n");
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parts[4];
          if (pid && !isNaN(Number(pid))) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        try {
          console.log(`Killing PID ${pid} on port ${COMFY_PORT}...`);
          execSync(`taskkill /F /PID ${pid}`);
        } catch {
          // Ignore errors if process already exited
        }
      }
    } catch {
      // No process found or netstat failed, ignore
    }
  }
  if (!fs.existsSync(COMFY_ROOT)) {
    throw new Error(`Comfy root not found at ${COMFY_ROOT}`);
  }
  const mainPy = path.join(COMFY_ROOT, "ComfyUI", "main.py");
  if (!fs.existsSync(mainPy)) {
    throw new Error(`Comfy main.py not found at ${mainPy}`);
  }

  const pythonCmd = _resolvePython();
  const child = spawn(
    pythonCmd,
    [
      "ComfyUI/main.py",
      "--listen",
      COMFY_HOST,
      "--port",
      String(COMFY_PORT),
      "--windows-standalone-build",
      "--disable-auto-launch",
    ],
    {
      cwd: COMFY_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[comfy] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[comfy] ${chunk.toString()}`);
  });
  child.on("exit", (code) => {
    if (_proc === child) {
      _proc = null;
      clearEnginePid();
    }
    console.warn(`[comfy] process exited (code=${code})`);
  });

  _proc = child;
  writeEnginePid(child.pid);
  console.log(`[comfy] started managed instance pid=${child.pid ?? "unknown"}`);
  return child;
}

async function ensureManagedComfyReady() {
  if (await _healthcheck()) return { running: true, managed: false, pid: null };
  if (_proc && _proc.exitCode === null) {
    return { running: false, managed: true, pid: _proc.pid ?? null };
  }

  if (!_startingPromise) {
    _startingPromise = (async () => {
      _spawnComfy();
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        if (await _healthcheck()) {
          return { running: true, managed: true, pid: _proc?.pid ?? null };
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      throw new Error("Timed out waiting for managed Comfy to become healthy.");
    })().finally(() => {
      _startingPromise = null;
    });
  }

  return _startingPromise;
}

async function getManagedComfyStatus() {
  const [stats, queue] = await Promise.all([
    _fetchSystemStats(),
    _fetchQueue(),
  ]);
  return {
    running: stats.ok,
    managed: !!(_proc && _proc.exitCode === null),
    pid: _proc && _proc.exitCode === null ? (_proc.pid ?? null) : null,
    host: COMFY_HOST,
    port: COMFY_PORT,
    root: COMFY_ROOT,
    system_stats: stats.data,
    system_stats_http_status: stats.status,
    queue: queue.data,
    queue_http_status: queue.status,
  };
}

function stopManagedComfy() {
  if (!_proc) return;
  try {
    _proc.kill("SIGTERM");
  } catch {
    // Ignore shutdown failures.
  }
  _proc = null;
  clearEnginePid();
}

process.on("exit", stopManagedComfy);
process.on("SIGTERM", () => {
  stopManagedComfy();
});
process.on("SIGINT", () => {
  stopManagedComfy();
});

module.exports = {
  COMFY_HOST,
  COMFY_PORT,
  ensureManagedComfyReady,
  getManagedComfyStatus,
  getEnginePidFilePath,
};
