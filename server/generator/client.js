"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  COMFY_HOST,
  COMFY_PORT,
  ensureManagedComfyReady,
} = require("./managed-instance.js");
const { buildWorkflowByFamily } = require("../workflows/_index.js");

function _url(pathname) {
  return `http://${COMFY_HOST}:${COMFY_PORT}${pathname}`;
}

async function requestJson(pathname, options = {}) {
  const res = await fetch(_url(pathname), options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Comfy API ${pathname} failed with HTTP ${res.status}: ${JSON.stringify(data)}`,
    );
  }
  return data;
}

async function requestBuffer(pathname) {
  const res = await fetch(_url(pathname), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Comfy view request failed with HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function parseOutputImage(historyData, promptId) {
  const root = historyData && historyData[promptId];
  if (!root || !root.outputs || typeof root.outputs !== "object") {
    throw new Error("Comfy history response missing outputs.");
  }

  for (const value of Object.values(root.outputs)) {
    if (!value || !Array.isArray(value.images) || value.images.length === 0)
      continue;
    const img = value.images[0];
    if (img && img.filename) {
      return {
        filename: String(img.filename),
        subfolder: String(img.subfolder || ""),
        type: String(img.type || "output"),
      };
    }
  }

  throw new Error("Comfy history does not contain generated images.");
}

async function pollHistoryForImage(promptId, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await requestJson(`/history/${encodeURIComponent(promptId)}`, {
      method: "GET",
    });
    try {
      return parseOutputImage(data, promptId);
    } catch {
      // Keep polling while generation is still running.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for Comfy history output.");
}

function makeOutputFilename(seed) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(3).toString("hex");
  return `img-${stamp}-${seed}-${rand}.png`;
}

async function runComfyGeneration(input, outDir) {
  const started = Date.now();
  await ensureManagedComfyReady();

  const workflow = buildWorkflowByFamily(input);
  const queued = await requestJson("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });

  const promptId = queued?.prompt_id;
  if (!promptId) {
    throw new Error("Comfy did not return prompt_id.");
  }

  const imageRef = await pollHistoryForImage(String(promptId));
  const query = new URLSearchParams({
    filename: imageRef.filename,
    subfolder: imageRef.subfolder,
    type: imageRef.type,
  });
  const imageBuffer = await requestBuffer(`/view?${query.toString()}`);

  fs.mkdirSync(outDir, { recursive: true });
  const fileName = makeOutputFilename(input.seed);
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, imageBuffer);

  return {
    ok: true,
    file_name: fileName,
    file_path: outPath,
    family: input.family,
    model: input.modelPath,
    seed: input.seed,
    elapsed_ms: Date.now() - started,
  };
}

module.exports = { runComfyGeneration };
