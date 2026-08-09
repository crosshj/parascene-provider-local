"use strict";

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

module.exports = {
  durationSecondsToLtxFrames,
};
