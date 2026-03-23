"use strict";

const { sendJson } = require("../lib.js");
const { getModels } = require("./models.js");
const { getWorkerStatus } = require("./generate.js");
const { getManagedComfyStatus } = require("../generator/comfy/index.js");
const { getSummary: getJobSummary } = require("../jobs/scheduler.js");

function makeRelativeToService(p) {
  if (!p) return null;
  const norm = String(p).replace(/\\/g, "/");
  const lower = norm.toLowerCase();
  const marker = "/service/";
  const idx = lower.lastIndexOf(marker);
  if (idx !== -1) {
    const rel = norm.slice(idx + marker.length);
    return rel || ".";
  }
  const marker2 = "/service";
  const idx2 = lower.lastIndexOf(marker2);
  if (idx2 !== -1) {
    const rel = norm.slice(idx2 + marker2.length).replace(/^\/+/, "");
    return rel || ".";
  }
  return null;
}

function handleHealth(_req, res, ctx) {
  Promise.resolve(getManagedComfyStatus())
    .catch(() => ({
      running: false,
      managed: false,
      pid: null,
      host: null,
      port: null,
      root: null,
    }))
    .then((comfy) => {
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
        comfy,
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
    });
}

module.exports = { handleHealth };
