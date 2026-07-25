/* eslint-env jest */
"use strict";

const LtxAudio2VideoWorkflow = require("../server/workflows/imageAudio2video/video_ltx2_3_ia2v.js");
const { resolveDurationSeconds } = require("../server/lib/comfy-args.js");

describe("audio2video duration → Comfy workflow", () => {
  it("resolveDurationSeconds clamps into 1–15", () => {
    expect(resolveDurationSeconds({ duration_seconds: 0.5 })).toBe(1);
    expect(resolveDurationSeconds({ duration_seconds: 3 })).toBe(3);
    expect(resolveDurationSeconds({ durationSeconds: 4.56 })).toBe(4.6);
    expect(resolveDurationSeconds({ duration_seconds: 40 })).toBe(15);
    expect(resolveDurationSeconds({})).toBeUndefined();
  });

  it("bakes Duration node and EmptyLTXVLatentVideo length from durationSeconds", () => {
    const workflow = LtxAudio2VideoWorkflow({
      prompt: "lip sync",
      durationSeconds: 3,
      fps: 24,
      inputAudioFilename: "clip.wav",
      inputImageFilename: "start.png",
      useStartingImage: false,
    });

    expect(workflow["340:331"].inputs.value).toBe(3);
    expect(workflow["340:323"].inputs.value).toBe(24);
    // duration × fps — must not stay linked to MathExpression alone
    expect(workflow["340:302"].inputs.length).toBe(72);
    // TrimAudioDuration still reads the Duration primitive
    expect(workflow["340:332"].inputs.duration).toEqual(["340:331", 0]);
  });

  it("defaults to template 9s / 216 frames when duration omitted", () => {
    const workflow = LtxAudio2VideoWorkflow({
      prompt: "lip sync",
      inputAudioFilename: "clip.wav",
    });
    expect(workflow["340:331"].inputs.value).toBe(9);
    expect(workflow["340:302"].inputs.length).toBe(216);
  });
});
