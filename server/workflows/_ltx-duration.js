"use strict";

const {
  DEFAULT_VIDEO_DURATION_SECONDS,
  resolveWorkflowDurationSeconds,
  resolveWorkflowFps,
  resolveExplicitLength,
} = require("./_duration.js");

/**
 * LTX EmptyLTXVLatentVideo length from wall-clock duration.
 * Official Comfy templates use `duration * fps + 1`.
 */
function durationSecondsToLtxFrames(durationSeconds, fps, fallbackFps = 24) {
  const seconds = Number(durationSeconds);
  const rate = Number(fps);
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const f = Number.isFinite(rate) && rate > 0 ? rate : fallbackFps;
  return Math.max(1, Math.round(s * f) + 1);
}

function writeDurationPrimitive(node, durationSeconds) {
  if (!node?.inputs) return;
  const classType = String(node.class_type || "");
  node.inputs.value =
    classType === "PrimitiveInt"
      ? Math.max(1, Math.round(durationSeconds))
      : durationSeconds;
}

/**
 * Resolve seconds/fps, patch Duration + fps primitives, and bake frame counts
 * onto latent/length nodes. Do not leave length wired only to MathExpression.
 *
 * @param {object} workflow
 * @param {object} overrides
 * @param {object} spec
 * @param {string} [spec.durationNodeId]
 * @param {string[]} [spec.durationNodeIds] extra Duration primitives to copy
 * @param {string} [spec.fpsNodeId]
 * @param {string} [spec.fpsField="value"]
 * @param {Array<{id: string, field?: string}>} spec.lengthTargets
 * @param {number} [spec.fallbackSeconds]
 * @param {number} [spec.fallbackFps=24]
 */
function applyLtxDuration(workflow, overrides = {}, spec = {}) {
  const fallbackFps = spec.fallbackFps || 24;
  const fps =
    resolveWorkflowFps(
      overrides,
      workflow[spec.fpsNodeId]?.inputs?.[spec.fpsField || "value"] ??
        fallbackFps,
    ) ?? fallbackFps;

  const durationSeconds = resolveWorkflowDurationSeconds(
    overrides,
    workflow[spec.durationNodeId]?.inputs?.value ??
      spec.fallbackSeconds ??
      DEFAULT_VIDEO_DURATION_SECONDS,
  );

  if (spec.fpsNodeId && workflow[spec.fpsNodeId]?.inputs) {
    workflow[spec.fpsNodeId].inputs[spec.fpsField || "value"] = fps;
  }

  const durationIds = [
    spec.durationNodeId,
    ...(spec.durationNodeIds || []),
  ].filter(Boolean);
  for (const id of durationIds) {
    writeDurationPrimitive(workflow[id], durationSeconds);
  }

  const explicitLength = resolveExplicitLength(overrides);
  const frames =
    explicitLength !== undefined
      ? explicitLength
      : durationSecondsToLtxFrames(durationSeconds, fps, fallbackFps);

  for (const target of spec.lengthTargets || []) {
    if (!target?.id || !workflow[target.id]?.inputs) continue;
    workflow[target.id].inputs[target.field || "length"] = frames;
  }

  return { durationSeconds, fps, frames };
}

module.exports = {
  durationSecondsToLtxFrames,
  applyLtxDuration,
};
