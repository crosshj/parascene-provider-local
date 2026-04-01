"use strict";

const fs = require("fs");
const path = require("path");

const { runComfyGeneration } = require("../generator/index.js");
const {
  BASE_PROVIDER_CAPABILITIES,
} = require("../configs/provider-api-config.js");

// Job state is persisted under DATA_ROOT/runtime so it survives rollouts.
const dataRoot = process.env.DATA_ROOT || process.cwd();
const runtimeDir = path.join(dataRoot, "runtime");
const statePath = path.join(runtimeDir, "jobs-state.json");

let jobs = new Map(); // job_id -> job record
let pendingOrder = []; // array of job_ids, pending only
let currentModelKey = null; // `${family}:${modelName}`
let processing = false;

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
    const order = Array.isArray(parsed.pendingOrder)
      ? parsed.pendingOrder.filter(
          (id) => jobs.has(id) && jobs.get(id).status === "pending",
        )
      : [];
    pendingOrder = order;
    currentModelKey =
      typeof parsed.currentModelKey === "string"
        ? parsed.currentModelKey
        : null;
  } catch {
    // ignore corrupted state; start fresh
    jobs = new Map();
    pendingOrder = [];
    currentModelKey = null;
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

function _selectNextJobId() {
  if (pendingOrder.length === 0) return null;
  if (!currentModelKey) {
    return pendingOrder[0];
  }
  // Prefer jobs that match the current model key to minimize reloads.
  for (const id of pendingOrder) {
    const job = jobs.get(id);
    if (!job || job.status !== "pending") continue;
    if (_jobModelKey(job) === currentModelKey) {
      return id;
    }
  }
  // Fallback: oldest pending job.
  return pendingOrder[0];
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
            seed: result.seed,
            family: result.family,
            model: result.model,
            elapsed_ms: result.elapsed_ms,
            backend: "comfy",
          };
        } else {
          current.status = "failed";
          current.completed_at = new Date().toISOString();
          current.error = result?.error ?? "Generator did not return an image.";
          current.result = { ok: false, error: current.error };
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
        }
      } finally {
        pendingOrder = pendingOrder.filter((id) => id !== job.id);
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

function enqueueGenerationJob({ payload, entry, method }, outputDir) {
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
  };
  jobs.set(id, job);
  pendingOrder.push(id);
  _writeState();
  _schedule();
  return job;
}

function getJob(jobId) {
  if (!jobId) return null;
  return jobs.get(jobId) || null;
}

function getSummary() {
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
  getSummary,
};
