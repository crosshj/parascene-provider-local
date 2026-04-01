"use strict";

const PORT = process.env.PORT;
const HOST = process.env.HOST;
if (!PORT || !HOST) {
  console.error("PORT and HOST env are required");
  process.exit(1);
}

const path = require("path");

const { createApp } = require("./lib/http.js");
const { getCacheVersion } = require("./lib/cache-version.js");
const { ensureManagedComfyReady } = require("./generator/index.js");

//handlers
const { handleHealth } = require("./handlers/health.js");
const { handleModels } = require("./handlers/models.js");
const { handleGpu } = require("./handlers/gpu.js");
const { handleOutputImage } = require("./handlers/outputs.js");
const { handlePublic } = require("./handlers/public.js");
const { handleGenerate } = require("./handlers/generate.js");
const { handleApiGet, handleApiPost } = require("./handlers/api.js");

const ctx = {
  outputDir: process.env.OUTPUT_DIR || null,
  publicDir: path.join(__dirname, "public"),
  cacheVersion: getCacheVersion(__dirname),
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
    console.warn("[comfy] warm start skipped: OUTPUT_DIR not configured");
    return;
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
