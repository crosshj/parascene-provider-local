"use strict";

const { runComfyGeneration } = require("./client.js");
const { isManagedComfyWorkflowSupported } = require("../workflows/_index.js");
const {
  getManagedComfyStatus,
  ensureManagedComfyReady,
} = require("./managed-instance.js");

function getDefaultManagedComfyFamilies() {
  // Hardcoded default: include sdxl, z-image, flux, sd15, and qwen
  return ["flux", "sd15", "z-image", "sdxl", "qwen"];
}

function modelSupportsManagedComfy(entry) {
  return isManagedComfyWorkflowSupported(entry);
}

/**
 * User / policy intent: prefer the managed Comfy path when possible.
 * Does not check whether this specific model has a registered workflow.
 */
function wantsManagedComfyBackend(body, entry) {
  const flags =
    body && typeof body.featureFlags === "object" ? body.featureFlags : null;
  if (flags && flags.forcePythonWorker === true) return false;

  const fam = String(entry.family || "").toLowerCase();

  if (flags && flags.useManagedComfy === true) return true;
  if (flags && flags.useManagedComfy === false) return false;

  return getDefaultManagedComfyFamilies().includes(fam);
}

module.exports = {
  runComfyGeneration,
  isManagedComfyWorkflowSupported,
  getDefaultManagedComfyFamilies,
  modelSupportsManagedComfy,
  wantsManagedComfyBackend,
  ensureManagedComfyReady,
  getManagedComfyStatus,
};
