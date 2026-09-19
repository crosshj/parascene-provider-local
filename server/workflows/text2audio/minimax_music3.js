"use strict";

const path = require("path");
const fs = require("fs");
const { DEFAULT_MUSIC_MAX_DURATION_SECONDS } = require("../_duration.js");

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "minimax_music3.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/** Graph cap — not an API field. MiniMax Music picks length up to this. */
const MAX_DURATION_SECONDS = DEFAULT_MUSIC_MAX_DURATION_SECONDS;

/**
 * MiniMax Music 3 text-to-music.
 *
 * Overrides: prompt (caption), lyrics, seed.
 * Duration is not user-settable; max_duration stays at the graph cap.
 */
function MinimaxMusic3Workflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const node = workflow["37:13"];
  if (!node?.inputs) return workflow;

  if (overrides.prompt !== undefined) {
    node.inputs.caption = String(overrides.prompt ?? "");
  }
  node.inputs.lyrics =
    overrides.lyrics !== undefined ? String(overrides.lyrics ?? "") : "";

  if (overrides.seed !== undefined && workflow["37:38"]?.inputs) {
    workflow["37:38"].inputs.seed = toPositiveInt(
      overrides.seed,
      workflow["37:38"].inputs.seed,
    );
  }
  node.inputs.max_duration = MAX_DURATION_SECONDS;

  return workflow;
}

module.exports = MinimaxMusic3Workflow;
