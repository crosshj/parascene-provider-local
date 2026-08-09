"use strict";

/** First / typical WanAnimateToVideo block length @ 16 fps. */
const BLOCK_FRAMES = 77;
/** continue_motion_max_frames — overlap between chained stages. */
const OVERLAP_FRAMES = 5;
const STRIDE_FRAMES = BLOCK_FRAMES - OVERLAP_FRAMES; // 72
const DEFAULT_FPS = 16;
const MAX_STAGES = 4;
const MAX_DURATION_SECONDS = 15;

/**
 * Wan Animate lengths use step 4 (and typically 4n+1, e.g. 77).
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
 * Plan Move chain stages for a target frame count.
 * Stage 0 has no continue_motion; later stages overlap by OVERLAP_FRAMES.
 *
 * @returns {{ stages: Array<{ length: number }>, targetFrames: number, producedFrames: number }}
 */
function stagesFor(targetFrames) {
  const raw = Math.max(1, Math.round(Number(targetFrames) || 1));
  const maxFrames = Math.round(MAX_DURATION_SECONDS * DEFAULT_FPS);
  const target = Math.min(raw, maxFrames);

  if (target <= BLOCK_FRAMES) {
    const length = alignAnimateLength(target);
    return {
      stages: [{ length }],
      targetFrames: target,
      producedFrames: length,
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
