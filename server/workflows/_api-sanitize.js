"use strict";

/**
 * Make a /prompt API graph match what Comfy's UI would send after loading it.
 *
 * Two YuE-specific (and LTX T2A-adjacent) gaps:
 *   1. SaveAudioAdvanced's `format` is a DynamicCombo. The UI fills nested
 *      `format.quality` when you pick mp3/opus; a bare `"format": "mp3"`
 *      is what the converter emits, and execute() then sees a string instead
 *      of `{format, quality}` — the save node errors and history has no file.
 *   2. PreviewAny is an output/display node. Desktop flattening can leave it
 *      in the data path (ABC → PreviewAny → GenerateMusic). The UI still
 *      runs because it re-serializes widgets; the API path can finish with
 *      only text previews and no SaveAudio output.
 */

const DISPLAY_PASSTHROUGH_TYPES = new Set(["PreviewAny"]);

function isLinkRef(value) {
  return Array.isArray(value) && value.length >= 2 && value[0] != null;
}

function resolveLinkSource(workflow, ref) {
  if (!isLinkRef(ref)) return ref;
  const seen = new Set();
  let nodeId = String(ref[0]);
  let slot = ref[1];
  while (DISPLAY_PASSTHROUGH_TYPES.has(workflow[nodeId]?.class_type)) {
    if (seen.has(nodeId)) break;
    seen.add(nodeId);
    const source = workflow[nodeId]?.inputs?.source;
    if (!isLinkRef(source)) break;
    nodeId = String(source[0]);
    slot = source[1];
  }
  return [nodeId, slot];
}

function ensureSaveAudioAdvancedFormat(node) {
  if (!node || node.class_type !== "SaveAudioAdvanced" || !node.inputs) {
    return;
  }
  const format = node.inputs.format;
  if (typeof format !== "string" || format === "flac") return;
  if (node.inputs["format.quality"] != null) return;
  node.inputs["format.quality"] =
    node.inputs.quality || (format === "opus" ? "128k" : "V0");
}

function bypassDisplayPassthroughs(workflow, node) {
  if (!node?.inputs) return;
  // Keep PreviewAny itself pointed at the real source so the UI preview still
  // runs; only rewrite consumers that treat it as a data node.
  if (DISPLAY_PASSTHROUGH_TYPES.has(node.class_type)) return;
  for (const [key, value] of Object.entries(node.inputs)) {
    if (!isLinkRef(value)) continue;
    const resolved = resolveLinkSource(workflow, value);
    if (resolved[0] !== value[0] || resolved[1] !== value[1]) {
      node.inputs[key] = resolved;
    }
  }
}

function sanitizePromptForComfyApi(workflow) {
  if (!workflow || typeof workflow !== "object") return workflow;
  for (const node of Object.values(workflow)) {
    ensureSaveAudioAdvancedFormat(node);
    bypassDisplayPassthroughs(workflow, node);
  }
  return workflow;
}

module.exports = {
  sanitizePromptForComfyApi,
};
