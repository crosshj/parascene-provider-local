"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "yue2_cover.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

const MAX_DURATION_SECONDS = 360;

function clampMaxDuration(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_DURATION_SECONDS, Math.max(1, Math.round(n)));
}

/**
 * YuE2 music cover (audio in → audio out).
 *
 * Overrides: prompt (style), lyrics, seed, inputAudioFilename,
 * durationSeconds (max_duration cap).
 */
function Yue2CoverWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.inputAudioFilename && workflow["45"]?.inputs) {
    workflow["45"].inputs.audio = String(overrides.inputAudioFilename);
  }
  if (overrides.prompt !== undefined && workflow["33:25"]?.inputs) {
    workflow["33:25"].inputs.style = String(overrides.prompt ?? "");
  }
  if (workflow["33:25"]?.inputs) {
    workflow["33:25"].inputs.lyrics =
      overrides.lyrics !== undefined ? String(overrides.lyrics ?? "") : "";
  }
  if (overrides.seed !== undefined && workflow["33:34"]?.inputs) {
    workflow["33:34"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["33:34"].inputs.seed,
    );
  }
  const durationRaw = overrides.durationSeconds ?? overrides.duration_seconds;
  if (durationRaw !== undefined && durationRaw !== null && durationRaw !== "") {
    const maxDuration = clampMaxDuration(
      durationRaw,
      workflow["33:25"]?.inputs?.max_duration,
    );
    if (maxDuration !== undefined && workflow["33:25"]?.inputs) {
      workflow["33:25"].inputs.max_duration = maxDuration;
    }
  }

  return workflow;
}

module.exports = Yue2CoverWorkflow;
