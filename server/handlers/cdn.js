"use strict";

const fs = require("fs");
const path = require("path");
const { sendJson, readJson } = require("../lib/http.js");
const store = require("../lib/cdn-store.js");
const { parseWindow, extractWindow, extractCover } = require("../lib/cdn-ffmpeg.js");

const UPLOAD_MAX_BYTES = Number(process.env.CDN_UPLOAD_MAX_BYTES) || 50 * 1024 * 1024;

const MIME_EXT = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/aac": ".m4a",
  "audio/webm": ".webm",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

function cdnMintKey() {
  // Same bearer as /api and /api/files (PARASCENE_API_KEY).
  return process.env.PARASCENE_API_KEY || "parascene-local-dev-token";
}

function getBearerToken(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header || typeof header !== "string") return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1] || null;
}

function ensureCdnMintAuthorized(req, res) {
  const expected = cdnMintKey();
  const token = getBearerToken(req);
  if (!expected || !token || token !== expected) {
    sendJson(res, 401, {
      error: "Unauthorized",
      message: "Missing or invalid bearer token.",
    });
    return false;
  }
  return true;
}

function pathnameOf(req, ctx) {
  return String(ctx?.path || (req.url || "").split("?")[0]);
}

function queryOf(req) {
  const q = String(req.url || "").split("?")[1] || "";
  return new URLSearchParams(q);
}

function objectIdFromObjectsPath(pathname) {
  const prefix = "/cdn/objects/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const [id] = rest.split("/");
  return id || null;
}

async function handleCdnUploadsPost(req, res) {
  if (!ensureCdnMintAuthorized(req, res)) return;
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message || "Invalid JSON body." });
  }
  const meta = store.createPendingObject({
    pin: Boolean(body.pin),
    contentType: body.content_type,
    filename: body.filename,
  });
  const slot = store.createUploadSlot(meta.id);
  return sendJson(res, 201, {
    object_id: meta.id,
    pin: meta.pinned,
    upload_url: slot.upload_url,
    expires_at: slot.expires_at,
  });
}

async function handleCdnObjectsPost(req, res, ctx) {
  if (!ensureCdnMintAuthorized(req, res)) return;
  const pathname = pathnameOf(req, ctx);
  const objectId = objectIdFromObjectsPath(pathname);
  if (!objectId || !store.OBJECT_ID_RE.test(objectId)) {
    return sendJson(res, 400, { error: "Invalid object id." });
  }
  const meta = store.loadObject(objectId);
  if (!meta) {
    return sendJson(res, 404, { error: "Object not found." });
  }

  if (pathname.endsWith("/pin") || pathname.endsWith("/pin/")) {
    if (meta.status !== "ready") {
      return sendJson(res, 409, { error: "Object is not ready to pin." });
    }
    const pinned = store.pinObject(objectId);
    return sendJson(res, 200, {
      object_id: pinned.id,
      pinned: true,
      expires_at: null,
    });
  }

  if (pathname.endsWith("/links") || pathname.endsWith("/links/")) {
    if (meta.status !== "ready") {
      return sendJson(res, 409, { error: "Object is not ready." });
    }
    if (!meta.pinned && store.isExpired(meta.expires_at)) {
      return sendJson(res, 404, { error: "Object expired." });
    }
    let body = {};
    try {
      body = await readJson(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message || "Invalid JSON body." });
    }
    let so;
    let du;
    try {
      if (body.so != null || body.du != null) {
        const w = parseWindow(body.so, body.du);
        so = w.so;
        du = w.du;
      }
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const link = store.createFetchLink(objectId, { so, du });
    if (!link) {
      return sendJson(res, 409, { error: "Could not mint fetch URL." });
    }
    return sendJson(res, 201, {
      url: link.url,
      expires_at: link.expires_at,
      object_id: objectId,
    });
  }

  return sendJson(res, 404, { error: "Not found" });
}

function handleCdnObjectsDelete(req, res, ctx) {
  if (!ensureCdnMintAuthorized(req, res)) return;
  const pathname = pathnameOf(req, ctx);
  const objectId = objectIdFromObjectsPath(pathname);
  if (!objectId || !store.OBJECT_ID_RE.test(objectId)) {
    return sendJson(res, 400, { error: "Invalid object id." });
  }
  if (pathname !== `/cdn/objects/${objectId}`) {
    return sendJson(res, 404, { error: "Not found" });
  }
  const ok = store.deleteObject(objectId);
  if (!ok) return sendJson(res, 404, { error: "Object not found." });
  return sendJson(res, 200, { ok: true, object_id: objectId });
}

async function handleCdnUploadPut(req, res, ctx) {
  const pathname = pathnameOf(req, ctx);
  const token = pathname.slice("/cdn/u/".length);
  const slot = store.loadUploadSlot(token);
  if (!slot) {
    return sendJson(res, 404, { error: "Upload URL expired or invalid." });
  }
  const meta = store.loadObject(slot.object_id);
  if (!meta || meta.status !== "pending") {
    store.consumeUploadSlot(token);
    return sendJson(res, 404, { error: "Upload URL expired or invalid." });
  }

  const dest = store.dataPath(meta.id);
  store.ensureRoot();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.part`;
  let bytes = 0;
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      req.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > UPLOAD_MAX_BYTES) {
          req.destroy();
          out.destroy();
          reject(Object.assign(new Error("Upload too large."), { status: 413 }));
        }
      });
      req.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
      req.pipe(out);
    });
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    const status = err.status || 400;
    return sendJson(res, status, { error: err.message || "Upload failed." });
  }

  try {
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    return sendJson(res, 500, { error: err.message || "Failed to store upload." });
  }

  store.consumeUploadSlot(token);
  const contentType =
    String(req.headers["content-type"] || "").split(";")[0].trim() ||
    meta.content_type;
  const finalized = store.finalizeObject(meta.id, {
    bytes,
    contentType,
    filename: meta.filename,
  });
  return sendJson(res, 201, {
    object_id: finalized.id,
    bytes: finalized.bytes,
    pinned: finalized.pinned,
    content_type: finalized.content_type,
    expires_at: finalized.expires_at,
  });
}

function mimeFor(meta, filePath) {
  if (meta?.content_type && meta.content_type !== "application/octet-stream") {
    return meta.content_type;
  }
  const ext = path.extname(filePath || meta?.filename || "").toLowerCase();
  for (const [mime, mext] of Object.entries(MIME_EXT)) {
    if (mext === ext) return mime;
  }
  return "application/octet-stream";
}

function sendFile(res, filePath, mime) {
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": String(stat.size),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleCdnGet(req, res, ctx) {
  const pathname = pathnameOf(req, ctx);
  const rest = pathname.slice("/cdn/".length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length !== 1) {
    return sendJson(res, 404, { error: "Not found" });
  }
  const id = parts[0];
  if (store.OBJECT_ID_RE.test(id)) {
    return sendJson(res, 403, { error: "Access denied" });
  }
  const link = store.loadFetchLink(id);
  if (!link) {
    return sendJson(res, 404, { error: "Link expired or invalid." });
  }
  const meta = store.loadObject(link.object_id);
  if (!meta || meta.status !== "ready") {
    return sendJson(res, 404, { error: "Object not found." });
  }
  if (!meta.pinned && store.isExpired(meta.expires_at)) {
    return sendJson(res, 404, { error: "Object expired." });
  }
  const src = store.dataPath(meta.id);
  if (!fs.existsSync(src)) {
    return sendJson(res, 404, { error: "Object not found." });
  }

  const q = queryOf(req);
  const cover = q.get("cover");
  if (cover === "1" || cover === "true") {
    try {
      const still = await extractCover({
        srcPath: src,
        objectId: meta.id,
      });
      return sendFile(res, still.path, "image/jpeg");
    } catch (err) {
      return sendJson(res, err.status || 404, {
        error: err.message || "No embedded artwork.",
      });
    }
  }

  const soQ = q.get("so");
  const duQ = q.get("du");
  let so = link.so;
  let du = link.du;
  if (soQ != null || duQ != null) {
    try {
      const w = parseWindow(soQ ?? so ?? 0, duQ ?? du);
      so = w.so;
      du = w.du;
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const wantsWindow = du != null || (Number(so) > 0);
  if (!wantsWindow) {
    return sendFile(res, src, mimeFor(meta, src));
  }

  try {
    const ext =
      MIME_EXT[String(meta.content_type || "").toLowerCase()] ||
      path.extname(meta.filename || "") ||
      ".m4a";
    const clipped = await extractWindow({
      srcPath: src,
      objectId: meta.id,
      so: so || 0,
      du,
      ext,
    });
    return sendFile(res, clipped.path, mimeFor(meta, clipped.path));
  } catch (err) {
    return sendJson(res, 400, { error: err.message || "Window extract failed." });
  }
}

function wrap(fn) {
  return (req, res, ctx) => {
    Promise.resolve(fn(req, res, ctx)).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err.message || "CDN error." });
      }
    });
  };
}

function registerCdnRoutes(app) {
  app.post("/cdn/uploads", wrap(handleCdnUploadsPost));
  app.post("/cdn/objects/*", wrap(handleCdnObjectsPost));
  app.delete("/cdn/objects/*", wrap(handleCdnObjectsDelete));
  app.put("/cdn/u/*", wrap(handleCdnUploadPut));
  app.get("/cdn/*", wrap(handleCdnGet));
}

module.exports = {
  registerCdnRoutes,
  handleCdnUploadsPost,
  handleCdnObjectsPost,
  handleCdnObjectsDelete,
  handleCdnUploadPut,
  handleCdnGet,
  UPLOAD_MAX_BYTES,
};
