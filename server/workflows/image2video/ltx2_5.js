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
  fs.readFileSync(path.join(__dirname, "ltx2_5.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.5 image-to-video (template ltx2_5.json).
 */
function Ltx25Image2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const userPrompt =
    overrides.prompt !== undefined && overrides.prompt !== null
      ? String(overrides.prompt)
      : workflow["398:376"]?.inputs?.value ?? "";
  const promptMagic = resolvePromptMagic(
    overrides.promptMagic ?? overrides.prompt_magic,
    true,
  );

  if (overrides.inputImageFilename && workflow["395"]?.inputs) {
    workflow["395"].inputs.image = String(overrides.inputImageFilename);
  }
  if (workflow["398:376"]?.inputs) {
    workflow["398:376"].inputs.value = userPrompt;
  }
  if (workflow["398:383"]?.inputs) {
    workflow["398:383"].inputs.value = promptMagic;
  }
  if (promptMagic && workflow["398:380"]?.inputs) {
    workflow["398:380"].inputs.prompt = formatLtx2TextGeneratePrompt(
      userPrompt,
      { mode: "i2v" },
    );
    workflow["398:380"].inputs.use_default_template = false;
    workflow["398:380"].inputs.max_length = TEXT_GENERATE_MAX_LENGTH;
  }
  if (workflow["398:373"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["398:373"].inputs.text = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["398:338"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["398:338"]?.inputs) {
    workflow["398:338"].inputs.noise_seed = seed;
  }
  if (seed !== undefined && workflow["398:339"]?.inputs) {
    workflow["398:339"].inputs.noise_seed = seed + 1;
  }

  if (overrides.width !== undefined && workflow["398:372"]?.inputs) {
    workflow["398:372"].inputs.value = toPositiveInt(
      overrides.width,
      workflow["398:372"].inputs.value,
    );
  }
  if (overrides.height !== undefined && workflow["398:360"]?.inputs) {
    workflow["398:360"].inputs.value = toPositiveInt(
      overrides.height,
      workflow["398:360"].inputs.value,
    );
  }

  applyLtxDuration(workflow, overrides, {
    durationNodeId: "398:362",
    fpsNodeId: "398:361",
    lengthTargets: [
      { id: "398:356", field: "length" },
      { id: "398:366", field: "frames_number" },
    ],
  });

  if (overrides.diffusionModelComfyName && workflow["398:384"]?.inputs) {
    workflow["398:384"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = Ltx25Image2VideoWorkflow;
