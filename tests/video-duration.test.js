/* eslint-env jest */
"use strict";

const WanImage2VideoWorkflow = require("../server/workflows/image2video/wan2_2_14B.js");
const WanText2VideoWorkflow = require("../server/workflows/text2video/wan2_2_t2v.js");
const LtxImage2VideoWorkflow = require("../server/workflows/image2video/ltx2_3.js");
const LtxText2VideoWorkflow = require("../server/workflows/text2video/ltx2_3_t2v.js");

describe("video duration → Comfy workflow length", () => {
  it("Wan i2v patches length from durationSeconds × fps", () => {
    const workflow = WanImage2VideoWorkflow({
      prompt: "hop",
      durationSeconds: 3,
      fps: 16,
      inputImageFilename: "start.png",
    });
    expect(workflow["129:98"].inputs.length).toBe(48);
    expect(workflow["129:94"].inputs.fps).toBe(16);
  });

  it("Wan t2v patches length from durationSeconds × fps", () => {
    const workflow = WanText2VideoWorkflow({
      prompt: "hop",
      durationSeconds: 2.5,
      fps: 16,
    });
    expect(workflow["6"].inputs.length).toBe(40);
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
});
