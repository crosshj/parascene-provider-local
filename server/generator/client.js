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
        kind: "image",
        filename: String(img.filename),
        subfolder: String(img.subfolder || ""),
        type: String(img.type || "output"),
      };
    }
  }

  throw new Error("Comfy history does not contain generated images.");
}

function tryParseVideoRef(outSlot) {
  if (!outSlot || typeof outSlot !== "object") return null;
  const lists = ["videos", "gifs"];
  for (const key of lists) {
    const arr = outSlot[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const first = arr[0];
    if (first && first.filename) {
      return {
        kind: "video",
        filename: String(first.filename),
        subfolder: String(first.subfolder || ""),
        type: String(first.type || "output"),
      };
    }
  }
  return null;
}

function parseOutputVideo(historyData, promptId) {
  const root = historyData && historyData[promptId];
  if (!root || !root.outputs || typeof root.outputs !== "object") {
    throw new Error("Comfy history response missing outputs.");
  }

  for (const value of Object.values(root.outputs)) {
    const ref = tryParseVideoRef(value);
    if (ref) return ref;
  }

  throw new Error("Comfy history does not contain generated videos.");
}

async function pollHistoryForOutput(promptId, wantsVideo, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await requestJson(`/history/${encodeURIComponent(promptId)}`, {
      method: "GET",
    });
    try {
      if (wantsVideo) {
        return parseOutputVideo(data, promptId);
      }
      return parseOutputImage(data, promptId);
    } catch {
      // Still running or wrong parser pass.
    }
    if (!wantsVideo) {
      try {
        return parseOutputVideo(data, promptId);
      } catch {
        // Fall through — image workflow may not emit video yet.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for Comfy history output.");
}

function defaultExtensionForKind(kind) {
  return kind === "video" ? ".mp4" : ".png";
}

function extensionFromComfyFilename(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext && ext.length > 1) return ext;
  return null;
}

function makeOutputFilename(seed, kind, sourceFilename) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(3).toString("hex");
  const ext =
    extensionFromComfyFilename(sourceFilename) ||
    defaultExtensionForKind(kind);
  const prefix = kind === "video" ? "vid" : "img";
  return `${prefix}-${stamp}-${seed}-${rand}${ext}`;
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

  const wantsVideo =
    input.expectVideo === true ||
    (typeof input.managedWorkflowId === "string" &&
      input.managedWorkflowId.startsWith("image2video"));

  const mediaRef = await pollHistoryForOutput(
    String(promptId),
    wantsVideo,
    600_000,
  );
  const query = new URLSearchParams({
    filename: mediaRef.filename,
    subfolder: mediaRef.subfolder,
    type: mediaRef.type,
  });
  const fileBuffer = await requestBuffer(`/view?${query.toString()}`);

  fs.mkdirSync(outDir, { recursive: true });
  const fileName = makeOutputFilename(
    input.seed,
    mediaRef.kind || (wantsVideo ? "video" : "image"),
    mediaRef.filename,
  );
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, fileBuffer);

  return {
    ok: true,
    file_name: fileName,
    file_path: outPath,
    family: input.family,
    model: input.modelPath,
    seed: input.seed,
    elapsed_ms: Date.now() - started,
    media_kind: mediaRef.kind || (wantsVideo ? "video" : "image"),
  };
}

module.exports = { runComfyGeneration };
