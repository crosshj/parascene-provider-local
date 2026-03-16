"use strict";

const { sendJson } = require("../lib.js");
const { getModels } = require("./models.js");
const { getWorkerStatus } = require("./generate.js");

function handleHealth(_req, res, ctx) {
  const worker = getWorkerStatus();
  if (!ctx.outputDir) {
    return sendJson(res, 503, {
      ok: false,
      error: "OUTPUT_DIR not configured",
      models: getModels().length,
      public_dir: ctx.publicDir ?? null,
      worker,
    });
  }
  sendJson(res, 200, {
    ok: true,
    models: getModels().length,
    output_dir: ctx.outputDir,
    public_dir: ctx.publicDir ?? null,
    worker,
  });
}

module.exports = { handleHealth };
