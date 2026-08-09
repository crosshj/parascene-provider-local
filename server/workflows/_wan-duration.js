"use strict";

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

module.exports = {
  durationSecondsToWanFrames,
};
