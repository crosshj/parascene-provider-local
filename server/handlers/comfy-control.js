"use strict";

const { sendJson } = require("../lib/http.js");
const {
  interruptComfy,
  recycleManagedComfy,
  getManagedComfyStatus,
} = require("../generator/index.js");

/**
 * POST /api/comfy/interrupt
 * Body (optional JSON): { clear_queue?: boolean, recycle?: boolean }
 */
async function handleComfyInterrupt(req, res) {
  let body = {};
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (raw) body = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body." });
  }

  const clearQueue = body.clear_queue !== false;
  const recycle = body.recycle === true;

  try {
    const result = await interruptComfy({ clearQueue });
    let recycled = false;
    if (recycle) {
      await recycleManagedComfy("manual interrupt via /api/comfy/interrupt");
      recycled = true;
    }
    const status = getManagedComfyStatus();
    return sendJson(res, 200, {
      ...result,
      recycled,
      comfy: status,
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: err.message || "Failed to interrupt Comfy.",
    });
  }
}

module.exports = { handleComfyInterrupt };
