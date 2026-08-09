/* eslint-env jest */
"use strict";

const WanAnimateMoveWorkflow = require("../server/workflows/video2video/wan2_2_animate_move.js");

describe("WanAnimateMoveWorkflow", () => {
  it("requires Move wiring (no background_video / character_mask)", () => {
    const wf = WanAnimateMoveWorkflow({
      prompt: "a dancer",
      inputVideoFilename: "prep.mp4",
      inputImageFilename: "char.png",
      durationSeconds: 3,
    });
    for (const node of Object.values(wf)) {
      if (node.class_type !== "WanAnimateToVideo") continue;
      expect(node.inputs.background_video).toBeUndefined();
      expect(node.inputs.character_mask).toBeUndefined();
      expect(node.inputs.pose_video).toEqual(["93", 0]);
      expect(node.inputs.face_video).toEqual(["92", 0]);
      expect(node.inputs.reference_image).toEqual(["12", 0]);
    }
  });

  it("patches video, image, prompt, and dims", () => {
    const wf = WanAnimateMoveWorkflow({
      prompt: "hero walks",
      negativePrompt: "blur",
      inputVideoFilename: "motion.mp4",
      inputImageFilename: "hero.png",
      width: 544,
      height: 960,
      seed: 42,
      durationSeconds: 3,
    });
    expect(wf["10"].inputs.file).toBe("motion.mp4");
    expect(wf["12"].inputs.image).toBe("hero.png");
    expect(wf["71"].inputs.text).toBe("hero walks");
    expect(wf["72"].inputs.text).toBe("blur");
    expect(wf["100"].inputs.width).toBe(544);
    expect(wf["100"].inputs.height).toBe(960);
    expect(wf["90"].inputs.width).toBe(544);
    expect(wf["101"].inputs.seed).toBe(42);
    expect(wf["200"].inputs.video).toEqual(["106", 0]);
    expect(wf["110"]).toBeUndefined();
  });

  it("keeps extend chain for longer durations and wires SaveVideo to last stage", () => {
    const wf = WanAnimateMoveWorkflow({
      prompt: "long",
      inputVideoFilename: "v.mp4",
      inputImageFilename: "i.png",
      durationSeconds: 12,
    });
    expect(wf["100"]).toBeDefined();
    expect(wf["110"]).toBeDefined();
    expect(wf["120"]).toBeDefined();
    expect(wf["130"]).toBeUndefined();
    expect(wf["200"].inputs.video).toEqual(["126", 0]);
    expect(wf["110"].inputs.continue_motion).toEqual(["103", 0]);
    expect(wf["110"].inputs.video_frame_offset).toEqual(["100", 5]);
  });
});
