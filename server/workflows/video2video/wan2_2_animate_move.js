"use strict";

const path = require("path");
const fs = require("fs");
const {
  DEFAULT_FPS,
  durationSecondsToAnimateFrames,
  stagesFor,
} = require("../_wan-animate-duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "wan2_2_animate_move.json"), "utf8"),
);

/** Stage prefixes: 0=base (10x), 1..3=extends (11x/12x/13x). */
const STAGE_SPECS = [
  {
    wan: "100",
    sampler: "101",
    createVideo: "106",
    nodes: ["100", "101", "102", "103", "104", "106"],
  },
  {
    wan: "110",
    sampler: "111",
    createVideo: "116",
    nodes: ["110", "111", "112", "113", "114", "115", "116"],
  },
  {
    wan: "120",
    sampler: "121",
    createVideo: "126",
    nodes: ["120", "121", "122", "123", "124", "125", "126"],
  },
  {
    wan: "130",
    sampler: "131",
    createVideo: "136",
    nodes: ["130", "131", "132", "133", "134", "135", "136"],
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

function setDim(node, key, value) {
  if (!node?.inputs || value === undefined) return;
  node.inputs[key] = toPositiveInt(value, node.inputs[key]);
}

/**
 * Wan 2.2 Animate Move (pose transfer): reference image + control video.
 *
 * Overrides: prompt, negativePrompt, seed, inputVideoFilename,
 * inputImageFilename, width, height, fps, durationSeconds, length/frames,
 * steps, cfg, diffusionModelComfyName.
 */
function WanAnimateMoveWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputVideoFilename && workflow["10"]?.inputs) {
    workflow["10"].inputs.file = String(overrides.inputVideoFilename);
  }
  if (overrides.inputImageFilename && workflow["12"]?.inputs) {
    workflow["12"].inputs.image = String(overrides.inputImageFilename);
  }

  if (workflow["71"]?.inputs && overrides.prompt !== undefined) {
    workflow["71"].inputs.text = String(overrides.prompt ?? "");
  }
  if (workflow["72"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["72"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  const width = overrides.width;
  const height = overrides.height;
  for (const id of ["90", "91", "100", "110", "120", "130"]) {
    const node = workflow[id];
    if (!node?.inputs) continue;
    if (id === "91") {
      setDim(node, "image_gen_width", width);
      setDim(node, "image_gen_height", height);
    } else {
      setDim(node, "width", width);
      setDim(node, "height", height);
    }
  }

  const fps =
    overrides.fps !== undefined
      ? toNumber(overrides.fps, DEFAULT_FPS)
      : DEFAULT_FPS;

  const explicitLength =
    overrides.length ?? overrides.framesNumber ?? overrides.frames;
  let targetFrames;
  if (explicitLength !== undefined) {
    targetFrames = toPositiveInt(explicitLength, 77);
  } else if (overrides.durationSeconds !== undefined) {
    targetFrames = durationSecondsToAnimateFrames(
      overrides.durationSeconds,
      fps,
    );
  } else {
    targetFrames = 77;
  }

  const plan = stagesFor(targetFrames);
  const stageCount = plan.stages.length;

  for (let i = 0; i < STAGE_SPECS.length; i++) {
    const spec = STAGE_SPECS[i];
    if (i >= stageCount) {
      for (const id of spec.nodes) delete workflow[id];
      continue;
    }
    const wan = workflow[spec.wan];
    if (wan?.inputs) {
      wan.inputs.length = plan.stages[i].length;
    }
    const cv = workflow[spec.createVideo];
    if (cv?.inputs) cv.inputs.fps = fps;
  }

  const last = STAGE_SPECS[stageCount - 1];
  if (workflow["200"]?.inputs && last) {
    workflow["200"].inputs.video = [last.createVideo, 0];
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, 0)
      : undefined;
  if (seed !== undefined) {
    for (const spec of STAGE_SPECS.slice(0, stageCount)) {
      if (workflow[spec.sampler]?.inputs) {
        workflow[spec.sampler].inputs.seed = seed;
      }
    }
  }

  if (overrides.steps !== undefined) {
    const steps = toPositiveInt(overrides.steps, 6);
    for (const spec of STAGE_SPECS.slice(0, stageCount)) {
      if (workflow[spec.sampler]?.inputs) {
        workflow[spec.sampler].inputs.steps = steps;
      }
    }
  }

  if (overrides.cfg !== undefined) {
    const cfg = toNumber(overrides.cfg, 1);
    for (const spec of STAGE_SPECS.slice(0, stageCount)) {
      if (workflow[spec.sampler]?.inputs) {
        workflow[spec.sampler].inputs.cfg = cfg;
      }
    }
  }

  const dn = overrides.diffusionModelComfyName;
  if (dn && typeof dn === "string" && workflow["60"]?.inputs) {
    workflow["60"].inputs.unet_name = dn;
  }

  return workflow;
}

module.exports = WanAnimateMoveWorkflow;
module.exports.STAGE_SPECS = STAGE_SPECS;
module.exports.stagesFor = stagesFor;
