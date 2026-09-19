"use strict";

const path = require("path");
const fs = require("fs");
const { DEFAULT_MUSIC_MAX_DURATION_SECONDS } = require("../_duration.js");

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

/** Graph cap — not an API field. Covers may run up to a full song. */
const MAX_DURATION_SECONDS = DEFAULT_MUSIC_MAX_DURATION_SECONDS;

/**
 * YuE2 music cover (audio in → audio out).
 *
 * Overrides: prompt (style), lyrics, seed, inputAudioFilename.
 * Duration is not user-settable; max_duration stays at the graph cap.
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
  if (workflow["33:25"]?.inputs) {
    workflow["33:25"].inputs.max_duration = MAX_DURATION_SECONDS;
  }

  return workflow;
}

module.exports = Yue2CoverWorkflow;
