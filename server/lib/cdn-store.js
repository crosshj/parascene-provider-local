"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OBJECT_ID_RE = /^o_[a-f0-9]{24}$/;
const TOKEN_RE = /^[a-f0-9]{48}$/;

function getCdnDir() {
  return process.env.CDN_DIR || "D:/parascene-cdn";
}

function getLinkTtlSeconds() {
  return Number(process.env.CDN_LINK_TTL_SECONDS) || 3600;
}

function getUploadTtlSeconds() {
  return Number(process.env.CDN_UPLOAD_TTL_SECONDS) || 600;
}

function getEphemeralObjectTtlSeconds() {
  return Number(process.env.CDN_EPHEMERAL_OBJECT_TTL_SECONDS) || 86400;
}

function getPublicBase() {
  const raw =
    process.env.CDN_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://blue.parascene.com";
  return String(raw).replace(/\/$/, "");
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function newObjectId() {
  return `o_${randomHex(12)}`;
}

function newToken() {
  return randomHex(24);
}

function dirs() {
  const root = getCdnDir();
  return {
    root,
    objects: path.join(root, "objects"),
    uploads: path.join(root, "uploads"),
    links: path.join(root, "links"),
    derived: path.join(root, "derived"),
  };
}

function ensureRoot() {
  const d = dirs();
  for (const p of [d.root, d.objects, d.uploads, d.links, d.derived]) {
    fs.mkdirSync(p, { recursive: true });
  }
  return d;
}

function objectDir(objectId) {
  return path.join(dirs().objects, objectId);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function isExpired(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= Date.now();
}

function loadObject(objectId) {
  if (!OBJECT_ID_RE.test(objectId)) return null;
  const meta = readJsonFile(path.join(objectDir(objectId), "meta.json"));
  if (!meta || meta.id !== objectId) return null;
  return meta;
}

function saveObject(meta) {
  const dir = objectDir(meta.id);
  fs.mkdirSync(dir, { recursive: true });
  writeJsonFile(path.join(dir, "meta.json"), meta);
}

function dataPath(objectId) {
  return path.join(objectDir(objectId), "data");
}

function createPendingObject({ pin, contentType, filename }) {
  ensureRoot();
  const id = newObjectId();
  const now = new Date().toISOString();
  const pinned = Boolean(pin);
  const meta = {
    id,
    status: "pending",
    pinned,
    content_type: contentType || "application/octet-stream",
    filename: filename ? path.basename(String(filename)) : null,
    bytes: 0,
    created_at: now,
    expires_at: new Date(
      Date.now() + getUploadTtlSeconds() * 1000,
    ).toISOString(),
  };
  saveObject(meta);
  return meta;
}

function createUploadSlot(objectId) {
  ensureRoot();
  const token = newToken();
  const expiresAt = new Date(
    Date.now() + getUploadTtlSeconds() * 1000,
  ).toISOString();
  writeJsonFile(path.join(dirs().uploads, `${token}.json`), {
    token,
    object_id: objectId,
    expires_at: expiresAt,
  });
  return {
    token,
    upload_url: `${getPublicBase()}/cdn/u/${token}`,
    expires_at: expiresAt,
  };
}

function loadUploadSlot(token) {
  if (!TOKEN_RE.test(token)) return null;
  const slot = readJsonFile(path.join(dirs().uploads, `${token}.json`));
  if (!slot || slot.token !== token) return null;
  if (isExpired(slot.expires_at)) return null;
  return slot;
}

function consumeUploadSlot(token) {
  const filePath = path.join(dirs().uploads, `${token}.json`);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already gone
  }
}

function finalizeObject(objectId, { bytes, contentType, filename }) {
  const meta = loadObject(objectId);
  if (!meta) return null;
  meta.status = "ready";
  meta.bytes = bytes;
  if (contentType) meta.content_type = contentType;
  if (filename) meta.filename = path.basename(String(filename));
  if (meta.pinned) {
    meta.expires_at = null;
  } else {
    meta.expires_at = new Date(
      Date.now() + getEphemeralObjectTtlSeconds() * 1000,
    ).toISOString();
  }
  saveObject(meta);
  return meta;
}

function pinObject(objectId) {
  const meta = loadObject(objectId);
  if (!meta) return null;
  meta.pinned = true;
  meta.expires_at = null;
  saveObject(meta);
  return meta;
}

function createFetchLink(objectId, { so, du } = {}) {
  ensureRoot();
  const meta = loadObject(objectId);
  if (!meta || meta.status !== "ready") return null;
  if (!meta.pinned && isExpired(meta.expires_at)) return null;
  const token = newToken();
  const expiresAt = new Date(Date.now() + getLinkTtlSeconds() * 1000).toISOString();
  const record = {
    token,
    object_id: objectId,
    expires_at: expiresAt,
  };
  if (so != null) record.so = so;
  if (du != null) record.du = du;
  writeJsonFile(path.join(dirs().links, `${token}.json`), record);
  let url = `${getPublicBase()}/cdn/${token}`;
  const q = [];
  if (so != null) q.push(`so=${encodeURIComponent(String(so))}`);
  if (du != null) q.push(`du=${encodeURIComponent(String(du))}`);
  if (q.length) url += `?${q.join("&")}`;
  return { token, url, expires_at: expiresAt, object_id: objectId };
}

function loadFetchLink(token) {
  if (!TOKEN_RE.test(token)) return null;
  const link = readJsonFile(path.join(dirs().links, `${token}.json`));
  if (!link || link.token !== token) return null;
  if (isExpired(link.expires_at)) return null;
  return link;
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function deleteObject(objectId) {
  if (!OBJECT_ID_RE.test(objectId)) return false;
  const meta = loadObject(objectId);
  if (!meta) return false;
  rmrf(objectDir(objectId));
  rmrf(path.join(dirs().derived, objectId));
  const d = dirs();
  for (const folder of [d.uploads, d.links]) {
    let names = [];
    try {
      names = fs.readdirSync(folder);
    } catch {
      names = [];
    }
    for (const name of names) {
      const full = path.join(folder, name);
      const rec = readJsonFile(full);
      if (rec && rec.object_id === objectId) {
        try {
          fs.unlinkSync(full);
        } catch {
          // ignore
        }
      }
    }
  }
  return true;
}

function sweepCdn() {
  const d = dirs();
  if (!fs.existsSync(d.root)) return { uploads: 0, links: 0, objects: 0 };
  let uploads = 0;
  let links = 0;
  let objects = 0;
  for (const [folder, kind] of [
    [d.uploads, "uploads"],
    [d.links, "links"],
  ]) {
    let names = [];
    try {
      names = fs.readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(folder, name);
      const rec = readJsonFile(full);
      if (!rec || isExpired(rec.expires_at)) {
        try {
          fs.unlinkSync(full);
          if (kind === "uploads") uploads += 1;
          else links += 1;
        } catch {
          // ignore
        }
      }
    }
  }
  let objNames = [];
  try {
    objNames = fs.readdirSync(d.objects);
  } catch {
    objNames = [];
  }
  for (const name of objNames) {
    const meta = loadObject(name);
    if (!meta) continue;
    if (meta.status === "pending" && isExpired(meta.expires_at)) {
      deleteObject(name);
      objects += 1;
      continue;
    }
    if (meta.pinned) continue;
    if (meta.status === "ready" && isExpired(meta.expires_at)) {
      deleteObject(name);
      objects += 1;
    }
  }
  return { uploads, links, objects };
}

function startCdnSweeper() {
  ensureRoot();
  const intervalMs =
    (Number(process.env.CDN_CLEANUP_INTERVAL_SECONDS) || 300) * 1000;
  sweepCdn();
  return setInterval(() => {
    try {
      sweepCdn();
    } catch (err) {
      console.warn(`[cdn] sweep failed: ${err.message}`);
    }
  }, intervalMs);
}

function derivedPath(objectId, so, du, ext) {
  const key = `${Number(so).toFixed(3)}_${Number(du).toFixed(3)}${ext}`;
  const dir = path.join(dirs().derived, objectId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, key);
}

function derivedCoverPath(objectId) {
  const dir = path.join(dirs().derived, objectId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "cover.jpg");
}

module.exports = {
  OBJECT_ID_RE,
  TOKEN_RE,
  getCdnDir,
  getPublicBase,
  getLinkTtlSeconds,
  ensureRoot,
  newObjectId,
  loadObject,
  saveObject,
  dataPath,
  createPendingObject,
  createUploadSlot,
  loadUploadSlot,
  consumeUploadSlot,
  finalizeObject,
  pinObject,
  createFetchLink,
  loadFetchLink,
  deleteObject,
  sweepCdn,
  startCdnSweeper,
  derivedPath,
  derivedCoverPath,
  isExpired,
};
