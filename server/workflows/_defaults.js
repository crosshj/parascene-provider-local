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

  // Wan Animate 2: pose resize defaults + SamplerCustom / BasicScheduler.
  const animate2Resize = wf["261:243"] && wf["261:243"].inputs;
  const animate2Sampler = wf["261:19"] && wf["261:19"].inputs;
  const animate2Sched = wf["261:18"] && wf["261:18"].inputs;
  if (
    animate2Resize &&
    String(wf["261:247"]?.class_type || "") === "WanAnimate2ToVideo"
  ) {
    const width = Number(animate2Resize["resize_type.width"]);
    const height = Number(animate2Resize["resize_type.height"]);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return {
        steps: Number(animate2Sched?.steps) || 6,
        cfg: Number(animate2Sampler?.cfg) || 1,
        width,
        height,
      };
    }
  }

  // Bernini-R image: longer-edge resize default.
  const berniniResize = wf["116"] && wf["116"].inputs;
  if (
    berniniResize &&
    String(wf["76:50"]?.class_type || "") === "BerniniConditioning"
  ) {
    const longer = Number(berniniResize["resize_type.longer_size"]) || 1280;
    return {
      steps: 6,
      cfg: 1,
      width: longer,
      height: longer,
    };
  }

  // Bernini-R video: conditioning literals.
  const berniniVid = wf["298:278"] && wf["298:278"].inputs;
  if (
    berniniVid &&
    String(wf["298:278"]?.class_type || "") === "BerniniConditioning"
  ) {
    return {
      steps: 6,
      cfg: 1,
      width: Number(berniniVid.width) || 480,
      height: Number(berniniVid.height) || 832,
    };
  }

  // SCAIL2: pose resize defaults (640 table when builder patches).
  if (String(wf["213:114"]?.class_type || "") === "WanSCAILToVideo") {
    const w = Number(wf["213:156"]?.inputs?.["resize_type.width"]);
    const h = Number(wf["213:156"]?.inputs?.["resize_type.height"]);
    return {
      steps: 6,
      cfg: 1,
      width: Number.isFinite(w) ? w : 640,
      height: Number.isFinite(h) ? h : 640,
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
