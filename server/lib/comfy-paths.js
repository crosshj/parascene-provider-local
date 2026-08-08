"use strict";

function getComfyInputDir() {
  return process.env.COMFY_INPUT_DIR || "D:/comfy/ComfyUI/input";
}

// Prefer getComfyInputDir() in new code; keep COMFY_INPUT_DIR as a live getter for compat.
module.exports = {
  get COMFY_INPUT_DIR() {
    return getComfyInputDir();
  },
  getComfyInputDir,
};
