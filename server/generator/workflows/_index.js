"use strict";

const WORKFLOWS = {
  "text2image-flux-checkpoint": require("./text2image-flux-checkpoint.js"),
  "text2image-sd15-checkpoint": require("./text2image-sd15-checkpoint.js"),
};

function buildWorkflowByFamily(input) {
  const id = input.managedWorkflowId;
  if (!id || typeof id !== "string") {
    throw new Error("Managed workflow requires managedWorkflowId on the model entry.");
  }
  const workflow = WORKFLOWS[id];
  if (!workflow) {
    throw new Error(`Unknown managed workflow "${id}". Register it in workflows/_index.js.`);
  }
  return workflow(input);
}

function isManagedComfyWorkflowSupported(entry) {
  const id = entry && entry.managedWorkflowId;
  return Boolean(id && WORKFLOWS[id]);
}

module.exports = {
  buildWorkflowByFamily,
  isManagedComfyWorkflowSupported,
  WORKFLOWS,
};
