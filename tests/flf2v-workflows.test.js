/* eslint-env jest */
"use strict";

const LtxFlf2vWorkflow = require("../server/workflows/image2video/ltx2_3_flf2v.js");
const WanFlf2vWorkflow = require("../server/workflows/image2video/wan2_2_14B_flf2v.js");

describe("first/last-frame workflows", () => {
  it("LTX flf2v patches start/end images, prompt, and length", () => {
    const workflow = LtxFlf2vWorkflow({
      prompt: "walk across",
      inputImageFilename: "start.png",
      endImageFilename: "end.png",
      durationSeconds: 3,
      fps: 25,
      width: 768,
      height: 768,
      seed: 42,
    });
    expect(workflow["31"].inputs.image).toBe("start.png");
    expect(workflow["39"].inputs.image).toBe("end.png");
    expect(workflow["128"].inputs.text).toBe("walk across");
    // 3s × 25fps + 1 (LTX latent convention)
    expect(workflow["102"].inputs.value).toBe(76);
    expect(workflow["113"].inputs.value).toBe(768);
    expect(workflow["98"].inputs.value).toBe(768);
    expect(workflow["100"].inputs.noise_seed).toBe(42);
  });

  it("Wan flf2v patches start/end images and length", () => {
    const workflow = WanFlf2vWorkflow({
      prompt: "walk across",
      inputImageFilename: "start.png",
      endImageFilename: "end.png",
      durationSeconds: 4,
      fps: 16,
    });
    expect(workflow["97"].inputs.image).toBe("start.png");
    expect(workflow["99"].inputs.image).toBe("end.png");
    expect(workflow["129:98"].class_type).toBe("WanFirstLastFrameToVideo");
    expect(workflow["129:98"].inputs.end_image).toEqual(["99", 0]);
    expect(workflow["129:98"].inputs.length).toBe(64);
    expect(workflow["129:93"].inputs.text).toBe("walk across");
  });
});
