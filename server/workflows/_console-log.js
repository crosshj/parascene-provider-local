"use strict";

const CONSOLE_LOG_NODE_ID = "0";
const BORDER = "=========";
const PROMPT_MAX = 160;

const DEFAULT_CONSOLE_LOG_TEXT = `${BORDER}
parascene managed run
(no run details provided)
${BORDER}`;

function truncate(value, max = PROMPT_MAX) {
  const s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function firstDefined(...values) {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    return v;
  }
  return undefined;
}

function formatSize(input) {
  const w = Number(input.width);
  const h = Number(input.height);
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
    return `${Math.floor(w)}x${Math.floor(h)}`;
  }
  const aspect = firstDefined(input.aspectRatio, input.aspect_ratio);
  return aspect ? String(aspect) : "";
}

function collectMediaHints(input) {
  const parts = [];
  const single = [
    ["image", input.inputImageFilename],
    ["end_image", input.endImageFilename],
    ["video", input.inputVideoFilename],
    ["audio", input.inputAudioFilename],
  ];
  for (const [label, value] of single) {
    if (value) parts.push(`${label}=${pathBasename(value)}`);
  }
  const lists = [
    ["images", input.inputImageFilenames],
    ["videos", input.inputVideoFilenames],
    ["audios", input.inputAudioFilenames],
  ];
  for (const [label, arr] of lists) {
    if (!Array.isArray(arr) || !arr.length) continue;
    parts.push(`${label}=${arr.length}`);
  }
  return parts.join(", ");
}

function pathBasename(value) {
  const s = String(value);
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

/**
 * Build a concise Comfy-console banner from managed-run overrides.
 * Prefer API intent fields that Comfy does not already print clearly.
 */
function composeRunConsoleLog(input = {}) {
  const lines = [];
  const workflowId = firstDefined(input.managedWorkflowId);
  const model = firstDefined(
    input.diffusionModelComfyName,
    input.modelFile,
    input.checkpointBasename,
    input.modelPath && pathBasename(input.modelPath),
  );
  const size = formatSize(input);
  const seed = firstDefined(input.seed);
  const duration = firstDefined(
    input.durationSeconds,
    input.duration_seconds,
  );
  const prompt = truncate(firstDefined(input.prompt));
  const lyrics = truncate(firstDefined(input.lyrics), 120);
  const negative = truncate(firstDefined(input.negativePrompt), 80);
  const media = collectMediaHints(input);
  const family = firstDefined(input.family);

  if (workflowId) lines.push(`workflow: ${workflowId}`);
  else if (family) lines.push(`family: ${family}`);
  if (model) lines.push(`model: ${model}`);
  if (size) lines.push(`size: ${size}`);
  if (seed !== undefined && seed !== null && seed !== "") {
    lines.push(`seed: ${seed}`);
  }
  if (duration !== undefined && duration !== null && duration !== "") {
    lines.push(`duration_s: ${duration}`);
  }
  if (media) lines.push(`media: ${media}`);
  if (prompt) lines.push(`prompt: ${prompt}`);
  if (lyrics) lines.push(`lyrics: ${lyrics}`);
  if (negative) lines.push(`negative: ${negative}`);

  if (!lines.length) {
    return DEFAULT_CONSOLE_LOG_TEXT;
  }

  return `${BORDER}\n${lines.join("\n")}\n${BORDER}`;
}

function makeConsoleLogNode(text) {
  return {
    inputs: { text: text || DEFAULT_CONSOLE_LOG_TEXT },
    class_type: "ConsoleLog",
    _meta: { title: "Console Log" },
  };
}

/**
 * Put ConsoleLog first in the workflow object (stable id).
 * Removes any other ConsoleLog nodes to avoid duplicates.
 */
function withConsoleLogFirst(workflow, text) {
  const next = {
    [CONSOLE_LOG_NODE_ID]: makeConsoleLogNode(text),
  };
  for (const [id, node] of Object.entries(workflow || {})) {
    if (id === CONSOLE_LOG_NODE_ID) continue;
    if (node?.class_type === "ConsoleLog") continue;
    next[id] = node;
  }
  return next;
}

/**
 * Ensure the graph has a top-of-file ConsoleLog with composed run text.
 * Returns a new object with ConsoleLog as the first key.
 */
function ensureConsoleLog(workflow, input = {}) {
  if (!workflow || typeof workflow !== "object") return workflow;
  return withConsoleLogFirst(workflow, composeRunConsoleLog(input));
}

module.exports = {
  CONSOLE_LOG_NODE_ID,
  DEFAULT_CONSOLE_LOG_TEXT,
  composeRunConsoleLog,
  ensureConsoleLog,
  withConsoleLogFirst,
  makeConsoleLogNode,
};
