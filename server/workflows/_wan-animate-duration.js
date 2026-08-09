"use strict";

/**
 * Wan Animate 2 (`WanAnimate2ToVideo`) block sizing.
 * Inbox template uses length 81; extend skips 1 frame via ImageFromBatch.
 */
const BLOCK_FRAMES = 81;
const OVERLAP_FRAMES = 1;
const STRIDE_FRAMES = BLOCK_FRAMES - OVERLAP_FRAMES; // 80
const DEFAULT_FPS = 16;
/** Inbox graph ships base + one extend. Longer clips use context windows. */
const MAX_STAGES = 2;
const MAX_DURATION_SECONDS = 15;

/**
 * Animate lengths use step 4 (typically 4n+1, e.g. 81).
 */
function alignAnimateLength(frames) {
  const n = Math.max(1, Math.round(Number(frames) || 1));
  return Math.max(1, 4 * Math.round((n - 1) / 4) + 1);
}

function durationSecondsToAnimateFrames(
  durationSeconds,
  fps = DEFAULT_FPS,
  fallbackFps = DEFAULT_FPS,
) {
  const seconds = Number(durationSeconds);
  const rate = Number(fps);
  const s =
    Number.isFinite(seconds) && seconds > 0
      ? Math.min(seconds, MAX_DURATION_SECONDS)
      : 0;
  const f = Number.isFinite(rate) && rate > 0 ? rate : fallbackFps;
  if (!(s > 0)) return BLOCK_FRAMES;
  return Math.max(1, Math.round(s * f));
}

/**
 * Plan Animate 2 stages for a target frame count.
 *
 * @returns {{
 *   stages: Array<{ length: number }>,
 *   targetFrames: number,
 *   producedFrames: number,
 *   useContextWindows: boolean,
 * }}
 */
function stagesFor(targetFrames) {
  const raw = Math.max(1, Math.round(Number(targetFrames) || 1));
  const maxFrames = Math.round(MAX_DURATION_SECONDS * DEFAULT_FPS);
  const target = Math.min(raw, maxFrames);

  // Longer than two 81-frame blocks: single pass with context windows.
  const twoStageMax = BLOCK_FRAMES + STRIDE_FRAMES;
  if (target > twoStageMax) {
    const length = alignAnimateLength(target);
    return {
      stages: [{ length }],
      targetFrames: target,
      producedFrames: length,
      useContextWindows: true,
    };
  }

  if (target <= BLOCK_FRAMES) {
    const length = alignAnimateLength(target);
    return {
      stages: [{ length }],
      targetFrames: target,
      producedFrames: length,
      useContextWindows: false,
    };
  }

  const stages = [{ length: BLOCK_FRAMES }];
  let produced = BLOCK_FRAMES;
  while (produced < target && stages.length < MAX_STAGES) {
    const remaining = target - produced;
    const need = remaining + OVERLAP_FRAMES;
    const length = alignAnimateLength(Math.min(BLOCK_FRAMES, need));
    stages.push({ length });
    produced += length - OVERLAP_FRAMES;
  }

  return {
    stages,
    targetFrames: target,
    producedFrames: produced,
    useContextWindows: false,
  };
}

module.exports = {
  BLOCK_FRAMES,
  OVERLAP_FRAMES,
  STRIDE_FRAMES,
  DEFAULT_FPS,
  MAX_STAGES,
  MAX_DURATION_SECONDS,
  alignAnimateLength,
  durationSecondsToAnimateFrames,
  stagesFor,
};
