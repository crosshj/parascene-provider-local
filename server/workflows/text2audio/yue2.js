"use strict";

const path = require("path");
const fs = require("fs");
const { DEFAULT_MUSIC_MAX_DURATION_SECONDS } = require("../_duration.js");

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

/** Graph cap — not an API field. YuE2 picks length up to this. */
const MAX_DURATION_SECONDS = DEFAULT_MUSIC_MAX_DURATION_SECONDS;

/**
 * YuE2 text-to-music.
 *
 * Overrides: prompt (style), lyrics, seed.
 * Duration is not user-settable; max_duration stays at the graph cap.
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
  if (workflow["33:25"]?.inputs) {
    workflow["33:25"].inputs.max_duration = MAX_DURATION_SECONDS;
  }

  return workflow;
}

module.exports = Yue2Text2AudioWorkflow;
