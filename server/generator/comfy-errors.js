"use strict";

/**
 * Restart Comfy only when we are reasonably sure of a host-buffer / AIMDO
 * stream failure:
 *   1. the expected output was not created
 *   2. this run's Comfy logs (or history text, if present) mention that error
 */

const HOSTBUF_ERROR_PATTERNS = [
  /hostbuf_file_reader_read\s+failed/i,
  /HostBuffer\.read_file_slice\s+failed/i,
  /hostbuf_read_file_slice/i,
];

class ComfyExecutionError extends Error {
  constructor(message, { exceptionType, traceback, recoverable } = {}) {
    super(message);
    this.name = "ComfyExecutionError";
    this.exceptionType = exceptionType || null;
    this.traceback = traceback || null;
    this.recoverable = recoverable === true;
  }
}

function _asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(_asText).join("\n");
  if (value instanceof Error) {
    return [value.message, value.stack, value.traceback, value.exceptionType]
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function looksLikeHostBufferFailure(text) {
  return HOSTBUF_ERROR_PATTERNS.some((re) => re.test(_asText(text)));
}

function shouldRestartAfterMissingOutput(evidenceText) {
  return looksLikeHostBufferFailure(evidenceText);
}

function isRecoverableComfyError(err) {
  if (err && typeof err === "object" && err.recoverable === true) return true;
  if (err && typeof err === "object" && err.recoverable === false) return false;
  return false;
}

function _errorFromExecutionPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const message =
    payload.exception_message ||
    payload.message ||
    payload.error ||
    "Comfy execution error";
  const traceback = _asText(payload.traceback);
  const exceptionType = payload.exception_type || payload.type || null;
  return new ComfyExecutionError(`Comfy execution error: ${message}`, {
    exceptionType,
    traceback: traceback || null,
    recoverable: false,
  });
}

function extractHistoryExecutionError(historyData, promptId) {
  const root =
    historyData && promptId != null ? historyData[promptId] : historyData;
  if (!root || typeof root !== "object") return null;

  const messages = root.status && root.status.messages;
  if (Array.isArray(messages)) {
    for (const item of messages) {
      if (!Array.isArray(item) || item[0] !== "execution_error") continue;
      const parsed = _errorFromExecutionPayload(item[1]);
      if (parsed) return parsed;
    }
  }

  if (root.status && root.status.status_str === "error") {
    const message = root.status.error || "Comfy execution failed.";
    return new ComfyExecutionError(`Comfy execution error: ${message}`, {
      recoverable: false,
    });
  }

  return null;
}

function historyHasPromptEntry(historyData, promptId) {
  const root =
    historyData && promptId != null ? historyData[promptId] : null;
  return !!(root && typeof root === "object");
}

function missingOutputError(message, evidenceText, extra = {}) {
  return new ComfyExecutionError(message, {
    exceptionType: extra.exceptionType || null,
    traceback: extra.traceback || null,
    recoverable: shouldRestartAfterMissingOutput(evidenceText),
  });
}

async function retryAfterComfyRecycle(runOnce, recycle, options = {}) {
  const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 2;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runOnce(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRecoverableComfyError(err)) {
        throw err;
      }
      const reason = `missing output after host-buffer error (attempt ${attempt}/${maxAttempts}): ${
        err && err.message ? err.message : String(err)
      }`;
      console.warn(`[comfy] ${reason}; recycling and retrying`);
      await recycle(reason);
    }
  }
  throw lastErr;
}

module.exports = {
  ComfyExecutionError,
  HOSTBUF_ERROR_PATTERNS,
  extractHistoryExecutionError,
  historyHasPromptEntry,
  isRecoverableComfyError,
  looksLikeHostBufferFailure,
  missingOutputError,
  retryAfterComfyRecycle,
  shouldRestartAfterMissingOutput,
};
