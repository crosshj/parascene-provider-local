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
  fs.readFileSync(path.join(__dirname, "ltx2_5_ia2v.json"), "utf8"),
);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cloneBaseWorkflow() {
  return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
}

/**
 * LTX 2.5 audio-to-video (LOCAL_ONLY API export).
 */
function Ltx25Audio2VideoWorkflow(overrides = {}) {
  const workflow = cloneBaseWorkflow();
  const switchToTextToVideo = overrides.useStartingImage === true;
  const userPrompt =
    overrides.prompt !== undefined && overrides.prompt !== null
      ? String(overrides.prompt)
      : workflow["5508"]?.inputs?.value ?? "";

  if (workflow["5014:5506"]?.inputs) {
    workflow["5014:5506"].inputs.value = !switchToTextToVideo;
  }

  const promptMagic = switchToTextToVideo
    ? false
    : resolvePromptMagic(
        overrides.promptMagic ?? overrides.prompt_magic,
        true,
      );

  if (promptMagic && workflow["5014:5546"]?.inputs) {
    workflow["5014:5546"].inputs.prompt = formatLtx2TextGeneratePrompt(
      userPrompt,
      { mode: "ia2v" },
    );
    workflow["5014:5546"].inputs.use_default_template = false;
    workflow["5014:5546"].inputs.max_length = TEXT_GENERATE_MAX_LENGTH;
  }

  if (overrides.inputImageFilename && workflow["2004"]?.inputs) {
    workflow["2004"].inputs.image = String(overrides.inputImageFilename);
  }
  if (overrides.inputAudioFilename && workflow["5600"]?.inputs) {
    workflow["5600"].inputs.audio = String(overrides.inputAudioFilename);
    delete workflow["5600"].inputs.audioUI;
  }
  if (workflow["5508"]?.inputs) {
    workflow["5508"].inputs.value = userPrompt;
  }
  if (workflow["5509"]?.inputs && overrides.negativePrompt !== undefined) {
    workflow["5509"].inputs.value = String(overrides.negativePrompt ?? "");
  }

  const seed =
    overrides.seed !== undefined
      ? toPositiveInt(overrides.seed, workflow["5516:4832"]?.inputs?.noise_seed)
      : undefined;
  if (seed !== undefined && workflow["5516:4832"]?.inputs) {
    workflow["5516:4832"].inputs.noise_seed = seed;
  }
  if (seed !== undefined && workflow["5517:4967"]?.inputs) {
    workflow["5517:4967"].inputs.noise_seed = seed + 1;
  }

  applyLtxDuration(workflow, overrides, {
    durationNodeId: "5512",
    durationNodeIds: ["5014:5507"],
    fpsNodeId: "5511",
    lengthTargets: [{ id: "5014:4988", field: "value" }],
  });

  if (overrides.diffusionModelComfyName && workflow["5575:5569"]?.inputs) {
    workflow["5575:5569"].inputs.unet_name = String(
      overrides.diffusionModelComfyName,
    );
  }

  return workflow;
}

module.exports = Ltx25Audio2VideoWorkflow;
