"use strict";

const { sanitizePromptForComfyApi } = require("./_api-sanitize.js");
const { ensureConsoleLog } = require("./_console-log.js");
const minimaxH3R2v = require("./reference2video/minimax_h3_r2v");

const WORKFLOWS = {
  // Text-to-image workflows
  "text2image-flux-checkpoint": require("./text2image/flux-checkpoint.js"),
  "text2image-flux-diffusion": require("./text2image/flux-diffusion.js"),
  "text2image-sd15-checkpoint": require("./text2image/sd15-checkpoint.js"),
  "text2image-pony-checkpoint": require("./text2image/pony-checkpoint.js"),
  "text2image-qwen-diffusion": require("./text2image/qwen-diffusion.js"),
  "text2image-qwen-checkpoint": require("./text2image/qwen-checkpoint.js"),
  "text2image-sdxl-checkpoint": require("./text2image/sdxl-checkpoint.js"),
  "text2image-zimage-diffusion": require("./text2image/zimage-diffusion.js"),
  "text2image-krea2_turbo": require("./text2image/krea2_turbo.js"),

  // Text-to-video workflows
  "text2video-wan2_2_t2v": require("./text2video/wan2_2_t2v.js"),
  "text2video-ltx2_3_t2v": require("./text2video/ltx2_3_t2v.js"),
  "text2video-ltx2_5_t2v": require("./text2video/ltx2_5_t2v.js"),
  "text2video-minimax_h3_t2v": require("./text2video/minimax_h3_t2v.js"),
  "text2video-fastvideo_fasth3_t2v": require("./image2video/fastvideo_fasth3_i2v.js"),

  // Text-to-audio / audio-to-audio
  "text2audio-yue2": require("./text2audio/yue2.js"),
  "text2audio-minimax_music3": require("./text2audio/minimax_music3.js"),
  // Parked: LTX 2.5 T2A needs ComfyUI-LTXVideo audio-only nodes
  // (LTXVAudioOnlyModel, LTXVAudioOnlyEmptyVideoLatent) with no core stand-in.
  // "text2audio-ltx2_5_t2a": require("./text2audio/ltx2_5_t2a.js"),
  "audio2audio-yue2_cover": require("./audio2audio/yue2_cover.js"),

  // Image-to-image workflows (fixed-model presets; weights baked into JSON)
  "image2image-sdxl-checkpoint": require("./image2image/sdxl-checkpoint.js"),
  "image2image-flux-kontext": require("./image2image/flux-kontext.js"),
  "image2image-qwen-edit-4step": require("./image2image/qwen-edit-4step.js"),
  "image2image-qwen-rapid-aio": require("./image2image/qwen-rapid-aio.js"),
  "image2image-omnigen2-edit": require("./image2image/omnigen2-edit.js"),
  "image2image-bernini_r": require("./image2image/bernini_r.js"),
  "image2image-krea2_style_ref": require("./image2image/krea2_style_ref.js"),

  // Image-to-video workflows
  "image2video-wan2_2_14B": require("./image2video/wan2_2_14B.js"),
  "image2video-ltx2_3": require("./image2video/ltx2_3.js"),
  "image2video-wan2_2_14B_flf2v": require("./image2video/wan2_2_14B_flf2v.js"),
  "image2video-ltx2_3_flf2v": require("./image2video/ltx2_3_flf2v.js"),
  "image2video-minimax_h3_i2v": require("./image2video/minimax_h3_i2v.js"),
  "image2video-fastvideo_fasth3_i2v": require("./image2video/fastvideo_fasth3_i2v.js"),
  "image2video-ltx2_5": require("./image2video/ltx2_5.js"),
  "image2video-ltx2_5_flf2v": require("./image2video/ltx2_5_flf2v.js"),
  "image2video-ltx2_3_style_transition": require("./image2video/ltx2_3_style_transition.js"),

  // Audio-to-video workflows
  "audio2video-ltx2_3_ia2v": require("./imageAudio2video/video_ltx2_3_ia2v.js"),
  "audio2video-ltx2_3_id_lora": require("./imageAudio2video/video_ltx2_3_id_lora.js"),
  "audio2video-ltx2_5_ia2v": require("./imageAudio2video/ltx2_5_ia2v.js"),

  // Video-to-video workflows
  "video2video-wan2_2_vace_v2v": require("./video2video/wan2_2_vace_v2v.js"),
  "video2video-wan2_2_vace_motion": require("./video2video/wan2_2_vace_motion.js"),
  "video2video-wan_animate_2": require("./video2video/wan_animate_2.js"),
  "video2video-bernini_r": require("./video2video/bernini_r.js"),
  "video2video-wan_scail_2": require("./video2video/wan_scail_2.js"),
  "video2video-ltx2_3_ic_lora": require("./video2video/ltx2_3_ic_lora.js"),
  "video2video-ltx2_5_ic_lora": require("./video2video/ltx2_5_ic_lora.js"),

  // Reference / omni-ref workflows
  "reference2video-minimax_h3_r2v": minimaxH3R2v,
  "reference2video-minimax_h3_r2v_turbo": minimaxH3R2v.turbo,
  "reference2video-minimax_h3_r2v_pdd": minimaxH3R2v.pdd,
  "reference2video-ltx2_3_ic_lora_ingredients": require("./reference2video/ltx2_3_ic_lora_ingredients.js"),
  "reference2video-ltx2_5_ic_lora_ingredients": require("./reference2video/ltx2_5_ic_lora_ingredients.js"),
};

function buildWorkflowByFamily(input) {
  const id = input.managedWorkflowId;
  if (!id || typeof id !== "string") {
    throw new Error(
      "Managed workflow requires managedWorkflowId on the model entry.",
    );
  }
  const workflow = WORKFLOWS[id];
  if (!workflow) {
    throw new Error(
      `Unknown managed workflow "${id}". Register it in workflows/_index.js.`,
    );
  }
  return ensureConsoleLog(sanitizePromptForComfyApi(workflow(input)), input);
}

function hasWorkflow(entry) {
  const id = entry && entry.managedWorkflowId;
  return Boolean(id && WORKFLOWS[id]);
}

module.exports = {
  buildWorkflowByFamily,
  hasWorkflow,
  WORKFLOWS,
};
