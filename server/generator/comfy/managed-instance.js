"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const COMFY_ROOT = "D:/comfy_portable";
const COMFY_HOST = "127.0.0.1";
const COMFY_PORT = 8188;
const COMFY_HEALTHCHECK_TIMEOUT_MS = 4_000;

let _proc = null;
let _startingPromise = null;

function _url(pathname) {
  return `http://${COMFY_HOST}:${COMFY_PORT}${pathname}`;
}

async function _healthcheck() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMFY_HEALTHCHECK_TIMEOUT_MS);
  try {
    const res = await fetch(_url("/system_stats"), {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function _resolvePython() {
  const embedded = path.join(COMFY_ROOT, "python_embeded", "python.exe");
  if (fs.existsSync(embedded)) return embedded;
  return "python";
}

function _spawnComfy() {
  if (!fs.existsSync(COMFY_ROOT)) {
    throw new Error(`Comfy root not found at ${COMFY_ROOT}`);
  }
  const mainPy = path.join(COMFY_ROOT, "main.py");
  if (!fs.existsSync(mainPy)) {
    throw new Error(`Comfy main.py not found at ${mainPy}`);
  }

  const pythonCmd = _resolvePython();
  const child = spawn(
    pythonCmd,
    ["main.py", "--listen", COMFY_HOST, "--port", String(COMFY_PORT)],
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
    if (_proc === child) _proc = null;
    console.warn(`[comfy] process exited (code=${code})`);
  });

  _proc = child;
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
  const healthy = await _healthcheck();
  return {
    running: healthy,
    managed: !!(_proc && _proc.exitCode === null),
    pid: _proc && _proc.exitCode === null ? (_proc.pid ?? null) : null,
    host: COMFY_HOST,
    port: COMFY_PORT,
    root: COMFY_ROOT,
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
};
