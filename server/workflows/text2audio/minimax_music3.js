"use strict";

const path = require("path");
const fs = require("fs");

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

const MAX_DURATION_SECONDS = 60;

function clampMaxDuration(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_DURATION_SECONDS, Math.max(1, Math.round(n)));
}

/**
 * MiniMax Music 3 text-to-music.
 *
 * Overrides: prompt (caption), lyrics, seed, durationSeconds (max_duration cap).
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
  const durationRaw = overrides.durationSeconds ?? overrides.duration_seconds;
  if (durationRaw !== undefined && durationRaw !== null && durationRaw !== "") {
    node.inputs.max_duration = clampMaxDuration(
      durationRaw,
      node.inputs.max_duration,
    );
  }

  return workflow;
}

module.exports = MinimaxMusic3Workflow;
