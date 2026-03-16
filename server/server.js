// server.js
"use strict";

const PORT = process.env.PORT;
const HOST = process.env.HOST;
if (!PORT || !HOST) {
  console.error("PORT and HOST env are required");
  process.exit(1);
}

const path = require("path");

const { createApp } = require("./lib.js");
const { handleHealth } = require("./handlers/health.js");
const { handleModels } = require("./handlers/models.js");
const { handleGpu } = require("./handlers/gpu.js");
const { handleGenerate } = require("./handlers/generate.js");
const { handleOutputImage } = require("./handlers/outputs.js");
const { handlePublic } = require("./handlers/public.js");



const ctx = {
  outputDir: process.env.OUTPUT_DIR || null,
  publicDir: path.join(__dirname, "public"),
};

const app = createApp(ctx);

app.get("/api/health", handleHealth);
app.get("/api/gpu", handleGpu);
app.get("/api/models", handleModels);
app.post("/api/generate", handleGenerate);
app.get("/outputs/*", handleOutputImage);
app.get("*", handlePublic);

app.listen(Number(PORT), HOST, () =>
  console.log(`Server running at http://${HOST}:${PORT}/`),
);
