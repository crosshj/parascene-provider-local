"use strict";

const { runComfyGeneration } = require("./client.js");
const { isManagedComfyWorkflowSupported } = require("../workflows/_index.js");
const {
  getManagedComfyStatus,
  ensureManagedComfyReady,
} = require("./managed-instance.js");

function shouldUseManagedComfy(body) {
  const flags = body && typeof body.featureFlags === "object" ? body.featureFlags : null;
  return Boolean(flags && flags.useManagedComfy === true);
}

module.exports = {
  runComfyGeneration,
  isComfySupportedFamily: isManagedComfyWorkflowSupported,
  shouldUseManagedComfy,
  getManagedComfyStatus,
  ensureManagedComfyReady,
};
