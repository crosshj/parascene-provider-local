"use strict";

const WORKFLOW_BY_FAMILY = {
  flux: require("./text2image-flux-checkpoint.js"),
  sd15: require("./text2image-sd15-checkpoint.js"),
};

function buildWorkflowByFamily(input) {
  const family = String(input.family || "").toLowerCase();
  const workflow = WORKFLOW_BY_FAMILY[family];
  if (workflow) return workflow(input);
  throw new Error(`Managed Comfy not supported for family "${family}" yet.`);
}

function isManagedComfyWorkflowSupported(family) {
  const normalized = String(family || "").toLowerCase();
  return Boolean(WORKFLOW_BY_FAMILY[normalized]);
}

module.exports = {
  buildWorkflowByFamily,
  isManagedComfyWorkflowSupported,
};
