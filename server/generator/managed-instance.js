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
let _lastSpawnError = null;
let _lastExit = null;
const _recentComfyLogs = [];
const RECENT_COMFY_LOG_LIMIT = 200;

function _url(pathname) {
  return `http://${COMFY_HOST}:${COMFY_PORT}${pathname}`;
}

function _rememberComfyLog(stream, chunk) {
  const text = String(chunk || "").replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const now = new Date().toISOString();
  for (const line of lines) {
    _recentComfyLogs.push({ at: now, stream, line });
  }
  if (_recentComfyLogs.length > RECENT_COMFY_LOG_LIMIT) {
    _recentComfyLogs.splice(0, _recentComfyLogs.length - RECENT_COMFY_LOG_LIMIT);
  }
}

function _tailComfyLogs(limit = 25, stream = null) {
  const source = stream
    ? _recentComfyLogs.filter((item) => item.stream === stream)
    : _recentComfyLogs;
  return source
    .slice(Math.max(0, source.length - limit))
    .map((item) => `[${item.at}] [${item.stream}] ${item.line}`);
}

function _makeStartupDiagnostics(reason) {
  return {
    reason,
    host: COMFY_HOST,
    port: COMFY_PORT,
    root: COMFY_ROOT,
    managedPid: _proc?.pid ?? null,
    managedExitCode: _proc?.exitCode ?? null,
    managedSignalCode: _proc?.signalCode ?? null,
    lastSpawnError: _lastSpawnError
      ? {
          message: _lastSpawnError.message,
          code: _lastSpawnError.code || null,
        }
      : null,
    lastExit: _lastExit,
    recentStderr: _tailComfyLogs(20, "stderr"),
  };
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

function _killListenersOnComfyPort() {
  if (process.platform !== "win32") return;
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

function _clearManagedProcRef() {
  _proc = null;
  clearEnginePid();
}

function _stopManagedComfyProcess() {
  if (!_proc) return;
  try {
    _proc.kill("SIGTERM");
  } catch {
    // Ignore shutdown failures.
  }
  _clearManagedProcRef();
}

async function _waitForHealthy(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await _healthcheck()) {
      return { running: true, managed: true, pid: _proc?.pid ?? null };
    }
    if (_proc && _proc.exitCode != null) {
      const diagnostics = _makeStartupDiagnostics(
        "managed process exited before healthcheck passed",
      );
      console.error("[comfy] startup failed", diagnostics);
      throw new Error(
        `Comfy failed during startup (exit=${_proc.exitCode}, signal=${_proc.signalCode ?? "n/a"}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const diagnostics = _makeStartupDiagnostics(
    "timed out waiting for healthy /system_stats",
  );
  console.error("[comfy] startup timeout", diagnostics);
  throw new Error(
    `Timed out waiting for managed Comfy to become healthy on ${COMFY_HOST}:${COMFY_PORT}.`,
  );
}

function _spawnComfy() {
  // Kill any process listening on COMFY_PORT before starting our managed instance.
  _killListenersOnComfyPort();
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

  _lastSpawnError = null;
  _lastExit = null;

  child.stdout.on("data", (chunk) => {
    _rememberComfyLog("stdout", chunk);
    process.stdout.write(`[comfy] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk) => {
    _rememberComfyLog("stderr", chunk);
    process.stderr.write(`[comfy] ${chunk.toString()}`);
  });
  child.on("error", (err) => {
    _lastSpawnError = err;
    console.error("[comfy] managed process spawn/runtime error", {
      message: err?.message || String(err),
      code: err?.code || null,
      stack: err?.stack || null,
    });
  });
  child.on("exit", (code, signal) => {
    _lastExit = {
      at: new Date().toISOString(),
      code: code ?? null,
      signal: signal ?? null,
    };
    if (_proc === child) {
      _proc = null;
      clearEnginePid();
    }
    console.warn(`[comfy] process exited (code=${code}, signal=${signal ?? "n/a"})`);
  });

  _proc = child;
  writeEnginePid(child.pid);
  console.log(`[comfy] started managed instance pid=${child.pid ?? "unknown"}`);
  return child;
}

async function ensureManagedComfyReady() {
  if (await _healthcheck()) {
    const managed = !!(_proc && _proc.exitCode === null);
    return { running: true, managed, pid: managed ? (_proc.pid ?? null) : null };
  }
  if (_proc && _proc.exitCode === null) {
    console.warn("[comfy] managed instance unhealthy; recycling");
    _stopManagedComfyProcess();
    _killListenersOnComfyPort();
  }

  if (!_startingPromise) {
    _startingPromise = (async () => {
      _spawnComfy();
      return _waitForHealthy(90_000);
    })().finally(() => {
      _startingPromise = null;
    });
  }

  return _startingPromise;
}

async function recycleManagedComfy(reason = "unspecified") {
  if (_startingPromise) {
    try {
      await _startingPromise;
    } catch {
      // Ignore in-progress startup failure and force recycle below.
    }
  }
  console.warn(`[comfy] recycling managed instance: ${reason}`);
  _stopManagedComfyProcess();
  _killListenersOnComfyPort();
  _spawnComfy();
  return _waitForHealthy(90_000);
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
  _stopManagedComfyProcess();
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
  recycleManagedComfy,
  getManagedComfyStatus,
  getEnginePidFilePath,
};
