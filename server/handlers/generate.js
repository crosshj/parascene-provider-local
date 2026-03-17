// handlers/generate.js
// Manages a persistent Python worker for image generation.
// The worker process stays alive between requests so models remain loaded in VRAM.

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { readJson, sendJson } = require("../lib.js");
const { resolveModel } = require("./models.js");

function sanitizePromptText(value) {
  if (value == null) return "";
  let out = String(value).normalize("NFKC");
  const map = {
    "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'", "\u2032": "'",
    "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"', "\u2033": '"',
    "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2026": "...", "\u00A0": " ",
  };
  out = out.replace(
    /[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u201F\u2033\u2013\u2014\u2212\u2026\u00A0]/g,
    (ch) => map[ch] ?? ch,
  );
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return out.trim();
}

const PY_DIR = path.join(__dirname, "..", "..", "generator");
const PYTHON_SCRIPT = path.join(PY_DIR, "generate.py");
const TIMEOUT_MS = Number(process.env.GENERATE_TIMEOUT_MS || 600_000);

function resolvePythonCommand() {
  const candidates = [
    process.env.GENERATOR_PYTHON_EXECUTABLE,
    process.env.PYTHON_WORKER_EXECUTABLE_OVERRIDE,
    path.join(PY_DIR, ".venv", "Scripts", "python.exe"),
    "python",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "python") {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "python";
}

// ── Persistent worker state ────────────────────────────────────────────────

let _worker = null; // child_process.ChildProcess | null
let _outDir = null; // resolved once on first call
let _buffer = ""; // incomplete stdout data between newlines
let _currentJob = null; // { resolve, reject, timer } | null
const _queue = []; // pending jobs

function _spawnWorker() {
  const pythonCmd = resolvePythonCommand();

  if (pythonCmd !== "python" && !fs.existsSync(pythonCmd)) {
    throw new Error(`Configured Python interpreter not found: ${pythonCmd}`);
  }
  const child = spawn(
    pythonCmd,
    [PYTHON_SCRIPT, "--worker", "--out-dir", _outDir],
    {
      cwd: PY_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  _buffer = "";

  // Each response from generate.py is a single line of JSON followed by \n.
  child.stdout.on("data", (chunk) => {
    _buffer += chunk.toString();
    let nl;
    while ((nl = _buffer.indexOf("\n")) !== -1) {
      const line = _buffer.slice(0, nl).trim();
      _buffer = _buffer.slice(nl + 1);
      if (!line) continue;

      const job = _currentJob;
      if (!job) continue; // unexpected output — ignore
      _currentJob = null;
      clearTimeout(job.timer);

      try {
        job.resolve(JSON.parse(line));
      } catch {
        job.reject(new Error(`Generator returned invalid JSON: ${line}`));
      }
      _tick();
    }
  });

  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  child.on("error", (err) => {
    if (_worker === child) _worker = null;
    if (_currentJob) {
      const job = _currentJob;
      _currentJob = null;
      clearTimeout(job.timer);
      job.reject(err);
      _tick();
    }
  });

  child.on("exit", (code) => {
    if (_worker === child) {
      _worker = null;
      _clearPid();
    }
    if (_currentJob) {
      // Unexpected exit while a job was in flight.
      const job = _currentJob;
      _currentJob = null;
      clearTimeout(job.timer);
      job.reject(
        new Error(`Python worker exited unexpectedly (code ${code}).`),
      );
      _tick();
    }
  });

  console.log(`[generator] Python worker started (python=${pythonCmd})`);
  _writePid(child.pid);
  return child;
}

function _tick() {
  if (_currentJob || _queue.length === 0) return;
  if (!_worker || _worker.exitCode !== null) _worker = _spawnWorker();

  const { payload, resolve, reject } = _queue.shift();

  const timer = setTimeout(() => {
    // Detach & kill the stuck worker; a fresh one will spawn on next _tick().
    const dyingWorker = _worker;
    _worker = null;
    if (dyingWorker) dyingWorker.kill("SIGTERM");
    const job = _currentJob;
    _currentJob = null;
    if (job) job.reject(new Error("Generation timed out."));
    _tick();
  }, TIMEOUT_MS);

  _currentJob = { resolve, reject, timer };

  const modelBasename = String(payload.model || "")
    .split(/[\\/]/)
    .pop();
  console.log(
    `[generator] start  family=${payload.family}  model=${modelBasename}`,
  );

  try {
    _worker.stdin.write(JSON.stringify(payload) + "\n");
  } catch (err) {
    clearTimeout(timer);
    _currentJob = null;
    _worker = null;
    reject(err);
    _tick();
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
// SIGINT / SIGTERM: handlers fire reliably — kill worker then exit.
// Hard kill (SIGKILL / Task Manager): nothing we can do from JS, but the
//   PID file below lets a future server startup (or the service) detect and kill orphans.
//   When DATA_ROOT is set we use dataRoot/runtime/.worker.pid so service and server
//   share one location; otherwise generator/.worker.pid (release-relative).

function _getPidFilePath() {
  const dataRoot = process.env.DATA_ROOT;
  if (dataRoot) {
    return path.join(dataRoot, "runtime", ".worker.pid");
  }
  return path.join(PY_DIR, ".worker.pid");
}

function _writePid(pid) {
  try {
    const pidFile = _getPidFilePath();
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(pid));
  } catch {
    /* ignore */
  }
}

function _clearPid() {
  try {
    fs.unlinkSync(_getPidFilePath());
  } catch {
    /* ignore */
  }
}

function _killOrphan() {
  const pidFile = _getPidFilePath();
  let pid;
  try {
    pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
  } catch {
    _clearPid();
    return;
  }
  if (!pid || isNaN(pid)) {
    _clearPid();
    return;
  }
  try {
    process.kill(pid, 0); // throws if process is gone
  } catch {
    console.log(`[generator] stale worker PID file (process ${pid} gone), removed`);
    _clearPid();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[generator] killed orphaned worker pid=${pid}`);
  } catch (err) {
    console.warn(`[generator] failed to kill orphan pid=${pid}:`, err.message);
  }
  _clearPid();
}

// Kill any orphan from a previous hard-killed server run. Skip when DATA_ROOT is
// set so we don't kill the old server's worker during a rollout (service cleans
// up after tearing down the old process).
if (!process.env.DATA_ROOT) {
  _killOrphan();
}

function _stopWorker() {
  if (!_worker) return;
  _clearPid();
  try {
    _worker.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  _worker = null;
}

process.on("exit", _stopWorker);
process.on("SIGTERM", () => {
  _stopWorker();
  process.exit(0);
});
process.on("SIGINT", () => {
  _stopWorker();
  process.exit(0);
});

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Current Python worker status for health reporting.
 * @returns {{ running: boolean, pid: number | null }}
 */
function getWorkerStatus() {
  if (!_worker) {
    return { running: false, pid: null };
  }
  const running = _worker.exitCode === null;
  return { running, pid: _worker.pid ?? null };
}

function ensureWorkerStarted(outDir) {
  _outDir = _outDir ?? outDir;
  if (!_outDir) {
    throw new Error("OUTPUT_DIR not configured");
  }
  if (!_worker || _worker.exitCode !== null) {
    _worker = _spawnWorker();
  }
  return getWorkerStatus();
}

/**
 * Run a generation job.
 * The Python worker is started lazily on first call and kept alive so that
 * loaded models remain in VRAM for subsequent requests.
 *
 * @param {object} payload  Generation payload (prompt, family, model path, etc.)
 * @param {string} outDir   Absolute path where images should be saved.
 * @returns {Promise<object>}
 */
function runGenerator(payload, outDir) {
  _outDir = _outDir ?? outDir; // fixed for the lifetime of the server process
  return new Promise((resolve, reject) => {
    _queue.push({ payload, resolve, reject });
    _tick();
  });
}

function handleGenerate(req, res, ctx) {
  if (!ctx.outputDir) {
    return sendJson(res, 503, { error: "OUTPUT_DIR not configured" });
  }
  readJson(req)
    .then((body) => {
      const prompt = sanitizePromptText(body.prompt);
      if (!prompt) {
        return sendJson(res, 400, { error: "Missing required field: prompt" });
      }

      const modelName = String(body.model || "").trim();
      if (!modelName) {
        return sendJson(res, 400, { error: "Missing required field: model" });
      }

      const entry = resolveModel(modelName);
      if (!entry) {
        return sendJson(res, 400, {
          error: `Unknown model: "${modelName}". Check GET /api/models.`,
        });
      }

      const payload = {
        ...body,
        prompt,
        prompt_2: sanitizePromptText(body.prompt_2 || ""),
        negative_prompt: sanitizePromptText(body.negative_prompt || ""),
        model: entry.fullPath,
        family: entry.family,
      };

      return runGenerator(payload, ctx.outputDir).then((result) => {
        if (!result?.ok || !result.file_name) {
          return sendJson(res, 500, {
            error: result?.error ?? "Generator did not return an image.",
          });
        }
        sendJson(res, 200, {
          ok: true,
          file_name: result.file_name,
          image_url: `/outputs/${result.file_name}`,
          seed: result.seed,
          family: result.family,
          model: result.model,
          elapsed_ms: result.elapsed_ms,
        });
      });
    })
    .catch((err) =>
      sendJson(res, 500, { error: err.message ?? "Generation failed." }),
    );
}

module.exports = {
  ensureWorkerStarted,
  getWorkerStatus,
  runGenerator,
  handleGenerate,
  sanitizePromptText,
};
