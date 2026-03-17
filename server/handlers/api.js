"use strict";

const fs = require("fs");
const path = require("path");

const { sendJson, readJson } = require("../lib.js");
const { runGenerator, sanitizePromptText } = require("./generate.js");
const { getModels, resolveModel } = require("./models.js");

const TEXT2IMG_CREDITS = 0.2;

// Shared API key for simple bearer auth.
// For now we allow a hardcoded default; in production this should be set via env.
const PARASCENE_API_KEY =
  process.env.PARASCENE_API_KEY || "parascene-local-dev-token";

// In-memory job store: job_id -> { id, method, args, status, result?, error?, created_at, completed_at? }
const jobs = new Map();

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

const ALLOWED_SD15 = new Set([
  "cyberrealistic_v20",
  "deliberate_v11",
  "realisticVisionV60B1_v60B1VAE",
  "dreamShaper_8_pruned",
  "revAnimated_v122",
  "rpg_v5",
  "toonAme_version20",
  "lofi_V2pre",
  "qgo10b_qgo10b",
  "liberty_main",
]);

function handleApiGet(req, res) {
  if (!ensureAuthorized(req, res)) return;

  const now = new Date().toISOString();
  const models = getModels();
  // TODO: re-enable wan/sdxl/qwen families once they are wired up
  // correctly for this provider (sampling params, pipelines, licensing, etc.).
  const filteredModels = models.filter(
    (m) =>
      m.family !== "wan" &&
      m.family !== "sdxl" &&
      m.family !== "qwen" &&
      (m.family !== "sd15" || ALLOWED_SD15.has(m.name)),
  );
  const modelOptions = filteredModels.map((m) => ({
    label: `${m.family}: ${m.name}`,
    value: m.name,
  }));

  const payload = {
    status: "operational",
    last_check_at: now,
    methods: {
      text2img: {
        id: "text2img",
        default: true,
        async: true,
        name: "Text To Image",
        description: "Generate an image from text.",
        intent: "image_generate",
        credits: TEXT2IMG_CREDITS,
        fields: {
          model: {
            label: "Model",
            type: "select",
            required: true,
            options: modelOptions,
          },
          prompt: {
            label: "Prompt",
            type: "text",
            required: true,
          },
        },
      },
    },
  };
  sendJson(res, 200, payload);
}

/**
 * Generate an opaque job_id for the async job pattern.
 * Format: job_<timestamp36>_<random6> e.g. job_m5k2x7_abc12d
 */
function generateJobId() {
  return `job_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Start a text2img job: validate args, enqueue with runGenerator, store job by job_id.
 * Returns the job record (status "pending"); the promise updates it when done.
 */
function startText2ImgJob(jobId, args, outputDir) {
  const prompt = sanitizePromptText(args.prompt);
  if (!prompt) {
    return { error: "Missing or invalid prompt" };
  }
  const modelName = String(args.model || "").trim();
  if (!modelName) {
    return { error: "Missing required field: model" };
  }
  const entry = resolveModel(modelName);
  if (!entry) {
    return { error: `Unknown model: "${modelName}". Check GET /api or GET /api/models.` };
  }

  // Only prompt and model come from the client; everything else is determined by the API.
  const defaults = entry.defaults || {};
  const payload = {
    prompt,
    prompt_2: "",
    negative_prompt: "",
    model: entry.fullPath,
    family: entry.family,
    width: defaults.width ?? 1024,
    height: defaults.height ?? 1024,
    steps: defaults.steps ?? 20,
    cfg: defaults.cfg ?? 7,
    // seed omitted: generator uses random when not provided
  };

  const job = {
    id: jobId,
    method: "text2img",
    args,
    status: "pending",
    created_at: new Date().toISOString(),
    result: null,
    error: null,
    imageWidth: defaults.width ?? 1024,
    imageHeight: defaults.height ?? 1024,
    credits: TEXT2IMG_CREDITS,
  };
  jobs.set(jobId, job);

  runGenerator(payload, outputDir)
    .then((result) => {
      const current = jobs.get(jobId);
      if (!current) return;
      if (result?.ok && result.file_name) {
        current.status = "succeeded";
        current.result = {
          ok: true,
          file_name: result.file_name,
          image_url: `/outputs/${result.file_name}`,
          seed: result.seed,
          family: result.family,
          model: result.model,
          elapsed_ms: result.elapsed_ms,
        };
      } else {
        current.status = "failed";
        current.error = result?.error ?? "Generator did not return an image.";
        current.result = { ok: false, error: current.error };
      }
      current.completed_at = new Date().toISOString();
      jobs.set(jobId, current);
    })
    .catch((err) => {
      const current = jobs.get(jobId);
      if (!current) return;
      current.status = "failed";
      current.error = err.message ?? "Generation failed.";
      current.result = { ok: false, error: current.error };
      current.completed_at = new Date().toISOString();
      jobs.set(jobId, current);
    });

  return job;
}

/**
 * Create a stub job (e.g. echo) for non–text2img methods. Used for testing the poll flow.
 */
function createStubJob({ method, args }) {
  const jobId = generateJobId();
  const job = {
    id: jobId,
    method,
    args,
    status: "pending",
    created_at: new Date().toISOString(),
    result: null,
    error: null,
  };
  jobs.set(jobId, job);
  setTimeout(() => {
    const current = jobs.get(jobId);
    if (!current || current.status !== "pending") return;
    if (current.method === "echo") {
      current.result = { echoed: current.args || {} };
    } else {
      current.result = { message: "Completed", method: current.method };
    }
    current.status = "succeeded";
    current.completed_at = new Date().toISOString();
    jobs.set(jobId, current);
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
    const job = jobs.get(jobId);
    if (!job) {
      return sendJson(res, 404, {
        async: true,
        error: "Job not found",
        job_id: jobId
      });
    }
    if (job.status === "pending") {
      return sendJson(res, 202, {
        async: true,
        status: job.status,
        job_id: job.id
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
    // Succeeded + text2img: return image binary (Content-Type: image/png) and metadata headers.
    if (
      job.method === "text2img" &&
      job.result?.file_name &&
      ctx.outputDir
    ) {
      const filePath = path.join(ctx.outputDir, job.result.file_name);
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
          "X-Credits": String(job.credits ?? TEXT2IMG_CREDITS),
        };
        if (job.result.seed != null) headers["X-Seed"] = String(job.result.seed);
        if (job.result.elapsed_ms != null)
          headers["X-Elapsed-Ms"] = String(job.result.elapsed_ms);
        if (job.result.family != null) headers["X-Family"] = String(job.result.family);
        if (job.result.model != null)
          headers["X-Model"] = String(path.basename(job.result.model));
        res.writeHead(200, headers);
        res.end(data);
      });
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
  if (method === "text2img") {
    if (!ctx.outputDir) {
      return sendJson(res, 503, { error: "OUTPUT_DIR not configured" });
    }
    const id = generateJobId();
    const job = startText2ImgJob(id, args, ctx.outputDir);
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

