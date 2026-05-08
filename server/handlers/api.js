"use strict";

const fs = require("fs");
const path = require("path");

const { sendJson, readJson } = require("../lib/http.js");
const { enqueueGenerationJob, getJob } = require("../lib/scheduler.js");
const { buildComfyArgs } = require("../lib/comfy-args.js");
const {
  BASE_PROVIDER_CAPABILITIES,
} = require("../configs/provider-api-config.js");

function resolveMethodCredits(method) {
  const value = BASE_PROVIDER_CAPABILITIES?.methods?.[method]?.credits;
  return typeof value === "number" ? value : 0;
}

function contentTypeForArtifactFilename(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function isVideoArtifactJob(job) {
  if (job.result?.media_kind === "video") return true;
  const ct = contentTypeForArtifactFilename(job.result?.file_name || "");
  return ct.startsWith("video/");
}

// Shared API key for simple bearer auth.
// For now we allow a hardcoded default; in production this should be set via env.
const PARASCENE_API_KEY =
  process.env.PARASCENE_API_KEY || "parascene-local-dev-token";

// In-memory job store for stub (non-text2image) jobs only.
const stubJobs = new Map();

// const DEFAULT_ALLOWED_SD15 = [
//   "cyberrealistic_v20",
//   "deliberate_v11",
//   "realisticVisionV60B1_v60B1VAE",
//   "dreamShaper_8_pruned",
//   "revAnimated_v122",
//   "rpg_v5",
//   "toonAme_version20",
//   "lofi_V2pre",
//   "qgo10b_qgo10b",
//   "liberty_main",
// ];

// // Kept as reference for future provider filtering tweaks.
// const DEFAULT_ALLOWED_SDXL = [
//   "cyberrealisticPony_v130",
//   "dreamshaperXL_turboDpmppSDE",
//   "illustriousXL20_v20",
//   "juggernautXL_v7Rundiffusion",
//   "juggernautXL_v9Rdphoto2Lightning",
//   "ponyRealism_V23",
//   "protovisionXLHighFidelity3D_releaseV660Bakedvae",
//   "realcartoonXL_v6",
//   "realDream_sdxlLightning1",
//   "sd_xl_base_1.0",
//   "sd_xl_turbo_1.0_fp16",
//   "zavychromaxl_v40",
// ];

// function getAllowedSdxlSet() {
//   const raw = process.env.API_ALLOWED_SDXL_MODELS;
//   const names =
//     typeof raw === "string" && raw.trim()
//       ? raw
//           .split(",")
//           .map((s) => s.trim())
//           .filter(Boolean)
//       : DEFAULT_ALLOWED_SDXL;
//   return new Set(names);
// }

// function getAllowedSd15Set() {
//   const raw = process.env.API_ALLOWED_SD15_MODELS;
//   const names =
//     typeof raw === "string" && raw.trim()
//       ? raw
//           .split(",")
//           .map((s) => s.trim())
//           .filter(Boolean)
//       : DEFAULT_ALLOWED_SD15;
//   return new Set(names);
// }

function getBearerToken(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header || typeof header !== "string") return null;
  const parts = header.split(" ");
  if (parts.length !== 2) return null;
  if (parts[0] !== "Bearer") return null;
  return parts[1] || null;
}

function ensureAuthorized(req, res) {
  const token = getBearerToken(req);
  if (!token || token !== PARASCENE_API_KEY) {
    sendJson(res, 401, {
      error: "Unauthorized",
      message: "Missing or invalid bearer token.",
    });
    return false;
  }
  return true;
}

function handleApiGet(req, res) {
  if (!ensureAuthorized(req, res)) return;

  const payload = JSON.parse(JSON.stringify(BASE_PROVIDER_CAPABILITIES));
  payload.status = "operational";
  payload.last_check_at = new Date().toISOString();
  sendJson(res, 200, payload);
}

/**
 * Create a stub job (e.g. echo) for non–text2image methods. Used for testing the poll flow.
 */
function createStubJob({ method, args }) {
  const jobId = `job_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const job = {
    id: jobId,
    method,
    args,
    status: "pending",
    created_at: new Date().toISOString(),
    result: null,
    error: null,
  };
  stubJobs.set(jobId, job);
  setTimeout(() => {
    const current = stubJobs.get(jobId);
    if (!current || current.status !== "pending") return;
    if (current.method === "echo") {
      current.result = { echoed: current.args || {} };
    } else {
      current.result = { message: "Completed", method: current.method };
    }
    current.status = "succeeded";
    current.completed_at = new Date().toISOString();
    stubJobs.set(jobId, current);
  }, 150);
  return job;
}

async function handleApiPost(req, res, ctx = {}) {
  if (!ensureAuthorized(req, res)) return;

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message || "Invalid JSON body." });
  }

  const method = typeof body.method === "string" ? body.method.trim() : "";
  const args = body && typeof body.args === "object" ? body.args : {};

  if (!method) {
    return sendJson(res, 400, { error: "Missing required field: method" });
  }

  // Poll: args.job_id present — return current status or final result.
  const jobId = typeof args.job_id === "string" ? args.job_id.trim() : "";
  if (jobId) {
    const job = getJob(jobId) || stubJobs.get(jobId);
    if (!job) {
      return sendJson(res, 404, {
        async: true,
        error: "Job not found",
        job_id: jobId,
      });
    }
    if (job.status === "pending" || job.status === "running") {
      return sendJson(res, 202, {
        async: true,
        status: job.status,
        job_id: job.id,
      });
    }
    if (job.status === "failed") {
      return sendJson(res, 200, {
        async: true,
        status: job.status,
        job_id: job.id,
        result: job.result,
      });
    }
    // Succeeded: stream artifact (infer video vs image so method/registry stays consistent).
    if (job.result?.file_name && ctx.outputDir) {
      const filePath = path.join(ctx.outputDir, job.result.file_name);
      if (isVideoArtifactJob(job)) {
        return fs.readFile(filePath, (err, data) => {
          if (err) {
            return sendJson(res, 500, {
              async: true,
              error: "Video file missing",
              job_id: job.id,
            });
          }
          const ct = contentTypeForArtifactFilename(job.result.file_name);
          const headers = {
            "Content-Type": ct,
            "Content-Length": String(data.length),
            "Cache-Control": "no-cache",
            "X-Credits": String(job.credits ?? resolveMethodCredits(job.method)),
          };
          res.writeHead(200, headers);
          res.end(data);
        });
      }
      if (job.method === "text2image" || job.method === "image2image") {
        return fs.readFile(filePath, (err, data) => {
          if (err) {
            return sendJson(res, 500, {
              async: true,
              error: "Image file missing",
              job_id: job.id,
            });
          }
          const headers = {
            "Content-Type": "image/png",
            "Content-Length": String(data.length),
            "Cache-Control": "no-cache",
            "X-Image-Color": "#000000",
            "X-Image-Width": String(job.imageWidth ?? job.result.width ?? ""),
            "X-Image-Height": String(job.imageHeight ?? job.result.height ?? ""),
            "X-Credits": String(job.credits ?? resolveMethodCredits(job.method)),
          };
          if (job.result.seed != null)
            headers["X-Seed"] = String(job.result.seed);
          if (job.result.elapsed_ms != null)
            headers["X-Elapsed-Ms"] = String(job.result.elapsed_ms);
          if (job.result.family != null)
            headers["X-Family"] = String(job.result.family);
          if (job.result.model != null)
            headers["X-Model"] = String(path.basename(job.result.model));
          res.writeHead(200, headers);
          res.end(data);
        });
      }
    }
    // Fallback: succeeded but not image (e.g. stub method) — return JSON.
    return sendJson(res, 200, {
      async: true,
      status: job.status,
      job_id: job.id,
      result: job.result,
    });
  }

  // Start: no args.job_id — create job and return 202 with job_id.
  if (
    method === "text2image" ||
    method === "image2image" ||
    method === "image2video"
  ) {
    if (!ctx.outputDir) {
      return sendJson(res, 503, { error: "OUTPUT_DIR not configured" });
    }
    let comfyArgs;
    try {
      // Merge top-level method into args so buildComfyArgs can determine the workflow
      comfyArgs = await buildComfyArgs({ ...args, method }, ctx.outputDir);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const job = enqueueGenerationJob(comfyArgs, ctx.outputDir);
    if (job.error) {
      return sendJson(res, 400, { error: job.error });
    }
    return sendJson(res, 202, {
      async: true,
      status: job.status,
      job_id: job.id,
    });
  }

  const job = createStubJob({ method, args });
  return sendJson(res, 202, {
    async: true,
    status: job.status,
    job_id: job.id,
  });
}

module.exports = {
  handleApiGet,
  handleApiPost,
};
