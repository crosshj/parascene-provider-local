"use strict";

const fs = require("fs");
const path = require("path");

const { runComfyGeneration } = require("../generator/index.js");
const {
  BASE_PROVIDER_CAPABILITIES,
} = require("../configs/provider-api-config.js");
const { OUTPUT_TTL_SECONDS, expiresAtFromNow } = require("./retention.js");
const {
  rebuildInflightFromJobs,
  releaseInflightJob,
} = require("./generation-uniqueness.js");

// Job state is persisted under DATA_ROOT/runtime so it survives rollouts.
const dataRoot = process.env.DATA_ROOT || process.cwd();
const runtimeDir = path.join(dataRoot, "runtime");
const statePath = path.join(runtimeDir, "jobs-state.json");

let jobs = new Map(); // job_id -> job record
let pendingOrder = []; // array of job_ids, pending only
let currentModelKey = null; // `${family}:${modelName}`
let processing = false;

function _logJobFailure(job, message, err = null) {
  const details = {
    job_id: job?.id,
    method: job?.method,
    family: job?.family,
    model: job?.modelName || job?.modelId || null,
  };
  if (err && err.stack) {
    console.error(`[jobs] ${message}`, details, err.stack);
    return;
  }
  console.error(`[jobs] ${message}`, details);
}

function resolveMethodCredits(method) {
  const value = BASE_PROVIDER_CAPABILITIES?.methods?.[method]?.credits;
  return typeof value === "number" ? value : 0;
}

function _ensureRuntimeDir() {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
  } catch {
    // best-effort only
  }
}

function _writeState() {
  _ensureRuntimeDir();
  const payload = {
    jobs: Array.from(jobs.values()),
    pendingOrder,
    currentModelKey,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2));
  } catch {
    // ignore persistence failures; scheduler still works in-memory
  }
}

function _loadState() {
  _ensureRuntimeDir();
  try {
    if (!fs.existsSync(statePath)) return;
    const raw = fs.readFileSync(statePath, "utf8");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const map = new Map();
    for (const job of parsed.jobs || []) {
      if (!job || typeof job.id !== "string") continue;
      // Normalize status: pending / running jobs from a previous process become pending again.
      let status = job.status || "pending";
      if (status === "running") status = "pending";
      const normalized = {
        ...job,
        status,
      };
      map.set(job.id, normalized);
    }
    jobs = map;
    currentModelKey =
      typeof parsed.currentModelKey === "string"
        ? parsed.currentModelKey
        : null;
    _rebuildPendingOrder();
    rebuildInflightFromJobs(Array.from(jobs.values()));
    _writeState();
  } catch {
    // ignore corrupted state; start fresh
    jobs = new Map();
    pendingOrder = [];
    currentModelKey = null;
    rebuildInflightFromJobs([]);
  }
}

// Load persisted state on first require.
_loadState();

function _jobModelKey(job) {
  if (!job || !job.family) return null;
  if (job.modelId) return `${job.family}:${job.modelId}`;
  if (job.modelName) return `${job.family}:${job.modelName}`;
  return null;
}

function _createdAtMs(job) {
  const ms = Date.parse(job?.created_at || 0);
  return Number.isFinite(ms) ? ms : 0;
}

function _rebuildPendingOrder() {
  const pending = [];
  for (const job of jobs.values()) {
    if (job && job.status === "pending") pending.push(job);
  }
  pending.sort((a, b) => {
    const byTime = _createdAtMs(a) - _createdAtMs(b);
    return byTime !== 0 ? byTime : String(a.id).localeCompare(String(b.id));
  });
  pendingOrder = pending.map((job) => job.id);
}

function _selectNextJobId() {
  for (const id of pendingOrder) {
    const job = jobs.get(id);
    if (job && job.status === "pending") return id;
  }
  return null;
}

function _ensureDraining() {
  if (pendingOrder.length === 0 || processing) return;
  _schedule();
}

function resumePersistedQueue() {
  if (pendingOrder.length === 0) return;
  console.log(`[jobs] resuming ${pendingOrder.length} persisted job(s)`);
  _schedule();
}

function loadPersistedStateForTests() {
  processing = false;
  _loadState();
}

function reloadPersistedQueueForTests() {
  loadPersistedStateForTests();
  _schedule();
}

function _schedule() {
  if (processing) return;
  if (pendingOrder.length === 0) return;
  processing = true;
  setImmediate(_processLoop);
}

async function _processLoop() {
  try {
    while (pendingOrder.length > 0) {
      const nextId = _selectNextJobId();
      if (!nextId) break;
      const job = jobs.get(nextId);
      if (!job || job.status !== "pending") {
        pendingOrder = pendingOrder.filter((id) => id !== nextId);
        continue;
      }

      job.status = "running";
      job.started_at = new Date().toISOString();
      jobs.set(job.id, job);
      _writeState();

      const modelKey = _jobModelKey(job);
      if (modelKey) {
        currentModelKey = modelKey;
      }

      try {
        // Pass the full payload as built by the API handler (supports all workflows)
        const result = await runComfyGeneration(job.payload, job.outputDir);
        const current = jobs.get(job.id);
        if (!current) {
          // Job removed externally; skip.
        } else if (result?.ok && result.file_name) {
          current.status = "succeeded";
          current.completed_at = new Date().toISOString();
          current.result = {
            ok: true,
            file_name: result.file_name,
            image_url: `/outputs/${result.file_name}`,
            expires_at: expiresAtFromNow(OUTPUT_TTL_SECONDS),
            seed: result.seed,
            family: result.family,
            model: result.model,
            elapsed_ms: result.elapsed_ms,
            backend: "comfy",
            media_kind: result.media_kind,
          };
          current.data_removed = false;
        } else {
          current.status = "failed";
          current.completed_at = new Date().toISOString();
          current.error =
            result?.error ?? "Generator did not return an output file.";
          current.result = { ok: false, error: current.error };
          _logJobFailure(job, `Generation failed: ${current.error}`);
        }
        jobs.set(job.id, current);
      } catch (err) {
        const current = jobs.get(job.id);
        if (current) {
          current.status = "failed";
          current.completed_at = new Date().toISOString();
          current.error = err.message ?? "Generation failed.";
          current.result = { ok: false, error: current.error };
          jobs.set(job.id, current);
          _logJobFailure(job, `Generation exception: ${current.error}`, err);
        }
      } finally {
        pendingOrder = pendingOrder.filter((id) => id !== job.id);
        releaseInflightJob(job.id);
        _writeState();
      }
    }
  } finally {
    processing = false;
  }
}

function generateJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function enqueueGenerationJob({ payload, entry, method, fingerprint }, outputDir) {
  const id = generateJobId();
  const job = {
    id,
    method,
    args: payload, // store the built payload as args for reference
    family: entry.family,
    modelId: entry.modelId,
    modelName: entry.modelName,
    status: "pending",
    created_at: new Date().toISOString(),
    result: null,
    error: null,
    imageWidth: payload.width ?? 1024,
    imageHeight: payload.height ?? 1024,
    credits: resolveMethodCredits(method),
    seed: payload.seed,
    modelEntry: {
      modelId: entry.modelId,
      file: entry.file,
      family: entry.family,
      fullPath: entry.fullPath,
      loadKind: entry.loadKind,
      managedWorkflowId: entry.managedWorkflowId,
      comfyCheckpointGroup: entry.comfyCheckpointGroup,
      diffusionModelComfyName: entry.diffusionModelComfyName,
    },
    payload,
    outputDir,
    ...(typeof fingerprint === "string" && fingerprint
      ? { fingerprint }
      : {}),
  };
  jobs.set(id, job);
  pendingOrder.push(id);
  _writeState();
  _schedule();
  return job;
}

/** 1-based place in the pending line. Null when not pending. */
function linePlace(jobId) {
  const i = pendingOrder.indexOf(jobId);
  if (i < 0) return null;
  return { place: i + 1, ahead: i };
}

function getJob(jobId) {
  _ensureDraining();
  if (!jobId) return null;
  return jobs.get(jobId) || null;
}

function getAllJobs() {
  return Array.from(jobs.values());
}

function markDataRemoved(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.data_removed = true;
  if (job.result && typeof job.result === "object") {
    job.result.file_name = null;
    job.result.image_url = null;
    job.result.data_removed = true;
    job.result.expires_at = null;
  }
  jobs.set(jobId, job);
  _writeState();
  return true;
}

function removeExpiredJobs(metaTtlSeconds) {
  const now = Date.now();
  let removed = 0;
  for (const [id, job] of jobs.entries()) {
    if (!job) continue;
    if (job.status === "pending" || job.status === "running") continue;
    const completedMs = Date.parse(job.completed_at || job.created_at || 0);
    if (!Number.isFinite(completedMs)) continue;
    if ((now - completedMs) / 1000 < metaTtlSeconds) continue;
    jobs.delete(id);
    pendingOrder = pendingOrder.filter((x) => x !== id);
    removed += 1;
  }
  if (removed) _writeState();
  return removed;
}

function getSummary() {
  _ensureDraining();
  const all = Array.from(jobs.values());
  const pending = all.filter((j) => j.status === "pending");
  const running = all.filter((j) => j.status === "running");
  const succeeded = all.filter((j) => j.status === "succeeded");
  const failed = all.filter((j) => j.status === "failed");

  const byModel = {};
  for (const j of pending) {
    const key = _jobModelKey(j) || "unknown";
    const bucket = (byModel[key] = byModel[key] || { pending: 0 });
    bucket.pending += 1;
  }

  const activeModel = currentModelKey;

  return {
    queueLength: pending.length,
    runningCount: running.length,
    succeededCount: succeeded.length,
    failedCount: failed.length,
    byModel,
    activeModel,
  };
}

module.exports = {
  enqueueGenerationJob,
  getJob,
  getAllJobs,
  markDataRemoved,
  removeExpiredJobs,
  getSummary,
  linePlace,
  resumePersistedQueue,
  loadPersistedStateForTests,
  reloadPersistedQueueForTests,
};
