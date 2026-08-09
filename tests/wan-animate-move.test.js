/* eslint-env jest */
"use strict";

const {
  BLOCK_FRAMES,
  stagesFor,
} = require("../server/workflows/_wan-animate-duration.js");
const WanAnimate2Workflow = require("../server/workflows/video2video/wan_animate_2.js");
const { STAGES } = WanAnimate2Workflow;

/** Canonical continue/offset chain baked into the template. */
const EXPECTED_CHAIN = [
  { wan: "261:247", continue: null, offset: 0 },
  {
    wan: "477:458",
    continue: ["261:6", 0],
    offset: ["261:247", 5],
  },
  {
    wan: "478:458",
    continue: ["477:472", 0],
    offset: ["477:458", 5],
  },
  {
    wan: "479:458",
    continue: ["478:472", 0],
    offset: ["478:458", 5],
  },
];

function assertAllBlocksPresent(wf) {
  for (const stage of STAGES) {
    expect(wf[stage.wan]).toBeDefined();
    expect(wf[stage.wan].class_type).toBe("WanAnimate2ToVideo");
    expect(wf[stage.decode]).toBeDefined();
    expect(wf[stage.contextSwitch].inputs.switch).toBe(false);
  }
}

function assertChainWiring(wf) {
  for (const link of EXPECTED_CHAIN) {
    const wan = wf[link.wan];
    expect(wan).toBeDefined();
    if (link.continue == null) {
      expect(wan.inputs.continue_motion).toBeUndefined();
      expect(wan.inputs.video_frame_offset).toBe(0);
    } else {
      expect(wan.inputs.continue_motion).toEqual(link.continue);
      expect(wan.inputs.video_frame_offset).toEqual(link.offset);
    }
  }
}

function assertOutputWiring(wf, activeCount) {
  if (activeCount === 1) {
    expect(wf["245"].inputs.images).toEqual(["261:6", 0]);
    return;
  }
  expect(wf["245"].inputs.images).toEqual(["289", 0]);
  const batch = wf["289"].inputs;
  expect(Object.keys(batch).filter((k) => k.startsWith("images.image"))).toHaveLength(
    activeCount,
  );
  expect(batch["images.image0"]).toEqual(["261:6", 0]);
  for (let i = 1; i < activeCount; i++) {
    expect(batch[`images.image${i}`]).toEqual([STAGES[i].continued, 0]);
  }
  // Inactive stages must not appear in the batch.
  for (let i = activeCount; i < STAGES.length; i++) {
    expect(batch[`images.image${i}`]).toBeUndefined();
  }
}

describe("WanAnimate2Workflow", () => {
  it("keeps all prebaked blocks and canonical chain links", () => {
    const wf = WanAnimate2Workflow({
      prompt: "x",
      inputVideoFilename: "v.mp4",
      inputImageFilename: "i.png",
      durationSeconds: 3,
    });
    assertAllBlocksPresent(wf);
    assertChainWiring(wf);
  });

  it("patches media/prompt onto every prebaked stage", () => {
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
    for (const stage of STAGES) {
      expect(wf[stage.appearance].inputs.text).toBe("hero walks");
      expect(wf[stage.posePrompt].inputs.text).toBe("hero walks");
      expect(wf[stage.negative].inputs.text).toBe("blur");
      expect(wf[stage.poseResize].inputs["resize_type.width"]).toBe(544);
      expect(wf[stage.sampler].inputs.noise_seed).toBe(42);
    }
  });

  describe.each([
    [1, 1],
    [3, 1],
    [5, 1],
    [6, 2],
    [8, 2],
    [10, 2],
    [12, 3],
    [15, 3],
  ])("duration %is → %i active stage(s)", (seconds, expectedActive) => {
    it("enables output wiring without breaking inactive blocks", () => {
      const plan = stagesFor(Math.round(seconds * 16));
      expect(plan.stages.length).toBe(expectedActive);

      const wf = WanAnimate2Workflow({
        prompt: `clip ${seconds}s`,
        inputVideoFilename: "v.mp4",
        inputImageFilename: "i.png",
        durationSeconds: seconds,
      });

      assertAllBlocksPresent(wf);
      assertChainWiring(wf);
      assertOutputWiring(wf, expectedActive);

      for (let i = 0; i < expectedActive; i++) {
        expect(wf[STAGES[i].wan].inputs.length).toBe(plan.stages[i].length);
      }
      // First active block is full size when multi-stage.
      if (expectedActive > 1) {
        expect(wf[STAGES[0].wan].inputs.length).toBe(BLOCK_FRAMES);
      }
      // Shared driving video still reaches every extend GetVideoComponents.
      expect(wf["477:466"].inputs.video).toEqual(["240", 0]);
      expect(wf["478:466"].inputs.video).toEqual(["240", 0]);
      expect(wf["479:466"].inputs.video).toEqual(["240", 0]);
    });
  });
});
