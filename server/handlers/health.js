"use strict";

const path = require("path");

const { sendJson } = require("../lib.js");
const { getModels } = require("./models.js");
const { getWorkerStatus } = require("./generate.js");
const { getSummary: getJobSummary } = require("../jobs/scheduler.js");

function makeRelativeToService(p) {
  if (!p) return null;
  const serviceDir = path.join(process.cwd(), "service");
  try {
    const rel = path.relative(serviceDir, p);
    if (!rel || rel === "") return ".";
    // If outside /service, keep absolute to avoid "..".
    if (rel.startsWith("..")) return p;
    return rel;
  } catch {
    return p;
  }
}

function handleHealth(_req, res, ctx) {
  const worker = getWorkerStatus();
  const outputDirAbs = ctx.outputDir ?? null;
  const publicDirAbs = ctx.publicDir ?? null;
  const payloadBase = {
    models: getModels().length,
    output_dir: outputDirAbs ? makeRelativeToService(outputDirAbs) : null,
    output_dir_abs: outputDirAbs,
    public_dir: publicDirAbs ? makeRelativeToService(publicDirAbs) : null,
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
