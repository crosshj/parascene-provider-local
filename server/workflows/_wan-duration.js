"use strict";

const {
  DEFAULT_VIDEO_DURATION_SECONDS,
  resolveWorkflowDurationSeconds,
  resolveWorkflowFps,
  resolveExplicitLength,
} = require("./_duration.js");

/**
 * Wan latent length from wall-clock duration.
 * Wan expects length = 4n+1 (e.g. template default 81).
 */
function durationSecondsToWanFrames(durationSeconds, fps, fallbackFps = 16) {
  const seconds = Number(durationSeconds);
  const rate = Number(fps);
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const f = Number.isFinite(rate) && rate > 0 ? rate : fallbackFps;
  const raw = Math.max(1, Math.round(s * f));
  return Math.max(1, 4 * Math.round((raw - 1) / 4) + 1);
}

/**
 * Resolve seconds/fps and bake Wan `length` (4n+1).
 *
 * @param {object} workflow
 * @param {object} overrides
 * @param {object} spec
 * @param {string} spec.lengthNodeId
 * @param {string} [spec.fpsNodeId]
 * @param {string} [spec.fpsField="fps"]
 * @param {number} [spec.fallbackFps=16]
 */
function applyWanDuration(workflow, overrides = {}, spec = {}) {
  const fallbackFps = spec.fallbackFps || 16;
  const fps =
    resolveWorkflowFps(
      overrides,
      workflow[spec.fpsNodeId]?.inputs?.[spec.fpsField || "fps"] ?? fallbackFps,
    ) ?? fallbackFps;

  if (spec.fpsNodeId && workflow[spec.fpsNodeId]?.inputs) {
    workflow[spec.fpsNodeId].inputs[spec.fpsField || "fps"] = fps;
  }

  const lengthNode = spec.lengthNodeId && workflow[spec.lengthNodeId];
  if (!lengthNode?.inputs) return { fps };

  const explicitLength = resolveExplicitLength(overrides);
  const durationSeconds = resolveWorkflowDurationSeconds(
    overrides,
    DEFAULT_VIDEO_DURATION_SECONDS,
  );
  const frames =
    explicitLength !== undefined
      ? explicitLength
      : durationSecondsToWanFrames(durationSeconds, fps, fallbackFps);
  lengthNode.inputs.length = frames;
  return { durationSeconds, fps, frames };
}

module.exports = {
  durationSecondsToWanFrames,
  applyWanDuration,
};
