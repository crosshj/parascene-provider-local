"use strict";

const crypto = require("crypto");

const { sanitizePromptText } = require("../handlers/generate.js");
const {
  BASE_PROVIDER_CAPABILITIES,
} = require("../configs/provider-api-config.js");
const {
  getImage2videoPreset,
  getText2videoPreset,
  getAudio2videoPreset,
  getVideo2videoPreset,
  getReference2videoPreset,
  getText2audioPreset,
  getAudio2audioPreset,
} = require("../configs/api-model-aliases.js");

const VIDEO_METHODS = new Set([
  "text2video",
  "image2video",
  "audio2video",
  "video2video",
  "reference2video",
  "text2audio",
  "audio2audio",
]);

const NOISE_KEYS = new Set([
  "job_id",
  "async",
  "created_at",
  "started_at",
  "completed_at",
  "expires_at",
  "outputDir",
  "output_dir",
  "timestamp",
  "timestamps",
  "creation_token",
  "clientRequestId",
  "client_request_id",
]);

const MEDIA_ARRAY_KEYS = new Set([
  "input_images",
  "image_url",
  "image",
  "input_audio_urls",
  "input_video_urls",
]);

const STAGED_FILE_RE =
  /^(upload|input|audio|video|datauri)_(\d+)_([a-f0-9]+)(\.[a-z0-9]+)$/i;

const FINGERPRINT_PREFIX_LENGTH = 12;

const PRESET_GETTERS = {
  text2video: getText2videoPreset,
  image2video: getImage2videoPreset,
  audio2video: getAudio2videoPreset,
  video2video: getVideo2videoPreset,
  reference2video: getReference2videoPreset,
  text2audio: getText2audioPreset,
  audio2audio: getAudio2audioPreset,
};

/** fingerprint -> job_id */
let inflightByFingerprint = new Map();
/** job_id -> fingerprint */
let fingerprintByJobId = new Map();
/** fingerprint -> { promise, resolve } while the first start is still creating */
let preparingByFingerprint = new Map();

function isVideoMethod(method) {
  return VIDEO_METHODS.has(String(method || "").trim());
}

function applyFieldDefaults(method, args) {
  const methodDef = BASE_PROVIDER_CAPABILITIES?.methods?.[method];
  if (!methodDef?.fields || !args || typeof args !== "object") {
    return args && typeof args === "object" ? { ...args } : {};
  }
  const out = { ...args };
  for (const [fieldName, fieldDef] of Object.entries(methodDef.fields)) {
    if (!(fieldName in out) && fieldDef.default !== undefined) {
      out[fieldName] = fieldDef.default;
    }
  }
  return out;
}

function resolveModelIdentity(method, modelField) {
  const modelKey = String(modelField || "").trim();
  const getter = PRESET_GETTERS[method];
  const preset = getter ? getter(modelKey) : null;
  if (!preset) {
    return { method, modelKey };
  }
  return {
    method,
    family: preset.family || null,
    managedWorkflowId: preset.managedWorkflowId || null,
    modelFile: preset.modelFile || null,
  };
}

function normalizeStagedBasename(name) {
  const base = String(name || "").trim();
  const m = STAGED_FILE_RE.exec(base);
  if (!m) return base;
  return `${m[1].toLowerCase()}_*_${m[3].toLowerCase()}${m[4].toLowerCase()}`;
}

function normalizeMediaRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let rest = raw;
  if (rest.startsWith("file://")) rest = rest.slice("file://".length);
  if (rest.startsWith("/api/files/")) {
    try {
      rest = decodeURIComponent(rest.slice("/api/files/".length));
    } catch {
      rest = rest.slice("/api/files/".length);
    }
  }
  const slash = rest.lastIndexOf("/");
  const base = slash >= 0 ? rest.slice(slash + 1) : rest;
  if (STAGED_FILE_RE.test(base)) {
    return normalizeStagedBasename(base);
  }
  return raw;
}

function normalizeMediaList(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list.map(normalizeMediaRef).filter(Boolean);
}

function seedFromArgs(args) {
  if (!args || !("seed" in args)) return undefined;
  const raw = args.seed;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

function canonicalizeArgs(args) {
  const src = args && typeof args === "object" ? args : {};
  const out = {};

  const images = [
    ...normalizeMediaList(src.input_images),
    ...normalizeMediaList(src.image_url),
    ...normalizeMediaList(src.image),
  ];
  const audios = normalizeMediaList(src.input_audio_urls);
  const videos = normalizeMediaList(src.input_video_urls);

  for (const [key, value] of Object.entries(src)) {
    if (NOISE_KEYS.has(key)) continue;
    if (key === "model") continue;
    if (key === "method") continue;
    if (key === "seed") continue;
    if (key === "prompt" || key === "negative_prompt") continue;
    if (MEDIA_ARRAY_KEYS.has(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }

  const prompt = sanitizePromptText(src.prompt);
  if (prompt) out.prompt = prompt;
  const negative = sanitizePromptText(src.negative_prompt || "");
  if (negative) out.negative_prompt = negative;

  const seed = seedFromArgs(src);
  if (seed !== undefined) out.seed = seed;

  if (images.length) out.input_images = images;
  if (audios.length) out.input_audio_urls = audios;
  if (videos.length) out.input_video_urls = videos;

  return out;
}

function stableSerialize(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

function buildFingerprint(method, args) {
  const methodId = String(method || "").trim();
  const defaulted = applyFieldDefaults(methodId, args);
  const identity = resolveModelIdentity(methodId, defaulted.model);
  const form = canonicalizeArgs(defaulted);
  const payload = { identity, form };
  const fingerprint = crypto
    .createHash("sha256")
    .update(stableSerialize(payload))
    .digest("hex");
  return {
    fingerprint,
    prefix: fingerprint.slice(0, FINGERPRINT_PREFIX_LENGTH),
    payload,
  };
}

function rememberInflight(fingerprint, jobId) {
  if (!fingerprint || !jobId) return;
  const previous = fingerprintByJobId.get(jobId);
  if (previous && previous !== fingerprint) {
    if (inflightByFingerprint.get(previous) === jobId) {
      inflightByFingerprint.delete(previous);
    }
  }
  inflightByFingerprint.set(fingerprint, jobId);
  fingerprintByJobId.set(jobId, fingerprint);
}

function releaseInflightJob(jobId) {
  if (!jobId) return false;
  const fingerprint = fingerprintByJobId.get(jobId);
  fingerprintByJobId.delete(jobId);
  if (!fingerprint) return false;
  if (inflightByFingerprint.get(fingerprint) === jobId) {
    inflightByFingerprint.delete(fingerprint);
    return true;
  }
  return false;
}

function rebuildInflightFromJobs(jobList) {
  inflightByFingerprint = new Map();
  fingerprintByJobId = new Map();
  preparingByFingerprint = new Map();
  if (!Array.isArray(jobList)) return;
  for (const job of jobList) {
    if (!job || typeof job.id !== "string") continue;
    if (job.status !== "pending" && job.status !== "running") continue;
    const fingerprint =
      typeof job.fingerprint === "string" ? job.fingerprint.trim() : "";
    if (!fingerprint) continue;
    rememberInflight(fingerprint, job.id);
  }
}

function liveJob(fingerprint, getJob) {
  const jobId = inflightByFingerprint.get(fingerprint);
  if (!jobId) return null;
  const job = typeof getJob === "function" ? getJob(jobId) : null;
  if (!job || (job.status !== "pending" && job.status !== "running")) {
    releaseInflightJob(jobId);
    return null;
  }
  return job;
}

function abortPrepare(fingerprint) {
  const preparing = preparingByFingerprint.get(fingerprint);
  preparingByFingerprint.delete(fingerprint);
  if (preparing) preparing.resolve(null);
}

function commitPrepare(fingerprint, jobId) {
  rememberInflight(fingerprint, jobId);
  const preparing = preparingByFingerprint.get(fingerprint);
  preparingByFingerprint.delete(fingerprint);
  if (preparing) preparing.resolve(jobId);
}

function responseFields(state, prefix) {
  return {
    dedupe_state: state,
    dedupe_fingerprint_prefix: prefix,
  };
}

/**
 * Join an in-flight video job or uniquely create one.
 * `create` runs at most once per fingerprint while a job is pending/running.
 * Non-video methods skip coalescing and just call create.
 */
async function startOrJoin({ method, args, getJob, create }) {
  if (!isVideoMethod(method)) {
    const job = await create({ fingerprint: null });
    if (job?.error) return { error: job.error };
    return { job, fields: {} };
  }

  const built = buildFingerprint(method, args);

  for (;;) {
    const joined = liveJob(built.fingerprint, getJob);
    if (joined) {
      return { job: joined, fields: responseFields("joined_inflight", built.prefix) };
    }

    const inFlightId = inflightByFingerprint.get(built.fingerprint);
    if (inFlightId) continue;

    const preparing = preparingByFingerprint.get(built.fingerprint);
    if (preparing) {
      const jobId = await preparing.promise;
      if (!jobId) continue;
      const job = typeof getJob === "function" ? getJob(jobId) : null;
      if (job && (job.status === "pending" || job.status === "running")) {
        return { job, fields: responseFields("joined_inflight", built.prefix) };
      }
      continue;
    }

    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    preparingByFingerprint.set(built.fingerprint, { promise, resolve });

    try {
      const job = await create({ fingerprint: built.fingerprint });
      if (job?.error) {
        abortPrepare(built.fingerprint);
        return { error: job.error };
      }
      commitPrepare(built.fingerprint, job.id);
      return { job, fields: responseFields("miss", built.prefix) };
    } catch (err) {
      abortPrepare(built.fingerprint);
      throw err;
    }
  }
}

function resetForTests() {
  inflightByFingerprint = new Map();
  fingerprintByJobId = new Map();
  preparingByFingerprint = new Map();
}

module.exports = {
  buildFingerprint,
  startOrJoin,
  releaseInflightJob,
  rebuildInflightFromJobs,
  resetForTests,
};
