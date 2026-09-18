"use strict";

const path = require("path");
const fs = require("fs");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "yue2.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

const MAX_DURATION_SECONDS = 120;

function clampMaxDuration(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_DURATION_SECONDS, Math.max(1, Math.round(n)));
}

/**
 * YuE2 text-to-music.
 *
 * Overrides: prompt (style), lyrics, seed, durationSeconds (max_duration cap).
 */
function Yue2Text2AudioWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();

  if (overrides.prompt !== undefined && workflow["33:36"]?.inputs) {
    workflow["33:36"].inputs.value = String(overrides.prompt ?? "");
  }
  if (workflow["33:37"]?.inputs) {
    workflow["33:37"].inputs.value =
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

module.exports = Yue2Text2AudioWorkflow;
