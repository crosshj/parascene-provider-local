"use strict";

/**
 * Shared duration defaults and resolve helpers for managed video/audio graphs.
 * See `.cursor/rules/workflows-duration.mdc`.
 */

const DEFAULT_VIDEO_DURATION_SECONDS = 5;
const DEFAULT_VIDEO_MIN_DURATION_SECONDS = 1;
const DEFAULT_VIDEO_MAX_DURATION_SECONDS = 15;
const DEFAULT_V2V_MAX_DURATION_SECONDS = 30;
/** Shared YuE2 / MiniMax Music cap (5 min). MiniMax's documented song limit. */
const DEFAULT_MUSIC_MAX_DURATION_SECONDS = 300;

function resolveWorkflowDurationSeconds(
  overrides = {},
  fallback = DEFAULT_VIDEO_DURATION_SECONDS,
) {
  const raw =
    overrides.durationSeconds ??
    overrides.duration_seconds ??
    overrides.duration;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0
    ? fb
    : DEFAULT_VIDEO_DURATION_SECONDS;
}

function resolveWorkflowFps(overrides = {}, fallback) {
  if (overrides.fps !== undefined) {
    const n = Number(overrides.fps);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? Math.floor(fb) : undefined;
}

function resolveExplicitLength(overrides = {}) {
  const raw = overrides.length ?? overrides.framesNumber ?? overrides.frames;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function clampDurationSeconds(
  value,
  {
    min = DEFAULT_VIDEO_MIN_DURATION_SECONDS,
    max = DEFAULT_VIDEO_MAX_DURATION_SECONDS,
  } = {},
) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const lo = Number.isFinite(min) && min > 0 ? min : 1;
  const hi = Number.isFinite(max) && max > 0 ? max : lo;
  return Math.min(hi, Math.max(lo, n));
}

module.exports = {
  DEFAULT_VIDEO_DURATION_SECONDS,
  DEFAULT_VIDEO_MIN_DURATION_SECONDS,
  DEFAULT_VIDEO_MAX_DURATION_SECONDS,
  DEFAULT_V2V_MAX_DURATION_SECONDS,
  DEFAULT_MUSIC_MAX_DURATION_SECONDS,
  resolveWorkflowDurationSeconds,
  resolveWorkflowFps,
  resolveExplicitLength,
  clampDurationSeconds,
};
