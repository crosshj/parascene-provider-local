/* eslint-env jest */
"use strict";

const WanImage2VideoWorkflow = require("../server/workflows/image2video/wan2_2_14B.js");
const WanText2VideoWorkflow = require("../server/workflows/text2video/wan2_2_t2v.js");
const LtxImage2VideoWorkflow = require("../server/workflows/image2video/ltx2_3.js");
const LtxText2VideoWorkflow = require("../server/workflows/text2video/ltx2_3_t2v.js");
const Ltx25Text2VideoWorkflow = require("../server/workflows/text2video/ltx2_5_t2v.js");
const LtxIdLoraWorkflow = require("../server/workflows/imageAudio2video/video_ltx2_3_id_lora.js");
const {
  DEFAULT_VIDEO_DURATION_SECONDS,
  resolveWorkflowDurationSeconds,
} = require("../server/workflows/_duration.js");

describe("video duration → Comfy workflow length", () => {
  it("Wan i2v patches length from durationSeconds × fps", () => {
    const workflow = WanImage2VideoWorkflow({
      prompt: "hop",
      durationSeconds: 3,
      fps: 16,
      inputImageFilename: "start.png",
    });
    expect(workflow["129:98"].inputs.length).toBe(49);
    expect(workflow["129:94"].inputs.fps).toBe(16);
  });

  it("Wan t2v patches length from durationSeconds × fps", () => {
    const workflow = WanText2VideoWorkflow({
      prompt: "hop",
      durationSeconds: 2.5,
      fps: 16,
    });
    expect(workflow["6"].inputs.length).toBe(41);
  });

  it("LTX i2v patches length from durationSeconds × fps + 1", () => {
    const workflow = LtxImage2VideoWorkflow({
      prompt: "hop",
      durationSeconds: 3,
      fps: 24,
      inputImageFilename: "start.png",
    });
    expect(workflow["267:225"].inputs.value).toBe(73);
  });

  it("LTX t2v patches length from durationSeconds × fps + 1", () => {
    const workflow = LtxText2VideoWorkflow({
      prompt: "hop",
      durationSeconds: 4,
      fps: 24,
    });
    expect(workflow["305"].inputs.value).toBe(97);
  });

  it("shared helper defaults omitted duration to 5s", () => {
    expect(DEFAULT_VIDEO_DURATION_SECONDS).toBe(5);
    expect(resolveWorkflowDurationSeconds({})).toBe(5);
    expect(resolveWorkflowDurationSeconds({ duration_seconds: 3 })).toBe(3);
  });

  it("LTX 2.5 t2v bakes Duration primitive and latent length", () => {
    const workflow = Ltx25Text2VideoWorkflow({
      prompt: "hop",
      durationSeconds: 4,
      fps: 24,
    });
    expect(workflow["405:362"].inputs.value).toBe(4);
    expect(workflow["405:356"].inputs.length).toBe(97);
    expect(workflow["405:366"].inputs.frames_number).toBe(97);
  });

  it("LTX ID-LoRA honors durationSeconds on Duration + latent length", () => {
    const workflow = LtxIdLoraWorkflow({
      prompt: "talk",
      durationSeconds: 3,
      fps: 25,
      inputAudioFilename: "clip.wav",
      inputImageFilename: "face.png",
    });
    expect(workflow["340:331"].inputs.value).toBe(3);
    expect(workflow["340:302"].inputs.length).toBe(76);
  });
});
