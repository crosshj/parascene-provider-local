"use strict";

const path = require("path");
const fs = require("fs");
const {
  formatLtx2TextGeneratePrompt,
  resolvePromptMagic,
} = require("../_ltx-prompt-magic.js");
const { applyLtxDuration } = require("../_ltx-duration.js");

const TEXT_GENERATE_MAX_LENGTH = 2048;

const WORKFLOW_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ltx2_5_flf2v.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.5 first/last-frame image-to-video.
 */
function Ltx25Flf2vWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const userPrompt =
    overrides.prompt !== undefined && overrides.prompt !== null
      ? String(overrides.prompt)
      : workflow["251:252"]?.inputs?.value ?? "";
  const promptMagic = resolvePromptMagic(
    overrides.promptMagic ?? overrides.prompt_magic,
    true,
  );

  if (overrides.inputImageFilename && workflow["31"]?.inputs) {
    workflow["31"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.endImageFilename && workflow["39"]?.inputs) {
    workflow["39"].inputs.image = String(overrides.endImageFilename);
  }
  if (workflow["251:252"]?.inputs) {
    workflow["251:252"].inputs.value = userPrompt;
  }
  if (workflow["251:250"]?.inputs) {
    workflow["251:250"].inputs.value = promptMagic;
  }
  if (promptMagic && workflow["251:247"]?.inputs) {
    workflow["251:247"].inputs.prompt = formatLtx2TextGeneratePrompt(
      userPrompt,
      { mode: "i2v" },
    );
    workflow["251:247"].inputs.use_default_template = false;
    workflow["251:247"].inputs.max_length = TEXT_GENERATE_MAX_LENGTH;
  }
  if (workflow["251:222"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["251:222"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["251:196"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["251:196"]?.inputs) {
    workflow["251:196"].inputs.noise_seed = seed;
  }

  if (overrides.width !== undefined && workflow["251:215"]?.inputs) {
    workflow["251:215"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["251:215"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["251:216"]?.inputs) {
    workflow["251:216"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["251:216"].inputs.value,
    );
  }

  applyLtxDuration(workflow, overrides, {
    durationNodeId: "251:198",
    fpsNodeId: "251:205",
    lengthTargets: [{ id: "251:201", field: "length" }],
  });

  return workflow;
}

module.exports = Ltx25Flf2vWorkflow;
