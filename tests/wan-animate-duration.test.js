/* eslint-env jest */
"use strict";

const {
  BLOCK_FRAMES,
  OVERLAP_FRAMES,
  MAX_STAGES,
  STRIDE_FRAMES,
  alignAnimateLength,
  durationSecondsToAnimateFrames,
  stagesFor,
} = require("../server/workflows/_wan-animate-duration.js");

describe("wan-animate-duration (Animate 2)", () => {
  it("aligns lengths to 4n+1", () => {
    expect(alignAnimateLength(81)).toBe(81);
    expect(alignAnimateLength(48)).toBe(49);
    expect(alignAnimateLength(80)).toBe(81);
  });

  it("maps duration to frames at 16 fps", () => {
    expect(durationSecondsToAnimateFrames(3, 16)).toBe(48);
    expect(durationSecondsToAnimateFrames(5, 16)).toBe(80);
    expect(durationSecondsToAnimateFrames(12, 16)).toBe(192);
    expect(durationSecondsToAnimateFrames(15, 16)).toBe(240);
  });

  it.each([
    [1, 1],
    [3, 1],
    [5, 1],
    [6, 2],
    [8, 2],
    [10, 2],
    [12, 3],
    [15, 3],
  ])("stagesFor %is → %i stage(s)", (seconds, expectedStages) => {
    const plan = stagesFor(durationSecondsToAnimateFrames(seconds, 16));
    expect(plan.stages).toHaveLength(expectedStages);
    expect(plan.stages.length).toBeLessThanOrEqual(MAX_STAGES);
    expect(plan.useContextWindows).toBeUndefined();
    if (expectedStages > 1) {
      expect(plan.stages[0].length).toBe(BLOCK_FRAMES);
      expect(plan.stages[expectedStages - 1].length).toBeGreaterThan(
        OVERLAP_FRAMES,
      );
    }
    // Produced frames cover the target (stride math).
    expect(plan.producedFrames).toBeGreaterThanOrEqual(plan.targetFrames);
  });

  it("stride covers 15s within max stages", () => {
    expect(BLOCK_FRAMES + 3 * STRIDE_FRAMES).toBeGreaterThanOrEqual(240);
  });
});
