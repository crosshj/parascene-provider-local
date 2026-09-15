"use strict";

const fs = require("fs");
const path = require("path");

const {
  runComfyGeneration,
  ensureManagedComfyReady,
} = require("../generator/index.js");
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
let rehydrating = false;
const holdPath = path.join(runtimeDir, "scheduler.hold");

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

const ALWAYS_NEXT_MAX = 51;
const PRODUCT_MAX_CAP = 50;

function _createdAtMs(job) {
  const ms = Date.parse(job?.created_at || 0);
  return Number.isFinite(ms) ? ms : 0;
}

function jobEffectiveMax(job) {
  if (job?.always_next === true) return ALWAYS_NEXT_MAX;
  const n = Number(job?.max_bid);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _rebuildPendingOrder() {
  const pending = [];
  for (const job of jobs.values()) {
    if (job && job.status === "pending") pending.push(job);
  }
  pending.sort((a, b) => {
    const byMax = jobEffectiveMax(b) - jobEffectiveMax(a);
    if (byMax !== 0) return byMax;
    const byTime = _createdAtMs(a) - _createdAtMs(b);
    return byTime !== 0 ? byTime : String(a.id).localeCompare(String(b.id));
  });
  pendingOrder = pending.map((job) => job.id);
}

function _resetStaleModelAffinity() {
  if (!currentModelKey) return;
  const hasMatchingPending = pendingOrder.some((id) => {
    const job = jobs.get(id);
    return (
      job && job.status === "pending" && _jobModelKey(job) === currentModelKey
    );
  });
  if (!hasMatchingPending) {
    currentModelKey = null;
  }
}

function _selectNextJobId() {
  const eligible = pendingOrder.filter((id) => {
    const job = jobs.get(id);
    return job && job.status === "pending";
  });
  if (eligible.length === 0) return null;

  _resetStaleModelAffinity();
  return eligible[0];
}

function isSchedulerHeld() {
  try {
    return fs.existsSync(holdPath);
  } catch {
    return false;
  }
}

function writeSchedulerHoldForTests() {
  _ensureRuntimeDir();
  fs.writeFileSync(holdPath, `${new Date().toISOString()}\n`);
}

function clearSchedulerHoldForTests() {
  try {
    fs.unlinkSync(holdPath);
  } catch {
    // missing is fine
  }
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSchedulerRelease() {
  const maxMs = Number(process.env.SCHEDULER_HOLD_WAIT_MS || 3_600_000);
  const deadline = Date.now() + maxMs;
  while (isSchedulerHeld()) {
    if (Date.now() >= deadline) {
      console.warn("[jobs] scheduler hold wait timed out; starting anyway");
      break;
    }
    await _sleep(250);
  }
}

let holdRetryTimer = null;

/** Re-check the line shortly; self-rearms until unblocked. */
function _scheduleHoldRetry() {
  if (holdRetryTimer) return;
  holdRetryTimer = setTimeout(() => {
    holdRetryTimer = null;
    _ensureDraining();
  }, 1000);
  if (typeof holdRetryTimer.unref === "function") holdRetryTimer.unref();
}

function _ensureDraining() {
  if (pendingOrder.length === 0 || processing) return;
  if (isSchedulerHeld()) {
    _scheduleHoldRetry();
    return;
  }
  _schedule();
}

async function rehydratePersistedQueue() {
  if (processing) {
    console.log("[jobs] rehydrate skipped: scheduler already processing");
    return;
  }
  if (rehydrating) {
    console.log("[jobs] rehydrate skipped: already waiting to start");
    return;
  }
  rehydrating = true;
  try {
    await waitForSchedulerRelease();
    await ensureManagedComfyReady();
    if (processing || isSchedulerHeld()) return;
    _loadState();
    if (pendingOrder.length === 0) return;
    _resetStaleModelAffinity();
    console.log(`[jobs] rehydrated ${pendingOrder.length} persisted job(s)`);
    _schedule();
  } catch (err) {
    console.warn(
      `[jobs] rehydrate waiting for Comfy: ${err && err.message ? err.message : err}`,
    );
    setTimeout(() => {
      rehydratePersistedQueue().catch(() => {});
    }, 5000);
  } finally {
    rehydrating = false;
  }
}

function resumePersistedQueue() {
  if (pendingOrder.length === 0) return;
  _resetStaleModelAffinity();
  console.log(`[jobs] resuming ${pendingOrder.length} persisted job(s)`);
  _schedule();
}

function loadPersistedStateForTests() {
  processing = false;
  rehydrating = false;
  _loadState();
}

async function reloadPersistedQueueForTests() {
  loadPersistedStateForTests();
  clearSchedulerHoldForTests();
  await rehydratePersistedQueue();
}

function _schedule() {
  if (processing) return;
  if (pendingOrder.length === 0) return;
  if (isSchedulerHeld()) {
    _scheduleHoldRetry();
    return;
  }
  processing = true;
  setImmediate(_processLoop);
}

async function _processLoop() {
  try {
    while (pendingOrder.length > 0) {
      if (isSchedulerHeld()) {
        console.log("[jobs] held for rollout; not starting the next job");
        break;
      }
      const nextId = _selectNextJobId();
      if (!nextId) break;
      const job = jobs.get(nextId);
      if (!job || job.status !== "pending") {
        pendingOrder = pendingOrder.filter((id) => id !== nextId);
        continue;
      }

      try {
        await ensureManagedComfyReady();
      } catch (err) {
        console.warn(
          `[jobs] Comfy not ready (${err.message}); leaving ${job.id} pending`,
        );
        break;
      }
      if (isSchedulerHeld()) {
        console.log("[jobs] held for rollout; not starting the next job");
        break;
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
        const result = await runComfyGeneration(job.payload, job.outputDir, {
          onQueued: (promptId) => {
            const current = jobs.get(job.id);
            if (!current) return;
            current.comfy_prompt_id = String(promptId);
            jobs.set(job.id, current);
            _writeState();
          },
        });
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
        const current = jobs.get(job.id);
        if (current && current.status === "pending") {
          _rebuildPendingOrder();
        } else {
          pendingOrder = pendingOrder.filter((id) => id !== job.id);
          releaseInflightJob(job.id);
        }
        _writeState();
      }
    }
  } finally {
    processing = false;
    // If jobs remain (hold, or Comfy not ready), keep re-checking so the
    // line restarts on its own instead of waiting for an external poll.
    if (pendingOrder.length > 0) _scheduleHoldRetry();
  }
}

function generateJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function enqueueGenerationJob(
  { payload, entry, method, fingerprint, max_bid, always_next },
  outputDir,
) {
  const id = generateJobId();
  const alwaysNext = always_next === true;
  const rawBid = Number(max_bid);
  const maxBid = alwaysNext
    ? ALWAYS_NEXT_MAX
    : Number.isFinite(rawBid) && rawBid > 0
      ? rawBid
      : 0;
  const cleanPayload =
    payload && typeof payload === "object" ? { ...payload } : {};
  delete cleanPayload.max_bid;
  delete cleanPayload.always_next;
  delete cleanPayload.credits_boost;
  const job = {
    id,
    method,
    args: cleanPayload, // store the built payload as args for reference
    family: entry.family,
    modelId: entry.modelId,
    modelName: entry.modelName,
    status: "pending",
    created_at: new Date().toISOString(),
    result: null,
    error: null,
    imageWidth: cleanPayload.width ?? 1024,
    imageHeight: cleanPayload.height ?? 1024,
    credits: resolveMethodCredits(method),
    max_bid: maxBid,
    always_next: alwaysNext,
    seed: cleanPayload.seed,
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
    payload: cleanPayload,
    outputDir,
    ...(typeof fingerprint === "string" && fingerprint ? { fingerprint } : {}),
  };
  jobs.set(id, job);
  _rebuildPendingOrder();
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

const VIDEO_METHODS = new Set([
  "text2video",
  "image2video",
  "audio2video",
  "video2video",
  "reference2video",
]);
const TYPICAL_STILL_S = 45;
const TYPICAL_VIDEO_S = 480;

function methodKind(method) {
  return VIDEO_METHODS.has(String(method || "")) ? "video" : "still";
}

function typicalSeconds(method) {
  return methodKind(method) === "video" ? TYPICAL_VIDEO_S : TYPICAL_STILL_S;
}

function remainingSeconds(job) {
  const typical = typicalSeconds(job?.method);
  if (!job || job.status !== "running") return typical;
  const startedMs = Date.parse(job.started_at || 0);
  const elapsed = Number.isFinite(startedMs)
    ? Math.max(0, (Date.now() - startedMs) / 1000)
    : 0;
  return Math.max(Math.round(typical * 0.2), Math.round(typical - elapsed));
}

function runningPublic(job) {
  if (!job) return null;
  const family = String(job.family || "").trim();
  return {
    kind: methodKind(job.method),
    ...(family ? { family } : {}),
  };
}

/** Live line before enqueue. No job_id. Honest ranges. */
function occupancyPeek() {
  _ensureDraining();
  const pending = pendingOrder
    .map((id) => jobs.get(id))
    .filter((j) => j && j.status === "pending");
  let running = null;
  for (const job of jobs.values()) {
    if (job && job.status === "running") {
      running = job;
      break;
    }
  }
  const pendingPublic = pending.map((job) => {
    const max = jobEffectiveMax(job);
    return {
      max,
      boost: max,
      eta_s: typicalSeconds(job.method),
      kind: methodKind(job.method),
    };
  });
  const highest_max = pendingPublic.reduce(
    (high, row) => Math.max(high, row.max),
    0,
  );
  const running_eta_s = running ? remainingSeconds(running) : 0;
  const ahead = pending.length;
  const idle = !running && ahead === 0;
  let eta_s = running_eta_s;
  for (const row of pendingPublic) eta_s += row.eta_s;
  if (eta_s > 3 * 3600) eta_s = 3 * 3600;
  return {
    idle,
    running: runningPublic(running),
    running_eta_s,
    ahead,
    eta_s,
    pending: pendingPublic,
    highest_max,
  };
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

/** Watchdog entry: start the line if jobs are waiting and nothing is running. */
function ensureQueueDraining() {
  _ensureDraining();
}

module.exports = {
  ALWAYS_NEXT_MAX,
  PRODUCT_MAX_CAP,
  jobEffectiveMax,
  enqueueGenerationJob,
  getJob,
  getAllJobs,
  markDataRemoved,
  removeExpiredJobs,
  getSummary,
  occupancyPeek,
  linePlace,
  resumePersistedQueue,
  rehydratePersistedQueue,
  loadPersistedStateForTests,
  reloadPersistedQueueForTests,
  isSchedulerHeld,
  writeSchedulerHoldForTests,
  clearSchedulerHoldForTests,
  ensureQueueDraining,
};
