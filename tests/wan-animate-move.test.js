/* eslint-env jest */
"use strict";

const WanAnimate2Workflow = require("../server/workflows/video2video/wan_animate_2.js");

describe("WanAnimate2Workflow", () => {
  it("wires Animate2 nodes (no DWPose / Mix mask path)", () => {
    const wf = WanAnimate2Workflow({
      prompt: "a dancer",
      inputVideoFilename: "prep.mp4",
      inputImageFilename: "char.png",
      durationSeconds: 3,
    });
    expect(wf["261:247"].class_type).toBe("WanAnimate2ToVideo");
    expect(wf["261:247"].inputs.pose_video).toEqual(["261:243", 0]);
    expect(wf["261:247"].inputs.reference_image).toEqual(["261:244", 0]);
    expect(wf["261:247"].inputs.background_video).toBeUndefined();
    expect(wf["261:247"].inputs.character_mask).toBeUndefined();
    expect(wf["261:241"].class_type).toBe("GetVideoComponents");
  });

  it("patches video, image, prompt, dims; drops extend for short clips", () => {
    const wf = WanAnimate2Workflow({
      prompt: "hero walks",
      negativePrompt: "blur",
      inputVideoFilename: "motion.mp4",
      inputImageFilename: "hero.png",
      width: 544,
      height: 960,
      seed: 42,
      durationSeconds: 3,
    });
    expect(wf["240"].inputs.file).toBe("motion.mp4");
    expect(wf["189"].inputs.image).toBe("hero.png");
    expect(wf["261:3"].inputs.text).toBe("hero walks");
    expect(wf["261:222"].inputs.text).toBe("hero walks");
    expect(wf["261:4"].inputs.text).toBe("blur");
    expect(wf["261:243"].inputs["resize_type.width"]).toBe(544);
    expect(wf["261:243"].inputs["resize_type.height"]).toBe(960);
    expect(wf["261:19"].inputs.noise_seed).toBe(42);
    expect(wf["245"].inputs.images).toEqual(["261:6", 0]);
    expect(wf["477:458"]).toBeUndefined();
  });

  it("keeps extend stage for mid lengths and batches frames", () => {
    const wf = WanAnimate2Workflow({
      prompt: "long",
      inputVideoFilename: "v.mp4",
      inputImageFilename: "i.png",
      durationSeconds: 8,
    });
    expect(wf["261:247"]).toBeDefined();
    expect(wf["477:458"]).toBeDefined();
    expect(wf["477:458"].inputs.continue_motion).toEqual(["261:6", 0]);
    expect(wf["477:458"].inputs.video_frame_offset).toEqual(["261:247", 5]);
    expect(wf["289"].inputs["images.image0"]).toEqual(["261:6", 0]);
    expect(wf["289"].inputs["images.image1"]).toEqual(["477:475", 0]);
    expect(wf["245"].inputs.images).toEqual(["289", 0]);
  });

  it("enables context windows for long single-pass clips", () => {
    const wf = WanAnimate2Workflow({
      prompt: "very long",
      inputVideoFilename: "v.mp4",
      inputImageFilename: "i.png",
      durationSeconds: 15,
    });
    expect(wf["477:458"]).toBeUndefined();
    expect(wf["261:258"].inputs.switch).toBe(true);
    expect(wf["261:247"].inputs.length).toBeGreaterThan(81);
    expect(wf["245"].inputs.images).toEqual(["261:6", 0]);
  });
});
