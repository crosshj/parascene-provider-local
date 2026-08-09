/* eslint-env jest */
"use strict";

const {
  BLOCK_FRAMES,
  OVERLAP_FRAMES,
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

  it("stagesFor 3s fits in one block", () => {
    const plan = stagesFor(durationSecondsToAnimateFrames(3, 16));
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0].length).toBe(49);
    expect(plan.useContextWindows).toBe(false);
  });

  it("stagesFor 5s uses one block (80→81)", () => {
    const plan = stagesFor(durationSecondsToAnimateFrames(5, 16));
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0].length).toBe(BLOCK_FRAMES);
  });

  it("stagesFor ~10s uses base + extend", () => {
    const plan = stagesFor(120);
    expect(plan.stages).toHaveLength(2);
    expect(plan.stages[0].length).toBe(BLOCK_FRAMES);
    expect(plan.stages[1].length).toBeGreaterThan(OVERLAP_FRAMES);
    expect(plan.useContextWindows).toBe(false);
  });

  it("stagesFor 15s uses context-window single pass", () => {
    const plan = stagesFor(durationSecondsToAnimateFrames(15, 16));
    expect(plan.stages).toHaveLength(1);
    expect(plan.useContextWindows).toBe(true);
    expect(plan.stages[0].length).toBeGreaterThan(BLOCK_FRAMES);
  });
});
