"use strict";

/**
 * Single source of truth for width/height/steps/cfg shown in app.html and sent
 * to Comfy: values are read from each workflow's JSON template (KSampler "31",
 * latent "27" or "39").
 */

const fs = require("fs");
const path = require("path");

const _cache = Object.create(null);

function _extractFromWorkflowJson(wf) {
  if (!wf || typeof wf !== "object") return null;

  const sampler = wf["31"] && wf["31"].inputs;
  const latent =
    (wf["27"] && wf["27"].inputs) || (wf["39"] && wf["39"].inputs);
  if (sampler && latent) {
    return {
      steps: Number(sampler.steps),
      cfg: Number(sampler.cfg),
      width: Number(latent.width),
      height: Number(latent.height),
    };
  }

  // Wan Fun VACE (and similar): dims live on WanVaceToVideo "40", steps/cfg on
  // KSamplerAdvanced "60". Node "31" is CLIP negative — not a sampler.
  const vace = wf["40"] && wf["40"].inputs;
  const vaceSampler = wf["60"] && wf["60"].inputs;
  if (vace && Number.isFinite(Number(vace.width))) {
    return {
      steps: Number(vaceSampler?.steps) || 20,
      cfg: Number(vaceSampler?.cfg) || 3.5,
      width: Number(vace.width),
      height: Number(vace.height),
    };
  }

  // Wan Animate Move: WanAnimateToVideo "100", KSampler "101".
  const animate = wf["100"] && wf["100"].inputs;
  const animateSampler = wf["101"] && wf["101"].inputs;
  if (
    animate &&
    Number.isFinite(Number(animate.width)) &&
    String(wf["100"]?.class_type || "") === "WanAnimateToVideo"
  ) {
    return {
      steps: Number(animateSampler?.steps) || 6,
      cfg: Number(animateSampler?.cfg) || 1,
      width: Number(animate.width),
      height: Number(animate.height),
    };
  }

  return null;
}

function _loadTemplateDefaults(managedWorkflowId) {
  if (_cache[managedWorkflowId] !== undefined) {
    return _cache[managedWorkflowId];
  }

  const id = String(managedWorkflowId || "");
  const [segment, ...rest] = id.split("-");
  if (!segment || rest.length === 0) {
    _cache[managedWorkflowId] = null;
    return null;
  }
  const jsonName = path.join(segment, rest.join("-") + ".json");

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
