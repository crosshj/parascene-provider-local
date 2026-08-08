"use strict";

const path = require("path");
const { sendJson } = require("../lib/http.js");
const { getComfyInputDir } = require("../lib/comfy-paths.js");
const {
  writeStagedBuffer,
  EXT_BY_KIND,
  MIME_TO_EXT,
} = require("../lib/media-resolve.js");
const fs = require("fs");
const {
  INPUT_TTL_SECONDS,
  expiresAtFromNow,
  touchInputFile,
  expiresAtForInputFile,
} = require("../lib/retention.js");

const UPLOAD_MAX = {
  image: 25 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

function detectKind(mime, filename) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (EXT_BY_KIND.image.has(ext)) return "image";
  if (EXT_BY_KIND.audio.has(ext)) return "audio";
  if (EXT_BY_KIND.video.has(ext)) return "video";
  return null;
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Upload too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(sep);
  while (start !== -1) {
    const next = buffer.indexOf(sep, start + sep.length);
    const sliceEnd = next === -1 ? buffer.length : next;
    let part = buffer.slice(start + sep.length, sliceEnd);
    if (part.slice(0, 2).equals(Buffer.from("\r\n"))) part = part.slice(2);
    if (part.slice(-2).equals(Buffer.from("\r\n"))) part = part.slice(0, -2);
    if (part.equals(Buffer.from("--")) || part.slice(0, 2).equals(Buffer.from("--"))) {
      break;
    }
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      start = next;
      continue;
    }
    const headerText = part.slice(0, headerEnd).toString("utf8");
    let body = part.slice(headerEnd + 4);
    if (body.slice(-2).equals(Buffer.from("\r\n"))) body = body.slice(0, -2);
    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
    parts.push({
      name: nameMatch ? nameMatch[1] : "",
      filename: fileMatch ? fileMatch[1] : null,
      contentType: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
      body,
    });
    start = next;
  }
  return parts;
}

/**
 * POST /api/files — multipart upload of a single media file.
 * Form field name: content (or file). Returns id/url/filename/expires_at.
 */
async function handleFilesPost(req, res) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!contentType.includes("multipart/form-data") || !boundaryMatch) {
    return sendJson(res, 400, {
      error: "Expected multipart/form-data with a file field.",
    });
  }
  const boundary = (boundaryMatch[1] || boundaryMatch[2] || "").trim();
  let raw;
  try {
    raw = await readRawBody(req, UPLOAD_MAX.video + 1024 * 1024);
  } catch (err) {
    return sendJson(res, 413, { error: err.message || "Upload too large." });
  }

  const parts = parseMultipart(raw, boundary);
  const filePart =
    parts.find((p) => p.filename) ||
    parts.find((p) => p.name === "content" || p.name === "file");
  if (!filePart || !filePart.body?.length) {
    return sendJson(res, 400, { error: "Missing file content." });
  }

  const kind = detectKind(filePart.contentType, filePart.filename);
  if (!kind) {
    return sendJson(res, 400, {
      error: "Unsupported media type (image, audio, or video required).",
    });
  }
  const maxBytes = UPLOAD_MAX[kind];
  if (filePart.body.length > maxBytes) {
    return sendJson(res, 413, {
      error: `${kind} upload exceeds ${maxBytes} bytes.`,
    });
  }

  const mime = filePart.contentType || "application/octet-stream";
  let ext =
    MIME_TO_EXT[mime.toLowerCase()] ||
    path.extname(String(filePart.filename || "")).toLowerCase() ||
    (kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : ".png");
  if (!EXT_BY_KIND[kind].has(ext)) {
    ext = kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : ".png";
  }

  const staged = writeStagedBuffer(filePart.body, {
    kind,
    ext,
    prefix: "upload",
  });

  return sendJson(res, 201, {
    id: staged.filename,
    filename: staged.filename,
    url: `/api/files/${encodeURIComponent(staged.filename)}`,
    kind,
    bytes: filePart.body.length,
    expires_at: staged.expires_at || expiresAtFromNow(INPUT_TTL_SECONDS),
    comfy_input_dir: getComfyInputDir(),
  });
}

/**
 * GET /api/files/:filename — verify staged file exists, reset TTL, return metadata.
 */
function handleFilesGet(req, res, ctx) {
  const rawPath = String(ctx?.path || req.url || "");
  const base = rawPath.split("?")[0];
  const prefix = "/api/files/";
  if (!base.startsWith(prefix)) {
    return sendJson(res, 404, { error: "Not found" });
  }
  const filename = path.basename(decodeURIComponent(base.slice(prefix.length)));
  if (!filename || filename === "." || filename === "..") {
    return sendJson(res, 400, { error: "Invalid filename." });
  }
  const inputDir = getComfyInputDir();
  const full = path.join(inputDir, filename);
  if (!fs.existsSync(full)) {
    return sendJson(res, 404, {
      error: "File not found or expired.",
      filename,
    });
  }
  const touched = touchInputFile(inputDir, filename) || {
    filename,
    expires_at: expiresAtForInputFile(inputDir, filename),
  };
  let bytes = null;
  try {
    bytes = fs.statSync(full).size;
  } catch {
    // ignore
  }
  const kind = detectKind(null, filename);
  return sendJson(res, 200, {
    id: filename,
    filename,
    url: `/api/files/${encodeURIComponent(filename)}`,
    kind,
    bytes,
    expires_at: touched.expires_at || expiresAtFromNow(INPUT_TTL_SECONDS),
  });
}

module.exports = {
  handleFilesPost,
  handleFilesGet,
  UPLOAD_MAX,
};
