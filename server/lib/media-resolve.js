"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getComfyInputDir } = require("./comfy-paths.js");
const {
  INPUT_TTL_SECONDS,
  expiresAtFromNow,
  getInputLastUsedUnix,
  touchInputFile,
} = require("./retention.js");

const DATA_URI_MAX_BYTES = 256 * 1024;
const FETCH_MAX_BYTES = {
  image: 25 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

const EXT_BY_KIND = {
  image: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]),
  audio: new Set([".mp3", ".wav", ".flac", ".ogg", ".m4a", ".webm"]),
  video: new Set([".mp4", ".webm", ".mov", ".mkv", ".avi", ".gif"]),
};

const MIME_TO_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/webm": ".webm",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

function defaultExt(kind) {
  if (kind === "audio") return ".mp3";
  if (kind === "video") return ".mp4";
  return ".png";
}

function prefixForKind(kind) {
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  return "input";
}

function isDataUri(value) {
  return /^data:/i.test(String(value || "").trim());
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isUploadedFileRef(value) {
  const s = String(value || "").trim();
  if (s.startsWith("file://")) return true;
  if (s.startsWith("/api/files/")) return true;
  // Bare staged filename from our upload endpoint
  if (/^(upload|input|audio|video|datauri)_\d+_/.test(s)) return true;
  return false;
}

function parseUploadedFileRef(value) {
  const s = String(value || "").trim();
  if (s.startsWith("file://")) return s.slice("file://".length);
  if (s.startsWith("/api/files/")) return decodeURIComponent(s.slice("/api/files/".length));
  return s;
}

function parseDataUri(value) {
  const s = String(value || "").trim();
  const m = s.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!m) throw new Error("Invalid data URI.");
  const mime = (m[1] || "application/octet-stream").toLowerCase();
  const isBase64 = Boolean(m[2]);
  const data = m[3] || "";
  const buffer = isBase64
    ? Buffer.from(data, "base64")
    : Buffer.from(decodeURIComponent(data), "utf8");
  return { mime, buffer };
}

function extForMime(mime, kind) {
  const fromMime = MIME_TO_EXT[mime];
  if (fromMime) return fromMime;
  return defaultExt(kind);
}

function assertKindAllowsDataUri(kind) {
  if (kind === "video") {
    throw new Error("Video data URIs are not supported; use upload or HTTPS URL.");
  }
}

function writeStagedBuffer(buffer, { kind, ext, prefix = "datauri" }) {
  const inputDir = getComfyInputDir();
  fs.mkdirSync(inputDir, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 12);
  const safeExt = EXT_BY_KIND[kind]?.has(ext) ? ext : defaultExt(kind);
  const filename = `${prefix}_${now}_${hash}${safeExt}`;
  fs.writeFileSync(path.join(inputDir, filename), buffer);
  return {
    filename,
    expires_at: expiresAtFromNow(INPUT_TTL_SECONDS),
  };
}

async function fetchToBuffer(url, maxBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch media: ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(
      `Remote file exceeds max size (${maxBytes} bytes): ${url}`,
    );
  }
  return Buffer.from(arrayBuffer);
}

function findCachedByHash(prefix, hash, ext, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const inputDir = getComfyInputDir();
  const re = new RegExp(
    `^${prefix}_(\\d+)_${hash.replace(/([.*+?^=!:${}()|[\]\/\\])/g, "\\$1")}${ext.replace(".", "\\.")}$`,
  );
  for (const file of fs.readdirSync(inputDir)) {
    const m = file.match(re);
    if (!m) continue;
    const lastUsed = getInputLastUsedUnix(path.join(inputDir, file), file);
    if (lastUsed != null && now - lastUsed < ttlSeconds) return file;
  }
  return null;
}

/**
 * Resolve one media value (https URL | data URI | uploaded file ref) to a Comfy input filename.
 * @param {string} value
 * @param {{ kind: 'image'|'audio'|'video', ttlSeconds?: number }} opts
 */
async function resolveMediaValue(value, opts) {
  const kind = opts.kind;
  const ttlSeconds = opts.ttlSeconds ?? INPUT_TTL_SECONDS;
  const raw = String(value || "").trim();
  if (!raw) throw new Error(`Empty ${kind} input.`);

  if (isUploadedFileRef(raw)) {
    const filename = path.basename(parseUploadedFileRef(raw));
    const inputDir = getComfyInputDir();
    const full = path.join(inputDir, filename);
    if (!fs.existsSync(full)) {
      throw new Error(`Uploaded ${kind} not found or expired: ${filename}`);
    }
    // Reset TTL on every use so active refs stay alive.
    touchInputFile(inputDir, filename, { ttlSeconds });
    return filename;
  }

  if (isDataUri(raw)) {
    assertKindAllowsDataUri(kind);
    const { mime, buffer } = parseDataUri(raw);
    if (buffer.length > DATA_URI_MAX_BYTES) {
      throw new Error(
        `Data URI ${kind} exceeds ${DATA_URI_MAX_BYTES} bytes; use upload or HTTPS URL.`,
      );
    }
    if (kind === "image" && !mime.startsWith("image/")) {
      throw new Error(`Expected image data URI, got ${mime}`);
    }
    if (kind === "audio" && !mime.startsWith("audio/")) {
      throw new Error(`Expected audio data URI, got ${mime}`);
    }
    const staged = writeStagedBuffer(buffer, {
      kind,
      ext: extForMime(mime, kind),
      prefix: "datauri",
    });
    return staged.filename;
  }

  if (!isHttpUrl(raw)) {
    throw new Error(
      `Unsupported ${kind} input (use https URL, data URI, or /api/files/… ref).`,
    );
  }

  const inputDir = getComfyInputDir();
  fs.mkdirSync(inputDir, { recursive: true });
  let urlPathExt = ".bin";
  try {
    urlPathExt = path.extname(new URL(raw).pathname).toLowerCase() || defaultExt(kind);
  } catch {
    throw new Error(`Invalid ${kind} URL.`);
  }
  const ext = EXT_BY_KIND[kind]?.has(urlPathExt) ? urlPathExt : defaultExt(kind);
  const prefix = prefixForKind(kind);
  const hash = crypto.createHash("md5").update(raw).digest("hex").slice(0, 12);
  const cached = findCachedByHash(prefix, hash, ext, ttlSeconds);
  if (cached) {
    touchInputFile(inputDir, cached, { ttlSeconds });
    return cached;
  }

  const maxBytes = FETCH_MAX_BYTES[kind] || FETCH_MAX_BYTES.image;
  const buffer = await fetchToBuffer(raw, maxBytes);
  const now = Math.floor(Date.now() / 1000);
  const filename = `${prefix}_${now}_${hash}${ext}`;
  fs.writeFileSync(path.join(inputDir, filename), buffer);
  return filename;
}

/**
 * @param {string[]} values
 * @param {{ kind: 'image'|'audio'|'video' }} opts
 */
async function resolveMediaInputs(values, opts) {
  if (!Array.isArray(values)) {
    throw new Error("Input must be an array of media values");
  }
  const filenames = [];
  for (const value of values) {
    filenames.push(await resolveMediaValue(value, opts));
  }
  return filenames;
}

module.exports = {
  DATA_URI_MAX_BYTES,
  FETCH_MAX_BYTES,
  resolveMediaValue,
  resolveMediaInputs,
  writeStagedBuffer,
  isDataUri,
  isHttpUrl,
  isUploadedFileRef,
  parseUploadedFileRef,
  MIME_TO_EXT,
  EXT_BY_KIND,
};
