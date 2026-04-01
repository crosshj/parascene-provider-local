"use strict";

const { sendJson } = require("../lib/http.js");
const { getModels } = require("./models.js");
const { isManagedComfyWorkflowSupported } = require("../workflows/_index.js");
const { getManagedComfyStatus } = require("../generator/index.js");
const { getSummary: getJobSummary } = require("../lib/scheduler.js");

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
      // Same contract as the old Python worker slot: service + app-status read `worker`.
      const worker = {
        running: comfy.running === true,
        pid: comfy.pid != null ? comfy.pid : null,
      };
      const outputDirAbs = ctx.outputDir ?? null;
      const publicDirAbs = ctx.publicDir ?? null;
      const payloadBase = {
        models: getModels().filter((m) => isManagedComfyWorkflowSupported(m))
          .length,
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
