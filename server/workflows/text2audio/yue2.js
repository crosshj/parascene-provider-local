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

/** ComfyUI-native AR LoRA for YuE2-3B instrumental cot=full. CLIP slot only. */
const INSTRUMENTAL_LORA = "ar_lora_inst_v3abc_comfyui.safetensors";
const INSTRUMENTAL_LORA_NODE = "33:40";
const BARE_INSTRUMENTAL_PLAN = "[instrumental]";

function lyricLines(lyrics) {
  return String(lyrics ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** True when every non-empty line is a single [tag], with no sung text. */
function isTagOnlyLyrics(lyrics) {
  const lines = lyricLines(lyrics);
  return lines.length > 0 && lines.every((line) => /^\[[^\]]+\]$/.test(line));
}

/**
 * Blank lyrics, or a section plan of bracket tags only, runs the instrumental LoRA.
 * Sung lines stay on the base checkpoint CLIP path.
 */
function useInstrumentalLora(lyrics) {
  return String(lyrics ?? "").trim() === "" || isTagOnlyLyrics(lyrics);
}

function enableInstrumentalLora(workflow) {
  workflow[INSTRUMENTAL_LORA_NODE] = {
    inputs: {
      lora_name: INSTRUMENTAL_LORA,
      strength_model: 0,
      strength_clip: 1,
      model: ["33:15", 0],
      clip: ["33:15", 1],
    },
    class_type: "LoraLoader",
    _meta: {
      title: "Load LoRA (Instrumental AR)",
    },
  };
  for (const nodeId of ["33:24", "33:25"]) {
    if (workflow[nodeId]?.inputs) {
      workflow[nodeId].inputs.clip = [INSTRUMENTAL_LORA_NODE, 1];
    }
  }
}

/**
 * YuE2 text-to-music.
 *
 * Overrides: prompt (style), lyrics, seed, abc.
 * Duration is not user-settable; max_duration stays at the graph cap.
 * A non-empty abc selects the switch's false branch (user score) and skips
 * YuE2GenerateABC. Blank or omitted abc leaves planning on.
 * Blank or tag-only lyrics insert the instrumental AR LoRA on the CLIP path
 * and, when lyrics are blank, write the bare [instrumental] plan.
 */
function Yue2Text2AudioWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const lyrics =
    overrides.lyrics !== undefined ? String(overrides.lyrics ?? "") : "";
  const instrumental = useInstrumentalLora(lyrics);

  if (overrides.prompt !== undefined && workflow["33:36"]?.inputs) {
    workflow["33:36"].inputs.value = String(overrides.prompt ?? "");
  }
  if (workflow["33:37"]?.inputs) {
    workflow["33:37"].inputs.value =
      instrumental && lyrics.trim() === "" ? BARE_INSTRUMENTAL_PLAN : lyrics;
  }
  const abc = String(overrides.abc ?? "").trim();
  if (abc && workflow["33:32"]?.inputs && workflow["33:31"]?.inputs) {
    workflow["33:32"].inputs.value = abc;
    workflow["33:31"].inputs.value = false;
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
  if (instrumental) enableInstrumentalLora(workflow);

  return workflow;
}

module.exports = Yue2Text2AudioWorkflow;
module.exports.useInstrumentalLora = useInstrumentalLora;
module.exports.INSTRUMENTAL_LORA = INSTRUMENTAL_LORA;
