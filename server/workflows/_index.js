"use strict";

const WORKFLOWS = {
  // Text-to-image workflows
  "text2image-flux-checkpoint": require("./text2image/flux-checkpoint.js"),
  "text2image-flux-diffusion": require("./text2image/flux-diffusion.js"),
  "text2image-sd15-checkpoint": require("./text2image/sd15-checkpoint.js"),
  "text2image-pony-checkpoint": require("./text2image/pony-checkpoint.js"),
  "text2image-qwen-diffusion": require("./text2image/qwen-diffusion.js"),
  "text2image-qwen-checkpoint": require("./text2image/qwen-checkpoint.js"),
  "text2image-sdxl-checkpoint": require("./text2image/sdxl-checkpoint.js"),
  "text2image-zimage-diffusion": require("./text2image/zimage-diffusion.js"),

  // Text-to-video workflows

  // Image-to-image workflows
  "image2image-sdxl-checkpoint": require("./image2image/sdxl-checkpoint.js"),

  // Image-to-video workflows
  "image2video-wan2_2_14B": require("./image2video/wan2_2_14B.js"),
  "image2video-ltx2_3": require("./image2video/ltx2_3.js"),
};

function buildWorkflowByFamily(input) {
  const id = input.managedWorkflowId;
  if (!id || typeof id !== "string") {
    throw new Error(
      "Managed workflow requires managedWorkflowId on the model entry.",
    );
  }
  const workflow = WORKFLOWS[id];
  if (!workflow) {
    throw new Error(
      `Unknown managed workflow "${id}". Register it in workflows/_index.js.`,
    );
  }
  return workflow(input);
}

function hasWorkflow(entry) {
  const id = entry && entry.managedWorkflowId;
  return Boolean(id && WORKFLOWS[id]);
}

module.exports = {
  buildWorkflowByFamily,
  hasWorkflow,
  WORKFLOWS,
};
