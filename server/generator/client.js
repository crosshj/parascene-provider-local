"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  COMFY_HOST,
  COMFY_PORT,
  ensureManagedComfyReady,
  recycleManagedComfy,
  captureComfyLogCheckpoint,
  comfyLogTextSince,
} = require("./managed-instance.js");
const { buildWorkflowByFamily } = require("../workflows/_index.js");
const {
  extractHistoryExecutionError,
  historyHasPromptEntry,
  missingOutputError,
  retryAfterComfyRecycle,
} = require("./comfy-errors.js");

function _url(pathname) {
  return `http://${COMFY_HOST}:${COMFY_PORT}${pathname}`;
}

function _formatFetchError(pathname, err) {
  const base = err && err.message ? err.message : String(err || "unknown error");
  const cause = err && err.cause ? err.cause : null;
  const causeCode =
    cause && typeof cause === "object" && cause.code ? String(cause.code) : "";
  const causeMsg =
    cause && typeof cause === "object" && cause.message
      ? String(cause.message)
      : "";
  const extras = [causeCode, causeMsg].filter(Boolean).join(" ").trim();
  return extras
    ? `Comfy API ${pathname} network error: ${base} (${extras})`
    : `Comfy API ${pathname} network error: ${base}`;
}

function _isConnectionRefusedError(err) {
  const msg = String(err && err.message ? err.message : "");
  if (msg.toUpperCase().includes("ECONNREFUSED")) return true;
  const cause = err && err.cause ? err.cause : null;
  const code =
    cause && typeof cause === "object" && cause.code ? String(cause.code) : "";
  return code.toUpperCase() === "ECONNREFUSED";
}

const COMFY_HTTP_TIMEOUT_MS =
  Number(process.env.COMFY_HTTP_TIMEOUT_MS) || 60_000;
// Media download of the finished output must never be cut off by the
// control-plane timeout; a large video can legitimately take minutes.
const COMFY_VIEW_TIMEOUT_MS =
  Number(process.env.COMFY_VIEW_TIMEOUT_MS) || 900_000; // 15m

function _fetchOnce(pathname, fetchOptions, timeoutMs) {
  const opts = { ...fetchOptions };
  if (
    timeoutMs > 0 &&
    !opts.signal &&
    typeof AbortSignal !== "undefined" &&
    AbortSignal.timeout
  ) {
    // Fresh signal per attempt — a signal created before a recycle would
    // already be aborted by the time the retry runs.
    opts.signal = AbortSignal.timeout(timeoutMs);
  }
  return fetch(_url(pathname), opts);
}

async function _fetchWithRecovery(pathname, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  const effectiveTimeoutMs =
    timeoutMs === undefined ? COMFY_HTTP_TIMEOUT_MS : Number(timeoutMs);
  try {
    return await _fetchOnce(pathname, fetchOptions, effectiveTimeoutMs);
  } catch (err) {
    if (!_isConnectionRefusedError(err)) throw err;
    console.warn(
      `[comfy] ECONNREFUSED on ${pathname}; recycling managed process and retrying once`,
    );
    await recycleManagedComfy(`connection refused on ${pathname}`);
    return _fetchOnce(pathname, fetchOptions, effectiveTimeoutMs);
  }
}

async function requestJson(pathname, options = {}) {
  let res;
  try {
    res = await _fetchWithRecovery(pathname, options);
  } catch (err) {
    throw new Error(_formatFetchError(pathname, err));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Comfy API ${pathname} failed with HTTP ${res.status}: ${JSON.stringify(data)}`,
    );
  }
  return data;
}

async function requestBuffer(pathname) {
  let res;
  try {
    res = await _fetchWithRecovery(pathname, {
      method: "GET",
      timeoutMs: COMFY_VIEW_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(_formatFetchError(pathname, err));
  }
  if (!res.ok) {
    throw new Error(`Comfy view request failed with HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

const VIDEO_FILE_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".m4v",
  ".gif",
]);

function filenameLooksLikeVideo(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  return VIDEO_FILE_EXTENSIONS.has(ext);
}

const AUDIO_FILE_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".ogg",
  ".aac",
]);

function filenameLooksLikeAudio(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  return AUDIO_FILE_EXTENSIONS.has(ext);
}

function parseOutputImage(historyData, promptId) {
  const root = historyData && historyData[promptId];
  if (!root || !root.outputs || typeof root.outputs !== "object") {
    throw new Error("Comfy history response missing outputs.");
  }

  for (const value of Object.values(root.outputs)) {
    if (!value || !Array.isArray(value.images) || value.images.length === 0)
      continue;
    const img = value.images[0];
    if (img && img.filename) {
      return {
        kind: "image",
        filename: String(img.filename),
        subfolder: String(img.subfolder || ""),
        type: String(img.type || "output"),
      };
    }
  }

  throw new Error("Comfy history does not contain generated images.");
}

function tryParseVideoRef(outSlot) {
  if (!outSlot || typeof outSlot !== "object") return null;
  const lists = ["videos", "gifs"];
  for (const key of lists) {
    const arr = outSlot[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const first = arr[0];
    if (first && first.filename) {
      return {
        kind: "video",
        filename: String(first.filename),
        subfolder: String(first.subfolder || ""),
        type: String(first.type || "output"),
      };
    }
  }
  // ComfyUI SaveVideo / PreviewVideo uses ui.PreviewVideo, whose as_dict() is
  // { images: [<SavedResult>...], animated: (True,) } — not "videos"/"gifs".
  const imgs = outSlot.images;
  if (Array.isArray(imgs)) {
    for (const item of imgs) {
      if (
        item &&
        item.filename &&
        filenameLooksLikeVideo(item.filename)
      ) {
        return {
          kind: "video",
          filename: String(item.filename),
          subfolder: String(item.subfolder || ""),
          type: String(item.type || "output"),
        };
      }
    }
  }
  return null;
}

function parseOutputVideo(historyData, promptId) {
  const root = historyData && historyData[promptId];
  if (!root || !root.outputs || typeof root.outputs !== "object") {
    throw new Error("Comfy history response missing outputs.");
  }

  for (const value of Object.values(root.outputs)) {
    const ref = tryParseVideoRef(value);
    if (ref) return ref;
  }

  throw new Error("Comfy history does not contain generated videos.");
}

function tryParseAudioRef(outSlot) {
  if (!outSlot || typeof outSlot !== "object") return null;

  const fromCandidate = (candidate, fallback = {}) => {
    if (!candidate) return null;
    if (typeof candidate === "string") {
      if (!filenameLooksLikeAudio(candidate)) return null;
      const normalized = String(candidate).replace(/\\/g, "/");
      const slash = normalized.lastIndexOf("/");
      const filename = slash >= 0 ? normalized.slice(slash + 1) : normalized;
      const subfolder = slash >= 0 ? normalized.slice(0, slash) : "";
      return {
        kind: "audio",
        filename,
        subfolder,
        type: String(fallback.type || "output"),
      };
    }
    if (typeof candidate !== "object" || !candidate.filename) return null;
    return {
      kind: "audio",
      filename: String(candidate.filename),
      subfolder: String(
        candidate.subfolder !== undefined
          ? candidate.subfolder
          : fallback.subfolder || "",
      ),
      type: String(candidate.type || fallback.type || "output"),
    };
  };

  const lists = ["audio", "audios"];
  for (const key of lists) {
    const arr = outSlot[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const item of arr) {
      const ref = fromCandidate(item, outSlot);
      if (ref) return ref;
    }
  }

  // Some custom saver nodes expose a direct output-like object.
  const direct = fromCandidate(outSlot, outSlot);
  if (direct) return direct;

  const imgs = outSlot.images;
  if (Array.isArray(imgs)) {
    for (const item of imgs) {
      const ref = fromCandidate(item, outSlot);
      if (ref) return ref;
    }
  }

  // Some custom nodes return media references under generic list fields.
  const genericLists = ["files", "result", "results", "outputs"];
  for (const key of genericLists) {
    const arr = outSlot[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const item of arr) {
      const ref = fromCandidate(item, outSlot);
      if (ref) return ref;
    }
  }

  // Defensive fallback for nested UI payload shapes.
  if (outSlot.ui && typeof outSlot.ui === "object") {
    return tryParseAudioRef(outSlot.ui);
  }

  return null;
}

function parseOutputAudio(historyData, promptId) {
  const root = historyData && historyData[promptId];
  if (!root || !root.outputs || typeof root.outputs !== "object") {
    throw new Error("Comfy history response missing outputs.");
  }

  for (const value of Object.values(root.outputs)) {
    const ref = tryParseAudioRef(value);
    if (ref) return ref;
  }

  throw new Error("Comfy history does not contain generated audio.");
}

const IMAGE_HISTORY_TIMEOUT_MS =
  Number(process.env.COMFY_HISTORY_TIMEOUT_MS) || 600_000; // 10m
const VIDEO_HISTORY_TIMEOUT_MS =
  Number(process.env.COMFY_VIDEO_HISTORY_TIMEOUT_MS) ||
  Number(process.env.COMFY_HISTORY_TIMEOUT_MS) ||
  2_700_000; // 45m — video graphs often exceed 10m
const HISTORY_HARD_CAP_MS =
  Number(process.env.COMFY_HISTORY_MAX_MS) || 3_600_000; // 60m absolute ceiling

function queueItemPromptId(item) {
  // Comfy queue rows look like: [number, prompt_id, node_errors?, ...]
  if (!Array.isArray(item) || item.length < 2) return null;
  return item[1] != null ? String(item[1]) : null;
}

async function isPromptStillActiveInComfy(promptId) {
  const id = String(promptId || "");
  if (!id) return false;
  try {
    const queue = await requestJson("/queue", { method: "GET" });
    const running = Array.isArray(queue?.queue_running)
      ? queue.queue_running
      : [];
    const pending = Array.isArray(queue?.queue_pending)
      ? queue.queue_pending
      : [];
    return [...running, ...pending].some(
      (item) => queueItemPromptId(item) === id,
    );
  } catch (err) {
    if (_isConnectionRefusedError(err)) return false;
    const msg = String(err && err.message ? err.message : "");
    if (/ECONNREFUSED|network error/i.test(msg)) return false;
    // Transient queue probe failure — keep soft-waiting.
    return true;
  }
}

function _missingOutputFromPoll(message, extra, logCheckpoint) {
  const evidence = [
    message,
    extra && extra.traceback,
    extra && extra.exceptionType,
    comfyLogTextSince(logCheckpoint),
  ]
    .filter(Boolean)
    .join("\n");
  return missingOutputError(message, evidence, extra || {});
}

async function pollHistoryForOutput(
  promptId,
  wantsVideo,
  timeoutMs,
  logCheckpoint,
  wantsAudio,
) {
  const softTimeout =
    timeoutMs != null
      ? Number(timeoutMs)
      : wantsVideo || wantsAudio
        ? VIDEO_HISTORY_TIMEOUT_MS
        : IMAGE_HISTORY_TIMEOUT_MS;
  const softDeadline = Date.now() + softTimeout;
  const hardDeadline =
    Date.now() + Math.max(softTimeout, HISTORY_HARD_CAP_MS);
  // Consecutive observations of "no history entry AND not in Comfy's queue".
  // Requires several in a row so the moment between queue-exit and
  // history-write can never be mistaken for a lost prompt.
  let goneStreak = 0;
  const GONE_STREAK_THRESHOLD = 3;

  while (Date.now() < hardDeadline) {
    let data;
    try {
      data = await requestJson(`/history/${encodeURIComponent(promptId)}`, {
        method: "GET",
      });
    } catch (err) {
      // Transient poll failure (request timeout, engine mid-restart).
      // ECONNREFUSED already recycled inside the fetch layer; anything else
      // is not evidence about the job, so keep waiting within the deadlines.
      console.warn(
        `[comfy] history poll failed (${err.message}); still waiting`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    try {
      if (wantsAudio) {
        return parseOutputAudio(data, promptId);
      }
      if (wantsVideo) {
        return parseOutputVideo(data, promptId);
      }
      return parseOutputImage(data, promptId);
    } catch {
      // Still running or wrong parser pass.
    }
    if (!wantsVideo && !wantsAudio) {
      try {
        return parseOutputVideo(data, promptId);
      } catch {
        // Fall through — image workflow may not emit video yet.
      }
    }

    // History is only written when Comfy finishes the prompt. No output file
    // there means the expected artifact was not created.
    if (historyHasPromptEntry(data, promptId)) {
      const execErr = extractHistoryExecutionError(data, promptId);
      throw _missingOutputFromPoll(
        execErr && execErr.message
          ? execErr.message
          : "Comfy finished without an output file.",
        {
          exceptionType: execErr && execErr.exceptionType,
          traceback: execErr && execErr.traceback,
        },
        logCheckpoint,
      );
    }

    // No history entry: either still executing/queued, or the engine
    // restarted and the prompt is simply gone. Detect "gone" quickly so a
    // crash does not park the job until the soft timeout expires.
    const stillActive = await isPromptStillActiveInComfy(promptId);
    if (!stillActive) {
      goneStreak += 1;
      if (goneStreak >= GONE_STREAK_THRESHOLD || Date.now() >= softDeadline) {
        throw _missingOutputFromPoll(
          "Timed out waiting for Comfy history output (prompt no longer in queue). You can submit the job again.",
          {},
          logCheckpoint,
        );
      }
    } else {
      goneStreak = 0;
      // Comfy is still working — keep waiting until the hard cap.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw _missingOutputFromPoll(
    "Timed out waiting for Comfy history output after the maximum wait. Comfy may still finish; you can submit again, or raise COMFY_VIDEO_HISTORY_TIMEOUT_MS / COMFY_HISTORY_MAX_MS.",
    {},
    logCheckpoint,
  );
}

function defaultExtensionForKind(kind) {
  if (kind === "video") return ".mp4";
  if (kind === "audio") return ".mp3";
  return ".png";
}

function extensionFromComfyFilename(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext && ext.length > 1) return ext;
  return null;
}

function makeOutputFilename(seed, kind, sourceFilename) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(3).toString("hex");
  const ext =
    extensionFromComfyFilename(sourceFilename) ||
    defaultExtensionForKind(kind);
  const prefix = kind === "video" ? "vid" : kind === "audio" ? "aud" : "img";
  return `${prefix}-${stamp}-${seed}-${rand}${ext}`;
}

async function _runComfyGenerationOnce(input, outDir, started, opts = {}) {
  await ensureManagedComfyReady();
  const logCheckpoint = captureComfyLogCheckpoint();

  const workflow = buildWorkflowByFamily(input);
  const queued = await requestJson("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });

  const promptId = queued?.prompt_id;
  if (!promptId) {
    throw new Error("Comfy did not return prompt_id.");
  }
  if (typeof opts.onQueued === "function") {
    try {
      opts.onQueued(String(promptId));
    } catch (err) {
      console.warn(`[comfy] onQueued failed: ${err.message}`);
    }
  }

  const workflowId =
    typeof input.managedWorkflowId === "string" ? input.managedWorkflowId : "";
  const wantsAudio =
    input.expectAudio === true ||
    workflowId.startsWith("text2audio") ||
    workflowId.startsWith("audio2audio");
  const wantsVideo =
    !wantsAudio &&
    (input.expectVideo === true ||
      workflowId.startsWith("image2video") ||
      workflowId.startsWith("text2video") ||
      workflowId.startsWith("audio2video") ||
      workflowId.startsWith("video2video") ||
      workflowId.startsWith("reference2video"));

  const mediaRef = await pollHistoryForOutput(
    String(promptId),
    wantsVideo,
    undefined,
    logCheckpoint,
    wantsAudio,
  );
  const query = new URLSearchParams({
    filename: mediaRef.filename,
    subfolder: mediaRef.subfolder,
    type: mediaRef.type,
  });
  const fileBuffer = await requestBuffer(`/view?${query.toString()}`);

  fs.mkdirSync(outDir, { recursive: true });
  const kind =
    mediaRef.kind || (wantsAudio ? "audio" : wantsVideo ? "video" : "image");
  const fileName = makeOutputFilename(input.seed, kind, mediaRef.filename);
  const outPath = path.join(outDir, fileName);

  if (kind === "video") {
    const tmpRaw = path.join(
      outDir,
      `.raw-${path.basename(fileName, path.extname(fileName))}${extensionFromComfyFilename(mediaRef.filename) || ".mp4"}`,
    );
    fs.writeFileSync(tmpRaw, fileBuffer);
    try {
      const { transcodeToDeliveryMp4 } = require("../lib/video-delivery.js");
      const deliveryName = fileName.replace(/\.[^.]+$/, ".mp4");
      const deliveryPath = path.join(outDir, deliveryName);
      await transcodeToDeliveryMp4(tmpRaw, deliveryPath);
      return {
        ok: true,
        file_name: deliveryName,
        file_path: deliveryPath,
        family: input.family,
        model: input.modelPath,
        seed: input.seed,
        elapsed_ms: Date.now() - started,
        media_kind: "video",
      };
    } finally {
      try {
        if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw);
      } catch {
        /* ignore */
      }
    }
  }

  fs.writeFileSync(outPath, fileBuffer);

  return {
    ok: true,
    file_name: fileName,
    file_path: outPath,
    family: input.family,
    model: input.modelPath,
    seed: input.seed,
    elapsed_ms: Date.now() - started,
    media_kind: kind,
  };
}

function isComfyGoneError(err) {
  const msg = String(err && err.message ? err.message : "");
  return (
    /prompt no longer in queue/i.test(msg) ||
    /ECONNREFUSED/i.test(msg) ||
    /network error/i.test(msg) ||
    /operation was aborted/i.test(msg)
  );
}

async function runComfyGeneration(input, outDir, opts = {}) {
  const started = Date.now();
  const runOnce = () =>
    retryAfterComfyRecycle(
      () => _runComfyGenerationOnce(input, outDir, started, opts),
      recycleManagedComfy,
    );
  try {
    return await runOnce();
  } catch (err) {
    if (!isComfyGoneError(err)) throw err;
    console.warn(
      "[comfy] generation lost after engine restart; submitting again",
    );
    await ensureManagedComfyReady();
    return retryAfterComfyRecycle(
      () => _runComfyGenerationOnce(input, outDir, started, opts),
      recycleManagedComfy,
    );
  }
}

/**
 * Ask Comfy to stop the current execution and optionally clear the pending queue.
 * Useful when a long video job is stuck after the API waiter has already timed out.
 */
async function interruptComfy({ clearQueue = true } = {}) {
  await ensureManagedComfyReady();
  const interrupted = await requestJson("/interrupt", { method: "POST" });
  let queueCleared = false;
  if (clearQueue) {
    await requestJson("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
    queueCleared = true;
  }
  let queue = null;
  try {
    queue = await requestJson("/queue", { method: "GET" });
  } catch {
    // best-effort status
  }
  return {
    ok: true,
    interrupted: interrupted ?? true,
    queue_cleared: queueCleared,
    queue_running: Array.isArray(queue?.queue_running)
      ? queue.queue_running.length
      : null,
    queue_pending: Array.isArray(queue?.queue_pending)
      ? queue.queue_pending.length
      : null,
  };
}

module.exports = {
  runComfyGeneration,
  interruptComfy,
  isComfyGoneError,
  parseOutputAudio,
  tryParseAudioRef,
};
