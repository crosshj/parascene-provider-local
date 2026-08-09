"use strict";

const path = require("path");
const fs = require("fs");
const {
  BLOCK_FRAMES,
  DEFAULT_FPS,
  durationSecondsToAnimateFrames,
  stagesFor,
} = require("../_wan-animate-duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "wan_animate_2.json"), "utf8"),
);

/** Prefixes for the inbox base (261) and extend (477) subgraphs. */
const STAGE0_PREFIX = "261:";
const STAGE1_PREFIX = "477:";

const STAGE0 = {
  wan: "261:247",
  sampler: "261:19",
  decode: "261:6",
  contextSwitch: "261:258",
  appearance: "261:3",
  posePrompt: "261:222",
  negative: "261:4",
  poseResize: "261:243",
  unet: "261:239",
};

const STAGE1 = {
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
};

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

function deletePrefix(workflow, prefix) {
  for (const id of Object.keys(workflow)) {
    if (id.startsWith(prefix)) delete workflow[id];
  }
}

/**
 * Wan Animate 2 — reference image + driving video (end-to-end, no DWPose).
 *
 * Overrides: prompt, negativePrompt, seed, inputVideoFilename,
 * inputImageFilename, width, height, fps, durationSeconds, length/frames,
 * steps, cfg, diffusionModelComfyName.
 */
function WanAnimate2Workflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputVideoFilename && workflow["240"]?.inputs) {
    workflow["240"].inputs.file = String(overrides.inputVideoFilename);
  }
  if (overrides.inputImageFilename && workflow["189"]?.inputs) {
    workflow["189"].inputs.image = String(overrides.inputImageFilename);
  }

  const prompt =
    overrides.prompt !== undefined ? String(overrides.prompt ?? "") : null;
  const negative =
    overrides.negativePrompt !== undefined
      ? String(overrides.negativePrompt ?? "")
      : null;

  for (const stage of [STAGE0, STAGE1]) {
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
  }

  const width = overrides.width;
  const height = overrides.height;
  for (const stage of [STAGE0, STAGE1]) {
    const resize = workflow[stage.poseResize];
    if (!resize?.inputs) continue;
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
  const stageCount = plan.stages.length;

  // Stage 0 length (+ optional context windows for long single-pass).
  if (workflow[STAGE0.wan]?.inputs) {
    workflow[STAGE0.wan].inputs.length = plan.stages[0].length;
  }
  if (workflow[STAGE0.contextSwitch]?.inputs) {
    workflow[STAGE0.contextSwitch].inputs.switch = Boolean(
      plan.useContextWindows,
    );
  }

  if (stageCount < 2) {
    deletePrefix(workflow, STAGE1_PREFIX);
    delete workflow["289"];
    if (workflow["245"]?.inputs) {
      workflow["245"].inputs.images = [STAGE0.decode, 0];
    }
  } else {
    if (workflow[STAGE1.wan]?.inputs) {
      workflow[STAGE1.wan].inputs.length = plan.stages[1].length;
    }
    if (workflow[STAGE1.contextSwitch]?.inputs) {
      workflow[STAGE1.contextSwitch].inputs.switch = false;
    }
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, 0)
      : undefined;
  if (seed !== undefined) {
    if (workflow[STAGE0.sampler]?.inputs) {
      workflow[STAGE0.sampler].inputs.noise_seed = seed;
    }
    if (workflow[STAGE1.sampler]?.inputs) {
      workflow[STAGE1.sampler].inputs.noise_seed = seed;
    }
  }

  if (overrides.steps !== undefined) {
    const steps = toPositiveInt(overrides.steps, 6);
    for (const id of ["261:18", "477:462"]) {
      if (workflow[id]?.inputs) workflow[id].inputs.steps = steps;
    }
  }

  if (overrides.cfg !== undefined) {
    const cfg = toNumber(overrides.cfg, 1);
    if (workflow[STAGE0.sampler]?.inputs) {
      workflow[STAGE0.sampler].inputs.cfg = cfg;
    }
    if (workflow[STAGE1.sampler]?.inputs) {
      workflow[STAGE1.sampler].inputs.cfg = cfg;
    }
  }

  const dn = overrides.diffusionModelComfyName;
  if (dn && typeof dn === "string") {
    for (const id of [STAGE0.unet, STAGE1.unet]) {
      if (workflow[id]?.inputs) workflow[id].inputs.unet_name = dn;
    }
  }

  return workflow;
}

module.exports = WanAnimate2Workflow;
module.exports.stagesFor = stagesFor;
module.exports.STAGE0 = STAGE0;
module.exports.STAGE1 = STAGE1;
