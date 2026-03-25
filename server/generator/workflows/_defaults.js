"use strict";

/**
 * Single source of truth for width/height/steps/cfg shown in app.html and sent
 * to Comfy: values are read from each workflow's JSON template (KSampler "31",
 * latent "27" or "39").
 */

const fs = require("fs");
const path = require("path");

const MANAGED_ID_TO_JSON = {
  "text2image-flux-checkpoint": "text2image-flux-checkpoint.json",
  "text2image-flux-diffusion": "text2image-flux-diffusion.json",
  "text2image-sd15-checkpoint": "text2image-sd15-checkpoint.json",
  "text2image-sdxl-checkpoint": "text2image-sdxl-checkpoint.json",
  "text2image-zimage-diffusion": "text2image-zimage-diffusion.json",
  "text2image-qwen-diffusion": "text2image-qwen-diffusion.json",
  "text2image-qwen-checkpoint": "text2image-qwen-checkpoint.json",
};

const _cache = Object.create(null);

function _extractFromWorkflowJson(wf) {
  const sampler = wf && wf["31"] && wf["31"].inputs;
  const latent =
    (wf["27"] && wf["27"].inputs) || (wf["39"] && wf["39"].inputs);
  if (!sampler || !latent) return null;
  return {
    steps: Number(sampler.steps),
    cfg: Number(sampler.cfg),
    width: Number(latent.width),
    height: Number(latent.height),
  };
}

function _loadTemplateDefaults(managedWorkflowId) {
  if (_cache[managedWorkflowId] !== undefined) {
    return _cache[managedWorkflowId];
  }
  const jsonName = MANAGED_ID_TO_JSON[managedWorkflowId];
  if (!jsonName) {
    _cache[managedWorkflowId] = null;
    return null;
  }
  const full = path.join(__dirname, jsonName);
  let wf;
  try {
    wf = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    _cache[managedWorkflowId] = null;
    return null;
  }
  const extracted = _extractFromWorkflowJson(wf);
  _cache[managedWorkflowId] = extracted;
  return extracted;
}

/**
 * Defaults for a registry row: matches the embedded Comfy graph for that workflow id,
 * with optional flux filename tweaks (schnell) that the old UI also applied.
 */
function getModelDefaults(family, fileName, managedWorkflowId) {
  const base = _loadTemplateDefaults(managedWorkflowId);
  const fallback = { steps: 20, cfg: 7.0, width: 512, height: 512 };
  if (!base || !Number.isFinite(base.steps)) {
    return fallback;
  }

  if (
    family === "flux" &&
    (managedWorkflowId === "text2image-flux-checkpoint" ||
      managedWorkflowId === "text2image-flux-diffusion")
  ) {
    const lower = String(fileName || "").toLowerCase();
    if (lower.includes("schnell")) {
      return { ...base, steps: 4, cfg: base.cfg };
    }
  }

  return { ...base };
}

module.exports = {
  getModelDefaults,
  _loadTemplateDefaults,
};
