"use strict";

const path = require("path");
const fs = require("fs");
const {
  BLOCK_FRAMES,
  DEFAULT_FPS,
  MAX_STAGES,
  durationSecondsToAnimateFrames,
  stagesFor,
} = require("../_wan-animate-duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "wan_animate_2.json"), "utf8"),
);

/**
 * Prebaked stages in wan_animate_2.json (base + 3 extends).
 * Unused stages stay in the graph but are left off the CreateVideo batch.
 */
const STAGES = [
  {
    wan: "261:247",
    sampler: "261:19",
    decode: "261:6",
    continued: "261:6", // stage0 contributes full decode
    contextSwitch: "261:258",
    appearance: "261:3",
    posePrompt: "261:222",
    negative: "261:4",
    poseResize: "261:243",
    unet: "261:239",
    scheduler: "261:18",
  },
  {
    wan: "477:458",
    sampler: "477:468",
    decode: "477:472",
    continued: "477:475",
    contextSwitch: "477:459",
    appearance: "477:453",
    posePrompt: "477:456",
    negative: "477:452",
    poseResize: "477:471",
    unet: "477:449",
    scheduler: "477:462",
    continueFromDecode: "261:6",
    offsetFromWan: "261:247",
  },
  {
    wan: "478:458",
    sampler: "478:468",
    decode: "478:472",
    continued: "478:475",
    contextSwitch: "478:459",
    appearance: "478:453",
    posePrompt: "478:456",
    negative: "478:452",
    poseResize: "478:471",
    unet: "478:449",
    scheduler: "478:462",
    continueFromDecode: "477:472",
    offsetFromWan: "477:458",
  },
  {
    wan: "479:458",
    sampler: "479:468",
    decode: "479:472",
    continued: "479:475",
    contextSwitch: "479:459",
    appearance: "479:453",
    posePrompt: "479:456",
    negative: "479:452",
    poseResize: "479:471",
    unet: "479:449",
    scheduler: "479:462",
    continueFromDecode: "478:472",
    offsetFromWan: "478:458",
  },
];

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * Wan Animate 2 — reference image + driving video.
 * Template ships max stages; builder enables the first K via CreateVideo/batch wiring.
 */
function WanAnimate2Workflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputVideoFilename && workflow["240"]?.inputs) {
    workflow["240"].inputs.file = String(overrides.inputVideoFilename);
  }
  if (overrides.inputImageFilename && workflow["189"]?.inputs) {
    workflow["189"].inputs.image = String(overrides.inputImageFilename);
  }

  const fps =
    overrides.fps !== undefined
      ? toNumber(overrides.fps, DEFAULT_FPS)
      : DEFAULT_FPS;
  if (workflow["245"]?.inputs) {
    workflow["245"].inputs.fps = fps;
  }

  const explicitLength =
    overrides.length ?? overrides.framesNumber ?? overrides.frames;
  let targetFrames;
  if (explicitLength !== undefined) {
    targetFrames = toPositiveInt(explicitLength, BLOCK_FRAMES);
  } else if (overrides.durationSeconds !== undefined) {
    targetFrames = durationSecondsToAnimateFrames(
      overrides.durationSeconds,
      fps,
    );
  } else {
    targetFrames = BLOCK_FRAMES;
  }

  const plan = stagesFor(targetFrames);
  const activeCount = Math.min(plan.stages.length, MAX_STAGES, STAGES.length);

  // Keep every prebaked block present; only the first `activeCount` feed output.
  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];
    if (workflow[stage.contextSwitch]?.inputs) {
      workflow[stage.contextSwitch].inputs.switch = false;
    }
    if (i > 0 && workflow[stage.wan]?.inputs) {
      // Restore canonical continue/offset links (template truth).
      workflow[stage.wan].inputs.continue_motion = [
        stage.continueFromDecode,
        0,
      ];
      workflow[stage.wan].inputs.video_frame_offset = [stage.offsetFromWan, 5];
    }
  }

  for (let i = 0; i < activeCount; i++) {
    const stage = STAGES[i];
    if (workflow[stage.wan]?.inputs) {
      workflow[stage.wan].inputs.length = plan.stages[i].length;
    }
  }

  if (activeCount === 1) {
    if (workflow["245"]?.inputs) {
      workflow["245"].inputs.images = [STAGES[0].decode, 0];
    }
    // Leave BatchImages in graph but unwired from CreateVideo.
  } else {
    const batchInputs = {};
    for (let i = 0; i < activeCount; i++) {
      const stage = STAGES[i];
      const src = i === 0 ? stage.decode : stage.continued;
      batchInputs[`images.image${i}`] = [src, 0];
    }
    workflow["289"] = {
      inputs: batchInputs,
      class_type: "BatchImagesNode",
      _meta: { title: "Batch Animate Stages" },
    };
    if (workflow["245"]?.inputs) {
      workflow["245"].inputs.images = ["289", 0];
    }
  }

  const prompt =
    overrides.prompt !== undefined ? String(overrides.prompt ?? "") : null;
  const negative =
    overrides.negativePrompt !== undefined
      ? String(overrides.negativePrompt ?? "")
      : null;
  const width = overrides.width;
  const height = overrides.height;
  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, 0)
      : undefined;
  const steps =
    overrides.steps !== undefined
      ? toPositiveInt(overrides.steps, 6)
      : undefined;
  const cfg =
    overrides.cfg !== undefined ? toNumber(overrides.cfg, 1) : undefined;
  const dn = overrides.diffusionModelComfyName;

  // Patch all prebaked stages so enabling a later block does not need re-templating.
  for (const stage of STAGES) {
    if (!workflow[stage.wan]) continue;
    if (prompt !== null) {
      if (workflow[stage.appearance]?.inputs) {
        workflow[stage.appearance].inputs.text = prompt;
      }
      if (workflow[stage.posePrompt]?.inputs) {
        workflow[stage.posePrompt].inputs.text = prompt;
      }
    }
    if (negative !== null && workflow[stage.negative]?.inputs) {
      workflow[stage.negative].inputs.text = negative;
    }
    const resize = workflow[stage.poseResize];
    if (resize?.inputs) {
      if (width !== undefined) {
        resize.inputs["resize_type.width"] = toPositiveInt(
          width,
          resize.inputs["resize_type.width"],
        );
      }
      if (height !== undefined) {
        resize.inputs["resize_type.height"] = toPositiveInt(
          height,
          resize.inputs["resize_type.height"],
        );
      }
    }
    if (seed !== undefined && workflow[stage.sampler]?.inputs) {
      workflow[stage.sampler].inputs.noise_seed = seed;
    }
    if (steps !== undefined && workflow[stage.scheduler]?.inputs) {
      workflow[stage.scheduler].inputs.steps = steps;
    }
    if (cfg !== undefined && workflow[stage.sampler]?.inputs) {
      workflow[stage.sampler].inputs.cfg = cfg;
    }
    if (dn && typeof dn === "string" && workflow[stage.unet]?.inputs) {
      workflow[stage.unet].inputs.unet_name = dn;
    }
  }

  return workflow;
}

module.exports = WanAnimate2Workflow;
module.exports.stagesFor = stagesFor;
module.exports.STAGES = STAGES;
