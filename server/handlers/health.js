"use strict";

const path = require("path");

const { sendJson } = require("../lib.js");
const { getModels } = require("./models.js");
const { getWorkerStatus } = require("./generate.js");
const { getSummary: getJobSummary } = require("../jobs/scheduler.js");

function makeRelative(p, base) {
  if (!p) return null;
  const from = base || process.cwd();
  try {
    const rel = path.relative(from, p);
    return rel === "" ? "." : rel;
  } catch {
    return p;
  }
}

function handleHealth(_req, res, ctx) {
  const worker = getWorkerStatus();
  const baseDir = process.cwd();
  const outputDirAbs = ctx.outputDir ?? null;
  const publicDirAbs = ctx.publicDir ?? null;
  const payloadBase = {
    models: getModels().length,
    output_dir: outputDirAbs ? makeRelative(outputDirAbs, baseDir) : null,
    output_dir_abs: outputDirAbs,
    public_dir: publicDirAbs ? makeRelative(publicDirAbs, baseDir) : null,
    public_dir_abs: publicDirAbs,
    worker,
    jobs: getJobSummary(),
  };

  if (!ctx.outputDir) {
    return sendJson(res, 503, {
      ok: false,
      error: "OUTPUT_DIR not configured",
      ...payloadBase,
    });
  }

  sendJson(res, 200, {
    ok: true,
    ...payloadBase,
  });
}

module.exports = { handleHealth };
