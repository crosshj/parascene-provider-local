// server.js
"use strict";

const PORT = process.env.PORT;
const HOST = process.env.HOST;
if (!PORT || !HOST) {
  console.error("PORT and HOST env are required");
  process.exit(1);
}

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { createApp } = require("./lib.js");
const { handleHealth } = require("./handlers/health.js");
const { handleModels } = require("./handlers/models.js");
const { handleApiGet, handleApiPost } = require("./handlers/api.js");
const { handleGpu } = require("./handlers/gpu.js");
const { ensureWorkerStarted, handleGenerate } = require("./handlers/generate.js");
const { ensureManagedComfyReady } = require("./generator/comfy/index.js");
const { handleOutputImage } = require("./handlers/outputs.js");
const { handlePublic } = require("./handlers/public.js");



function getCacheVersion() {
  const cwd = process.cwd();
  const metaPath = path.join(cwd, "release-metadata.json");
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta.releaseId) return meta.releaseId;
      if (meta.resolvedSha) return meta.resolvedSha.slice(0, 12);
    }
  } catch (_) {
    /* ignore */
  }
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      cwd: path.join(__dirname, ".."),
    }).trim();
  } catch (_) {
    /* ignore */
  }
  const pkg = require(path.join(__dirname, "..", "package.json"));
  return pkg.version || String(Date.now());
}

const ctx = {
  outputDir: process.env.OUTPUT_DIR || null,
  publicDir: path.join(__dirname, "public"),
  cacheVersion: getCacheVersion(),
};

const app = createApp(ctx);

// Provider API surface that follows the `/api` pattern.
app.get("/api", handleApiGet);
app.post("/api", handleApiPost);

app.get("/api/health", handleHealth);
app.get("/api/gpu", handleGpu);
app.get("/api/models", handleModels);
app.post("/api/generate", handleGenerate);
app.get("/outputs/*", handleOutputImage);
app.get("*", handlePublic);

app.listen(Number(PORT), HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}/`);
  if (!ctx.outputDir) {
    console.warn("[generator] warm start skipped: OUTPUT_DIR not configured");
    return;
  }
  try {
    const worker = ensureWorkerStarted(ctx.outputDir);
    console.log(
      `[generator] warm start ready pid=${worker.pid ?? "unknown"}`,
    );
  } catch (err) {
    console.error(`[generator] warm start failed: ${err.message}`);
  }
  ensureManagedComfyReady()
    .then((status) => {
      console.log(
        `[comfy] warm start ready managed=${status.managed} pid=${status.pid ?? "n/a"}`,
      );
    })
    .catch((err) => {
      console.warn(`[comfy] warm start skipped: ${err.message}`);
    });
});
