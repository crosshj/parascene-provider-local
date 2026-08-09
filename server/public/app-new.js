"use strict";

const CREDENTIALS_STORAGE_KEY = "credentials";

function getStoredCredentials() {
  try {
    const raw = localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setStoredCredentials(value) {
  try {
    if (!value) {
      localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
    } else {
      localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    // Ignore storage failures.
  }
}

function showTokenGate() {
  const gate = document.getElementById("token-gate");
  const appRoot = document.getElementById("app-root");
  if (gate) gate.hidden = false;
  if (appRoot) appRoot.hidden = true;
}

function showAppRoot() {
  const gate = document.getElementById("token-gate");
  const appRoot = document.getElementById("app-root");
  if (gate) gate.hidden = true;
  if (appRoot) appRoot.hidden = false;
}

async function apiFetch(path, options = {}) {
  const creds = getStoredCredentials();
  const init = { ...options };
  const headers = new Headers(init.headers || {});

  if (creds && typeof creds === "object") {
    if (typeof creds.token === "string" && creds.token.trim()) {
      headers.set("Authorization", `Bearer ${creds.token.trim()}`);
    }
    if (
      typeof creds.cfAccessClientId === "string" &&
      creds.cfAccessClientId.trim()
    ) {
      headers.set("CF-Access-Client-Id", creds.cfAccessClientId.trim());
    }
    if (
      typeof creds.cfAccessClientSecret === "string" &&
      creds.cfAccessClientSecret.trim()
    ) {
      headers.set("CF-Access-Client-Secret", creds.cfAccessClientSecret.trim());
    }
  }

  init.headers = headers;

  const res = await fetch(path, init);
  if (res.status === 401) {
    // Surface 401 to callers without clearing stored credentials.
    throw new Error(
      "Unauthorized: token or access credentials invalid or missing.",
    );
  }
  return res;
}

function initTokenForm() {
  const form = document.getElementById("token-form");
  if (!form) return;
  const textarea = document.getElementById("credentials-json");

  // Prefill from storage if available.
  if (textarea) {
    const stored = getStoredCredentials();
    if (stored) {
      textarea.value = JSON.stringify(stored, null, 2);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!textarea) return;

    const raw = textarea.value.trim();
    if (!raw) {
      alert("Please paste credentials JSON.");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      alert("Invalid JSON. Please check your syntax.");
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      alert("Credentials JSON must be an object.");
      return;
    }

    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    const cfId =
      typeof parsed.cfAccessClientId === "string"
        ? parsed.cfAccessClientId.trim()
        : "";
    const cfSecret =
      typeof parsed.cfAccessClientSecret === "string"
        ? parsed.cfAccessClientSecret.trim()
        : "";

    if (!token || !cfId || !cfSecret) {
      alert(
        'Credentials JSON must include non-empty "token", "cfAccessClientId", and "cfAccessClientSecret" string fields.',
      );
      return;
    }

    const normalized = {
      token,
      cfAccessClientId: cfId,
      cfAccessClientSecret: cfSecret,
    };

    setStoredCredentials(normalized);
    showAppRoot();
    initApp();
  });
}

// ── Main app (copied from app.js with config-driven select + token auth) ─────

function initApp() {
  const form = document.getElementById("gen-form");
  if (!form) return;

  const modelSel = document.getElementById("model");
  const methodSel = document.getElementById("method");
  const badge = document.getElementById("family-badge");
  const statusEl = document.getElementById("status");
  const copyErrorBtn = document.getElementById("copy-error-btn");
  const previewWrap = document.getElementById("preview-wrap");
  const idleEl = document.getElementById("preview-idle");
  const imageEl = document.getElementById("image");
  const metaRowEl = document.getElementById("meta-row");
  const aspectRatioField = document.getElementById("aspect-ratio-field");
  const aspectRatioSel = document.getElementById("aspect_ratio");
  const durationField = document.getElementById("duration-field");
  const durationInput = document.getElementById("duration_seconds");
  const startOffsetField = document.getElementById("start-offset-field");
  const startOffsetInput = document.getElementById("start_offset_seconds");
  const uploadLibraryEl = document.getElementById("upload-library");

  const UPLOAD_LIBRARY_KEY = "local-image-generator.uploads.v1";
  const uploadLibraryField = document.getElementById("upload-library-field");
  let inputTtlSeconds = 86400;
  /** @type {Array<object>} */
  let capabilityMatrix = [];
  /** @type {{ image: string[], video: string[], audio: string[] }} */
  let mediaValues = { image: [""], video: [], audio: [] };
  /** @type {Map<string, string>} session preview object URLs / data URIs keyed by media value */
  const previewByUrl = new Map();

  function loadUploadLibrary() {
    try {
      const raw = localStorage.getItem(UPLOAD_LIBRARY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveUploadLibrary(items) {
    try {
      localStorage.setItem(UPLOAD_LIBRARY_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }

  function pruneUploadLibrary(items) {
    const now = Date.now();
    return items.filter((it) => {
      if (!it || !it.url) return false;
      if (!it.expires_at) return true;
      const exp = Date.parse(it.expires_at);
      return !Number.isFinite(exp) || exp > now;
    });
  }

  function rememberUpload(meta) {
    if (!meta?.url) return;
    const items = pruneUploadLibrary(loadUploadLibrary());
    const next = {
      url: meta.url,
      filename: meta.filename || meta.id || "",
      kind: meta.kind || "image",
      label: meta.label || meta.originalName || meta.filename || "upload",
      bytes: meta.bytes ?? null,
      expires_at: meta.expires_at || null,
      uploaded_at: meta.uploaded_at || new Date().toISOString(),
      thumb: meta.thumb || null,
      width: meta.width ?? null,
      height: meta.height ?? null,
    };
    if (meta.preview) previewByUrl.set(next.url, meta.preview);
    const filtered = items.filter((it) => it.url !== next.url);
    filtered.unshift(next);
    saveUploadLibrary(filtered.slice(0, 40));
    renderUploadLibrary();
  }

  function bumpLibraryTtlForUrls(urls) {
    if (!urls?.length) return;
    const items = loadUploadLibrary();
    const set = new Set(urls.filter(Boolean));
    let changed = false;
    const expires = new Date(Date.now() + inputTtlSeconds * 1000).toISOString();
    for (const it of items) {
      if (set.has(it.url)) {
        it.expires_at = expires;
        changed = true;
      }
    }
    if (changed) {
      saveUploadLibrary(items);
      renderUploadLibrary();
    }
  }

  function formatExpiresShort(iso) {
    if (!iso) return "";
    const ms = Date.parse(iso) - Date.now();
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3600000);
    if (h >= 48) return `${Math.floor(h / 24)}d`;
    if (h >= 1) return `${h}h`;
    const m = Math.max(1, Math.floor(ms / 60000));
    return `${m}m`;
  }

  function kindGlyph(kind) {
    if (kind === "video") return "VID";
    if (kind === "audio") return "AUD";
    return "IMG";
  }

  const lightboxEl = document.getElementById("media-lightbox");
  const lightboxTitleEl = document.getElementById("media-lightbox-title");
  const lightboxBodyEl = document.getElementById("media-lightbox-body");
  const lightboxCloseBtn = document.getElementById("media-lightbox-close");
  const lightboxCloseBg = document.getElementById("media-lightbox-close-bg");

  function closeMediaLightbox() {
    if (!lightboxEl) return;
    lightboxEl.hidden = true;
    if (lightboxBodyEl) {
      const vid = lightboxBodyEl.querySelector("video");
      if (vid) {
        try {
          vid.pause();
        } catch {
          /* ignore */
        }
      }
      lightboxBodyEl.innerHTML = "";
    }
  }

  function filesRawUrl(url) {
    const s = String(url || "");
    if (!s.includes("/api/files/")) return s;
    return s.includes("?") ? `${s}&raw=1` : `${s}?raw=1`;
  }

  async function resolvePlayableUrl(value, kind) {
    const v = String(value || "").trim();
    if (!v) return null;
    if (previewByUrl.has(v)) return previewByUrl.get(v);
    if (v.startsWith("data:") || /^https?:\/\//i.test(v)) return v;
    if (v.includes("/api/files/")) {
      try {
        const res = await apiFetch(filesRawUrl(v), { method: "GET" });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (kind === "image" && !String(blob.type || "").startsWith("image/")) {
          // still try
        }
        const obj = URL.createObjectURL(blob);
        previewByUrl.set(v, obj);
        return obj;
      } catch {
        return null;
      }
    }
    return null;
  }

  async function openMediaLightbox({ kind, value, label }) {
    if (!lightboxEl || !lightboxBodyEl) return;
    const title = label || slotRole(kind, 0) || "Preview";
    if (lightboxTitleEl) lightboxTitleEl.textContent = title;
    lightboxBodyEl.innerHTML = `<div class="media-lightbox-empty">Loading…</div>`;
    lightboxEl.hidden = false;

    const src = await resolvePlayableUrl(value, kind);
    lightboxBodyEl.innerHTML = "";
    if (!src) {
      const empty = document.createElement("div");
      empty.className = "media-lightbox-empty";
      empty.textContent = "No preview available for this file.";
      lightboxBodyEl.appendChild(empty);
      return;
    }
    if (kind === "video") {
      const video = document.createElement("video");
      video.src = src;
      video.controls = true;
      video.playsInline = true;
      video.autoplay = true;
      lightboxBodyEl.appendChild(video);
      return;
    }
    if (kind === "audio") {
      const audio = document.createElement("audio");
      audio.src = src;
      audio.controls = true;
      audio.autoplay = true;
      lightboxBodyEl.appendChild(audio);
      return;
    }
    const img = document.createElement("img");
    img.src = src;
    img.alt = title;
    lightboxBodyEl.appendChild(img);
  }

  lightboxCloseBtn?.addEventListener("click", closeMediaLightbox);
  lightboxCloseBg?.addEventListener("click", closeMediaLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightboxEl && !lightboxEl.hidden) {
      closeMediaLightbox();
    }
  });

  function displayMetaForValue(value, kind) {
    const v = String(value || "").trim();
    if (!v) return { label: "None selected", preview: null, playable: null };
    const lib = loadUploadLibrary().find((it) => it.url === v);
    if (lib) {
      return {
        label: lib.label || lib.filename || "Upload",
        preview: previewByUrl.get(v) || lib.thumb || null,
        playable: previewByUrl.get(v) || null,
      };
    }
    if (v.startsWith("data:image")) {
      return { label: "Pasted image", preview: v, playable: v };
    }
    if (/^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v);
        const leaf = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
        return {
          label: decodeURIComponent(leaf),
          preview: kind === "image" ? v : null,
          playable: v,
        };
      } catch {
        return { label: "Remote URL", preview: null, playable: null };
      }
    }
    if (v.includes("/api/files/")) {
      return {
        label: "Uploaded file",
        preview: previewByUrl.get(v) || null,
        playable: previewByUrl.get(v) || null,
      };
    }
    return { label: "Media", preview: null, playable: null };
  }

  function slotRole(kind, idx) {
    const method = methodSel.value;
    if (kind === "image" && method === "image2video") {
      return idx === 0 ? "Start frame" : "End frame (optional)";
    }
    if (kind === "image" && method === "reference2video") {
      return `Picture ${idx + 1}`;
    }
    if (kind === "video" && method === "reference2video") {
      return `Video ${idx + 1}`;
    }
    if (kind === "audio" && method === "reference2video") {
      return `Audio ${idx + 1}`;
    }
    if (kind === "image" && method === "video2video") {
      return "Character image";
    }
    if (kind === "image" && method === "audio2video") {
      return "Image (optional)";
    }
    if (kind === "video") return "Video";
    if (kind === "audio") return "Audio";
    return "Image";
  }

  function makeThumbEl(kind, preview, { clickable, onOpen } = {}) {
    const thumb = document.createElement(clickable ? "button" : "div");
    if (clickable) thumb.type = "button";
    thumb.className = "media-card-thumb";
    thumb.title = clickable ? "Click to preview" : "";
    if (preview && (kind === "image" || kind === "video")) {
      if (kind === "video" && !String(preview).startsWith("data:image")) {
        const video = document.createElement("video");
        video.src = preview;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        thumb.appendChild(video);
        const play = document.createElement("span");
        play.className = "media-card-play";
        play.textContent = "▶";
        thumb.appendChild(play);
      } else {
        const img = document.createElement("img");
        img.src = preview;
        img.alt = "";
        thumb.appendChild(img);
        if (kind === "video") {
          const play = document.createElement("span");
          play.className = "media-card-play";
          play.textContent = "▶";
          thumb.appendChild(play);
        }
      }
    } else {
      thumb.textContent = kindGlyph(kind);
    }
    if (clickable && typeof onOpen === "function") {
      thumb.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      });
    }
    return thumb;
  }

  function makeVideoThumbDataUrl(file) {
    return new Promise((resolve) => {
      if (!file || !String(file.type || "").startsWith("video/")) {
        resolve(null);
        return;
      }
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      const cleanup = () => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      };
      const fail = () => {
        cleanup();
        resolve(null);
      };
      video.addEventListener("error", fail, { once: true });
      video.addEventListener(
        "loadeddata",
        () => {
          const seekTo = Number.isFinite(video.duration)
            ? Math.min(0.25, Math.max(0, video.duration / 4))
            : 0.1;
          const capture = () => {
            try {
              const size = 96;
              const canvas = document.createElement("canvas");
              canvas.width = size;
              canvas.height = size;
              const ctx = canvas.getContext("2d");
              const scale = Math.max(
                size / (video.videoWidth || size),
                size / (video.videoHeight || size),
              );
              const w = (video.videoWidth || size) * scale;
              const h = (video.videoHeight || size) * scale;
              ctx.drawImage(video, (size - w) / 2, (size - h) / 2, w, h);
              resolve(canvas.toDataURL("image/jpeg", 0.7));
            } catch {
              resolve(null);
            } finally {
              cleanup();
            }
          };
          video.addEventListener("seeked", capture, { once: true });
          try {
            video.currentTime = seekTo;
          } catch {
            capture();
          }
        },
        { once: true },
      );
      video.src = url;
    });
  }

  function renderUploadLibrary() {
    if (!uploadLibraryEl) return;
    const items = pruneUploadLibrary(loadUploadLibrary());
    saveUploadLibrary(items);
    uploadLibraryEl.innerHTML = "";
    if (uploadLibraryField) {
      uploadLibraryField.hidden = items.length === 0;
    }
    if (!items.length) return;

    const limits = getMediaLimits();
    const visible = items.filter((it) => {
      const kind =
        it.kind === "video" || it.kind === "audio" ? it.kind : "image";
      if (kind === "video") return (limits.maxVideos || 0) > 0;
      if (kind === "audio") return (limits.maxAudios || 0) > 0;
      return (limits.maxImages || 0) > 0;
    });
    if (!visible.length) {
      if (uploadLibraryField) uploadLibraryField.hidden = true;
      return;
    }

    for (const it of visible) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "upload-library-item";
      const expired =
        it.expires_at && Date.parse(it.expires_at) <= Date.now();
      if (expired) btn.classList.add("is-expired");
      const thumb = document.createElement("span");
      thumb.className = "ul-thumb";
      const preview = previewByUrl.get(it.url) || it.thumb;
      if (preview && it.kind === "image") {
        const img = document.createElement("img");
        img.src = preview;
        img.alt = "";
        thumb.appendChild(img);
      } else {
        thumb.textContent = kindGlyph(it.kind);
      }
      const name = document.createElement("span");
      name.className = "ul-name";
      name.textContent = it.label || it.filename || "upload";
      name.title = it.label || it.filename || "";
      const exp = document.createElement("span");
      exp.className = "ul-exp";
      exp.textContent = formatExpiresShort(it.expires_at);
      btn.appendChild(thumb);
      btn.appendChild(name);
      btn.appendChild(exp);
      btn.addEventListener("click", () => assignLibraryItem(it));
      uploadLibraryEl.appendChild(btn);
    }
  }

  async function refreshLibraryItem(item) {
    const path = item.url.startsWith("/")
      ? item.url
      : `/api/files/${encodeURIComponent(item.filename || "")}`;
    const res = await apiFetch(path, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      saveUploadLibrary(
        loadUploadLibrary().filter((it) => it.url !== item.url),
      );
      renderUploadLibrary();
      throw new Error(data.error || "Upload expired on server.");
    }
    rememberUpload({
      ...item,
      ...data,
      label: item.label,
      kind: data.kind || item.kind,
      thumb: item.thumb,
    });
    return {
      ...item,
      url: data.url || item.url,
      expires_at: data.expires_at,
      kind: data.kind || item.kind,
    };
  }

  async function assignLibraryItem(item, target) {
    if (!item?.url || !item.kind) return;
    const kind =
      item.kind === "video" || item.kind === "audio" ? item.kind : "image";
    const limits = getMediaLimits();
    const max =
      kind === "video"
        ? limits.maxVideos
        : kind === "audio"
          ? limits.maxAudios
          : limits.maxImages;
    if (max <= 0) {
      setStatusMessage(`Current method/model does not accept ${kind} inputs.`, true);
      return;
    }
    try {
      item = await refreshLibraryItem(item);
    } catch (err) {
      setStatusMessage("Library error: " + (err.message || "Unknown"), true);
      return;
    }

    const arr = mediaValues[kind] || [];
    let idx =
      target && target.kind === kind && Number.isInteger(target.idx)
        ? target.idx
        : arr.findIndex((v) => !String(v || "").trim());
    if (idx < 0) {
      if (arr.length >= max) {
        setStatusMessage(`All ${kind} slots are full (max ${max}).`, true);
        return;
      }
      arr.push(item.url);
    } else {
      while (arr.length <= idx) arr.push("");
      arr[idx] = item.url;
    }
    mediaValues[kind] = arr;
    renderMediaSlots();
    saveFormValues();
    setStatusMessage("Added from recent uploads.");
  }

  function makeImageThumbDataUrl(file) {
    return new Promise((resolve) => {
      if (!file || !String(file.type || "").startsWith("image/")) {
        resolve(null);
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const size = 96;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        } catch {
          resolve(null);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  async function uploadFileToApi(file) {
    if (!file) return null;
    const isImage = String(file.type || "").startsWith("image/");
    const isVideo = String(file.type || "").startsWith("video/");
    const thumb = isImage
      ? await makeImageThumbDataUrl(file)
      : isVideo
        ? await makeVideoThumbDataUrl(file)
        : null;
    const preview =
      isImage || isVideo ? URL.createObjectURL(file) : null;
    let natural = null;
    if (isImage && preview) {
      natural = await loadImageSize(preview);
      if (natural) await applyDetectedAspect(natural.width, natural.height);
    }
    const formData = new FormData();
    formData.append("content", file, file.name || "upload.bin");
    const res = await apiFetch("/api/files", {
      method: "POST",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (preview) URL.revokeObjectURL(preview);
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
    const url =
      data.url ||
      (data.filename
        ? `/api/files/${encodeURIComponent(data.filename)}`
        : "");
    if (!url) {
      if (preview) URL.revokeObjectURL(preview);
      throw new Error("Upload succeeded but no file URL was returned.");
    }
    rememberUpload({
      ...data,
      url,
      label: file.name || data.filename,
      originalName: file.name,
      uploaded_at: new Date().toISOString(),
      thumb,
      preview,
      width: natural?.width ?? null,
      height: natural?.height ?? null,
    });
    return { url, data, preview, thumb };
  }

  function getMediaLimits() {
    const method = methodSel.value;
    const model = modelSel.value;
    const matrixEntry = Array.isArray(capabilityMatrix)
      ? capabilityMatrix.find(
          (row) => row && row.method === method && row.model === model,
        )
      : null;

    if (method === "reference2video") {
      return {
        maxImages: matrixEntry?.maxRefImages ?? 9,
        maxVideos: matrixEntry?.maxRefVideos ?? 3,
        maxAudios: matrixEntry?.maxRefAudios ?? 3,
        imagesRequired: false,
        videosRequired: false,
        audiosRequired: false,
        fixedImageSlots: false,
        labelImages: "Reference images",
        labelVideos: "Reference videos",
        labelAudios: "Reference audio",
        hintImages: "Tag in prompt as <Picture 1>, <Picture 2>, …",
        hintVideos: "Tag in prompt as <Video 1>, …",
        hintAudios: "Optional; needs an image or video too.",
      };
    }
    if (method === "image2video") {
      return {
        maxImages: 2,
        maxVideos: 0,
        maxAudios: 0,
        imagesRequired: true,
        fixedImageSlots: true,
        labelImages: "Frames",
        hintImages: "End frame enables first/last-frame (FLF) motion.",
      };
    }
    if (method === "image2image") {
      return {
        maxImages: 1,
        maxVideos: 0,
        maxAudios: 0,
        imagesRequired: true,
        fixedImageSlots: true,
        labelImages: "Image",
        hintImages: "",
      };
    }
    if (method === "audio2video") {
      return {
        maxImages: 1,
        maxVideos: 0,
        maxAudios: 1,
        imagesRequired: false,
        audiosRequired: true,
        fixedImageSlots: true,
        labelImages: "Image",
        labelAudios: "Audio",
        hintAudios: "",
      };
    }
    if (method === "video2video") {
      return {
        maxImages: 1,
        maxVideos: 1,
        maxAudios: 0,
        videosRequired: true,
        fixedImageSlots: true,
        labelImages: "Character",
        labelVideos: "Video",
        hintVideos: "",
      };
    }
    return {
      maxImages: 0,
      maxVideos: 0,
      maxAudios: 0,
    };
  }

  function clampMediaToLimits() {
    const limits = getMediaLimits();
    const clamp = (arr, max, minSlots) => {
      let next = Array.isArray(arr) ? [...arr] : [];
      if (max <= 0) return [];
      if (next.length > max) next = next.slice(0, max);
      while (next.length < minSlots) next.push("");
      return next;
    };
    const method = methodSel.value;
    let imgFloor = 0;
    if (limits.maxImages > 0) {
      if (limits.fixedImageSlots) {
        imgFloor = method === "image2video" ? 2 : 1;
      } else if (method === "reference2video") {
        imgFloor = 1;
      } else if (limits.imagesRequired) {
        imgFloor = 1;
      }
    }

    mediaValues.image = clamp(mediaValues.image, limits.maxImages, imgFloor);
    mediaValues.video = clamp(
      mediaValues.video,
      limits.maxVideos,
      limits.videosRequired ? 1 : 0,
    );
    mediaValues.audio = clamp(
      mediaValues.audio,
      limits.maxAudios,
      limits.audiosRequired ? 1 : 0,
    );
  }

  function classifyClientAspect(width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!(w > 0 && h > 0)) return null;
    const pairs = [
      ["1:1", 1],
      ["4:5", 4 / 5],
      ["9:16", 9 / 16],
      ["16:9", 16 / 9],
    ];
    const actual = w / h;
    let best = null;
    let bestDiff = Infinity;
    for (const [key, value] of pairs) {
      const d = Math.abs(actual - value);
      if (d < bestDiff) {
        bestDiff = d;
        best = key;
      }
    }
    return bestDiff < 0.02 ? best : null;
  }

  function loadImageSize(src) {
    return new Promise((resolve) => {
      if (!src) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function syncAspectRatioFromImageSrc(src) {
    if (!aspectRatioSel || !src) return null;
    const size = await loadImageSize(src);
    if (!size) return null;
    await applyDetectedAspect(size.width, size.height);
    return size;
  }

  async function applyDetectedAspect(width, height) {
    if (!aspectRatioSel) return;
    const key = classifyClientAspect(width, height);
    if (!key) {
      setStatusMessage(
        `Image ratio ~${Math.round(width)}×${Math.round(height)} isn’t 1:1, 4:5, 9:16, or 16:9.`,
        true,
      );
      return;
    }
    if ([...aspectRatioSel.options].some((o) => o.value === key)) {
      aspectRatioSel.value = key;
      saveFormValues();
    }
  }

  async function syncAspectRatioFromPrimaryImage() {
    const images = getFilledMedia("image");
    if (!images.length) return;
    const value = images[0];
    const lib = loadUploadLibrary().find((it) => it.url === value);
    if (lib?.width && lib?.height) {
      await applyDetectedAspect(lib.width, lib.height);
      return;
    }
    const preview =
      previewByUrl.get(value) ||
      (/^https?:\/\//i.test(value) || value.startsWith("data:image")
        ? value
        : null);
    if (preview) await syncAspectRatioFromImageSrc(preview);
  }

  function setSlotValue(kind, idx, value) {
    while (mediaValues[kind].length <= idx) mediaValues[kind].push("");
    mediaValues[kind][idx] = value;
    saveFormValues();
    renderMediaSlots();
    if (kind === "image") {
      syncAspectRatioFromPrimaryImage();
    }
  }

  function clearSlot(kind, idx, removable) {
    if (removable) {
      mediaValues[kind].splice(idx, 1);
    } else {
      mediaValues[kind][idx] = "";
    }
    saveFormValues();
    renderMediaSlots();
  }

  function renderMediaSlots() {
    clampMediaToLimits();
    const limits = getMediaLimits();

    const configs = [
      {
        kind: "image",
        fieldId: "images-media-field",
        listId: "images-media-slots",
        addId: "images-media-add",
        labelId: "images-media-label",
        hintId: "images-media-hint",
        max: limits.maxImages,
        accept: "image/*",
        label: limits.labelImages || "Images",
        hint: limits.hintImages || "",
        fixed: Boolean(limits.fixedImageSlots),
        linkPlaceholder: "https://… or data:image/…",
      },
      {
        kind: "video",
        fieldId: "videos-media-field",
        listId: "videos-media-slots",
        addId: "videos-media-add",
        labelId: "videos-media-label",
        hintId: "videos-media-hint",
        max: limits.maxVideos,
        accept: "video/*",
        label: limits.labelVideos || "Videos",
        hint: limits.hintVideos || "",
        fixed: methodSel.value !== "reference2video",
        linkPlaceholder: "https://…",
      },
      {
        kind: "audio",
        fieldId: "audios-media-field",
        listId: "audios-media-slots",
        addId: "audios-media-add",
        labelId: "audios-media-label",
        hintId: "audios-media-hint",
        max: limits.maxAudios,
        accept: "audio/*",
        label: limits.labelAudios || "Audio",
        hint: limits.hintAudios || "",
        fixed: methodSel.value !== "reference2video",
        linkPlaceholder: "https://… or data:audio/…",
      },
    ];

    for (const cfg of configs) {
      const field = document.getElementById(cfg.fieldId);
      const list = document.getElementById(cfg.listId);
      const addBtn = document.getElementById(cfg.addId);
      const labelEl = document.getElementById(cfg.labelId);
      const hintEl = document.getElementById(cfg.hintId);
      if (!field || !list) continue;

      if (cfg.max <= 0) {
        field.style.display = "none";
        continue;
      }
      field.style.display = "";
      const values = mediaValues[cfg.kind] || [];
      const filled = values.filter((v) => String(v || "").trim()).length;
      if (labelEl) {
        labelEl.textContent =
          cfg.max > 1 ? `${cfg.label} · ${filled}/${cfg.max}` : cfg.label;
      }
      if (hintEl) hintEl.textContent = cfg.hint || "";

      list.innerHTML = "";
      values.forEach((value, idx) => {
        const role = slotRole(cfg.kind, idx);
        const filledValue = String(value || "").trim();
        const meta = displayMetaForValue(filledValue, cfg.kind);
        const card = document.createElement("div");
        card.className = `media-card ${filledValue ? "is-filled" : "is-empty"}`;

        const top = document.createElement("div");
        top.className = "media-card-top";
        const thumbEl = makeThumbEl(cfg.kind, meta.preview, {
          clickable: Boolean(filledValue),
          onOpen: () =>
            openMediaLightbox({
              kind: cfg.kind,
              value: filledValue,
              label: `${role} · ${meta.label}`,
            }),
        });
        top.appendChild(thumbEl);
        if (
          filledValue &&
          !meta.preview &&
          (cfg.kind === "image" || cfg.kind === "video")
        ) {
          const lib = loadUploadLibrary().find((it) => it.url === filledValue);
          if (lib?.thumb) {
            thumbEl.textContent = "";
            const img = document.createElement("img");
            img.src = lib.thumb;
            img.alt = "";
            thumbEl.appendChild(img);
            if (cfg.kind === "video") {
              const play = document.createElement("span");
              play.className = "media-card-play";
              play.textContent = "▶";
              thumbEl.appendChild(play);
            }
          } else {
            resolvePlayableUrl(filledValue, cfg.kind).then((src) => {
              if (!src || !thumbEl.isConnected) return;
              thumbEl.textContent = "";
              if (cfg.kind === "video") {
                const video = document.createElement("video");
                video.src = src;
                video.muted = true;
                video.playsInline = true;
                video.preload = "metadata";
                thumbEl.appendChild(video);
                const play = document.createElement("span");
                play.className = "media-card-play";
                play.textContent = "▶";
                thumbEl.appendChild(play);
              } else {
                const img = document.createElement("img");
                img.src = src;
                img.alt = "";
                thumbEl.appendChild(img);
              }
            });
          }
        }

        const metaEl = document.createElement("div");
        metaEl.className = "media-card-meta";
        const roleEl = document.createElement("div");
        roleEl.className = "media-card-role";
        roleEl.textContent = role;
        const nameEl = document.createElement("div");
        nameEl.className = "media-card-name";
        nameEl.textContent = filledValue
          ? meta.label
          : "Upload or paste a link";
        metaEl.appendChild(roleEl);
        metaEl.appendChild(nameEl);
        top.appendChild(metaEl);

        if (filledValue) {
          const clear = document.createElement("button");
          clear.type = "button";
          clear.className = "media-card-clear";
          clear.textContent = "Clear";
          clear.addEventListener("click", () => {
            const removable =
              !cfg.fixed && values.length > 1 && !(idx === 0 && cfg.kind === "image");
            clearSlot(cfg.kind, idx, removable);
          });
          top.appendChild(clear);
        }
        card.appendChild(top);

        if (!filledValue) {
          const actions = document.createElement("div");
          actions.className = "media-card-actions";

          const uploadLabel = document.createElement("label");
          uploadLabel.className = "media-card-upload";
          uploadLabel.textContent = "Upload";
          const file = document.createElement("input");
          file.type = "file";
          file.accept = cfg.accept;
          file.addEventListener("change", async () => {
            const f = file.files && file.files[0];
            if (!f) return;
            try {
              setStatusMessage("Uploading…");
              const result = await uploadFileToApi(f);
              if (result?.url) {
                setSlotValue(cfg.kind, idx, result.url);
                setStatusMessage("Ready.");
              }
            } catch (err) {
              setStatusMessage(
                "Upload error: " + (err.message || "Unknown"),
                true,
              );
            } finally {
              file.value = "";
            }
          });
          uploadLabel.appendChild(file);

          const linkBtn = document.createElement("button");
          linkBtn.type = "button";
          linkBtn.className = "btn-secondary";
          linkBtn.textContent = "Paste link";

          const linkRow = document.createElement("div");
          linkRow.className = "media-card-link-row";
          linkRow.hidden = true;
          const linkInput = document.createElement("input");
          linkInput.type = "text";
          linkInput.placeholder = cfg.linkPlaceholder;
          linkInput.autocomplete = "off";
          const linkUse = document.createElement("button");
          linkUse.type = "button";
          linkUse.className = "btn-secondary";
          linkUse.textContent = "Use";
          linkUse.addEventListener("click", () => {
            const v = linkInput.value.trim();
            if (!v) return;
            if (v.startsWith("data:image")) previewByUrl.set(v, v);
            setSlotValue(cfg.kind, idx, v);
          });
          linkRow.appendChild(linkInput);
          linkRow.appendChild(linkUse);
          linkBtn.addEventListener("click", () => {
            linkRow.hidden = !linkRow.hidden;
            if (!linkRow.hidden) linkInput.focus();
          });

          actions.appendChild(uploadLabel);
          actions.appendChild(linkBtn);
          card.appendChild(actions);
          card.appendChild(linkRow);
        } else {
          const actions = document.createElement("div");
          actions.className = "media-card-actions";
          const replaceLabel = document.createElement("label");
          replaceLabel.className = "media-card-upload";
          replaceLabel.textContent = "Replace";
          const file = document.createElement("input");
          file.type = "file";
          file.accept = cfg.accept;
          file.addEventListener("change", async () => {
            const f = file.files && file.files[0];
            if (!f) return;
            try {
              setStatusMessage("Uploading…");
              const result = await uploadFileToApi(f);
              if (result?.url) {
                setSlotValue(cfg.kind, idx, result.url);
                setStatusMessage("Ready.");
              }
            } catch (err) {
              setStatusMessage(
                "Upload error: " + (err.message || "Unknown"),
                true,
              );
            } finally {
              file.value = "";
            }
          });
          replaceLabel.appendChild(file);
          const peekBtn = document.createElement("button");
          peekBtn.type = "button";
          peekBtn.className = "btn-secondary";
          peekBtn.textContent = "Preview";
          peekBtn.addEventListener("click", () =>
            openMediaLightbox({
              kind: cfg.kind,
              value: filledValue,
              label: `${role} · ${meta.label}`,
            }),
          );
          actions.appendChild(replaceLabel);
          actions.appendChild(peekBtn);
          card.appendChild(actions);
        }

        list.appendChild(card);
      });

      if (addBtn) {
        const showAdd = !cfg.fixed && values.length < cfg.max;
        addBtn.style.display = showAdd ? "" : "none";
        addBtn.onclick = () => {
          if ((mediaValues[cfg.kind] || []).length >= cfg.max) return;
          mediaValues[cfg.kind].push("");
          renderMediaSlots();
          saveFormValues();
        };
      }
    }

    renderUploadLibrary();
  }

  function getFilledMedia(kind) {
    return (mediaValues[kind] || [])
      .map((v) => String(v || "").trim())
      .filter(Boolean);
  }

  /** @type {HTMLVideoElement | null} */
  let previewVideoEl = null;

  function getPreviewVideoEl() {
    if (!previewVideoEl) {
      previewVideoEl = document.createElement("video");
      previewVideoEl.setAttribute("controls", "");
      previewVideoEl.setAttribute("playsinline", "");
      previewVideoEl.muted = true;
      previewVideoEl.style.display = "none";
      previewWrap.appendChild(previewVideoEl);
    }
    return previewVideoEl;
  }

  function revokePreviewObjectUrls() {
    try {
      if (imageEl.src && imageEl.src.startsWith("blob:")) {
        URL.revokeObjectURL(imageEl.src);
      }
    } catch {
      /* ignore */
    }
    try {
      if (
        previewVideoEl &&
        previewVideoEl.src &&
        previewVideoEl.src.startsWith("blob:")
      ) {
        URL.revokeObjectURL(previewVideoEl.src);
      }
    } catch {
      /* ignore */
    }
  }

  const STORAGE_KEY = "local-image-generator.form.v2";
  let savedValues = null;
  let lastErrorText = "";

  // Remember last-selected model per method
  let perMethodModel = {};

  function setStatusMessage(text, isError = false) {
    statusEl.textContent = text || "";
    if (isError) {
      lastErrorText = text || "";
      copyErrorBtn?.classList.remove("hidden");
    } else {
      lastErrorText = "";
      copyErrorBtn?.classList.add("hidden");
    }
  }

  async function copyLastError() {
    if (!lastErrorText) return;
    try {
      await navigator.clipboard.writeText(lastErrorText);
      copyErrorBtn.title = "Copied";
      setTimeout(() => {
        if (copyErrorBtn) copyErrorBtn.title = "Copy error";
      }, 1200);
    } catch {
      setStatusMessage("Error: Could not copy error text", true);
    }
  }

  // ── Form persistence (only prompt and model; rest from API) ─────────────

  function collectFormValues() {
    return {
      prompt: form.prompt.value,
      model: modelSel.value,
      method: methodSel ? methodSel.value : "",
      seed: form.seed ? form.seed.value : undefined,
      denoise: form.denoise ? form.denoise.value : undefined,
      media_values: {
        image: [...(mediaValues.image || [])],
        video: [...(mediaValues.video || [])],
        audio: [...(mediaValues.audio || [])],
      },
      aspect_ratio: aspectRatioSel ? aspectRatioSel.value : undefined,
      duration_seconds: durationInput ? durationInput.value : undefined,
      start_offset_seconds: startOffsetInput
        ? startOffsetInput.value
        : undefined,
      perMethodModel,
    };
  }

  function saveFormValues() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collectFormValues()));
    } catch {
      // Ignore localStorage failures.
    }
  }

  function restoreSavedValues() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  // ── Preview state ─────────────────────────────────────

  function setPreviewIdle() {
    previewWrap.classList.remove("is-loading");
    imageEl.style.display = "none";
    if (previewVideoEl) {
      previewVideoEl.pause?.();
      previewVideoEl.style.display = "none";
      previewVideoEl.removeAttribute("src");
    }
    idleEl.classList.remove("hidden");
  }

  function setPreviewLoading() {
    previewWrap.classList.add("is-loading");
    imageEl.style.display = "none";
    if (previewVideoEl) {
      previewVideoEl.style.display = "none";
      previewVideoEl.removeAttribute("src");
    }
    idleEl.classList.add("hidden");
  }

  function setPreviewImage(src) {
    revokePreviewObjectUrls();
    previewWrap.classList.remove("is-loading");
    idleEl.classList.add("hidden");
    if (previewVideoEl) {
      previewVideoEl.style.display = "none";
      previewVideoEl.removeAttribute("src");
    }
    imageEl.src = src;
    imageEl.style.display = "block";
  }

  function setPreviewVideo(src) {
    revokePreviewObjectUrls();
    previewWrap.classList.remove("is-loading");
    idleEl.classList.add("hidden");
    imageEl.style.display = "none";
    const v = getPreviewVideoEl();
    v.src = src;
    v.style.display = "block";
    try {
      v.play?.();
    } catch {
      /* autoplay may be blocked */
    }
  }

  function renderMeta(data) {
    const modelLabel =
      typeof data.model === "string" && data.model.includes("/")
        ? data.model.split(/[\\/]/).pop()
        : (data.model ?? "—");
    const timeLabel =
      data.elapsed_ms != null && data.elapsed_ms !== "—"
        ? `${data.elapsed_ms}\u202fms`
        : (data.elapsed_ms ?? "—");
    const items = [
      ["family", data.family ?? "—"],
      ["model", modelLabel],
      ["seed", data.seed ?? "—"],
      ["time", timeLabel],
    ];
    metaRowEl.innerHTML = items
      .map(
        ([k, v]) =>
          `<span class="chip"><span class="chip-k">${k}</span>${v}</span>`,
      )
      .join("");
  }

  // ── Capability-driven model select ─────────────────────

  async function loadCapabilitiesAndModels() {
    try {
      const res = await apiFetch("/api", { method: "GET" });
      const data = await res.json();
      if (data?.retention?.input_ttl_seconds) {
        inputTtlSeconds = Number(data.retention.input_ttl_seconds) || 86400;
      }
      if (Array.isArray(data?.capability_matrix)) {
        capabilityMatrix = data.capability_matrix;
      }
      const methods = data && data.methods;

      if (
        !methods ||
        typeof methods !== "object" ||
        Array.isArray(methods) ||
        Object.keys(methods).length === 0
      ) {
        throw new Error("Provider did not return any methods.");
      }

      // Populate method selector
      const methodIds = Object.keys(methods);
      methodSel.innerHTML = "";
      for (const id of methodIds) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        methodSel.appendChild(opt);
      }

      // Restore per-method model memory
      if (savedValues && savedValues.perMethodModel) {
        perMethodModel =
          typeof savedValues.perMethodModel === "object"
            ? { ...savedValues.perMethodModel }
            : {};
      }

      // Restore saved method or pick default
      let initialMethod = methodIds[0];
      if (
        savedValues &&
        typeof savedValues.method === "string" &&
        methodIds.includes(savedValues.method)
      ) {
        initialMethod = savedValues.method;
      } else if (methodIds.includes("text2image")) {
        initialMethod = "text2image";
      }
      methodSel.value = initialMethod;

      function rebuildAspectRatioForMethod(methodId, preferredRatio) {
        if (!aspectRatioSel) return;
        const methodDef = methods[methodId];
        const field = methodDef?.fields?.aspect_ratio;
        const options = field?.options || [];
        aspectRatioSel.innerHTML = "";
        if (!options.length) {
          if (aspectRatioField) aspectRatioField.style.display = "none";
          return;
        }
        if (aspectRatioField) aspectRatioField.style.display = "";
        for (const o of options) {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = o.label || o.value;
          aspectRatioSel.appendChild(opt);
        }
        const defaultValue =
          typeof field?.default === "string" ? field.default : options[0]?.value;
        let pick = defaultValue || "";
        if (
          preferredRatio &&
          options.some((o) => o.value === preferredRatio)
        ) {
          pick = preferredRatio;
        }
        if (pick) aspectRatioSel.value = pick;
      }

      function rebuildDurationForMethod(methodId, preferredDuration) {
        if (!durationInput || !durationField) return;
        const field = methods[methodId]?.fields?.duration_seconds;
        if (!field || field.hidden) {
          durationField.style.display = "none";
          durationInput.value = "";
          return;
        }
        durationField.style.display = "";
        if (field.min != null) durationInput.min = String(field.min);
        if (field.max != null) durationInput.max = String(field.max);
        if (field.step != null) durationInput.step = String(field.step);
        durationInput.placeholder =
          field.default != null ? String(field.default) : "default";
        if (
          preferredDuration != null &&
          preferredDuration !== "" &&
          !Number.isNaN(Number(preferredDuration))
        ) {
          durationInput.value = String(preferredDuration);
        } else if (field.default != null) {
          durationInput.value = String(field.default);
        } else {
          durationInput.value = "";
        }
      }

      function rebuildStartOffsetForMethod(methodId, preferredOffset) {
        if (!startOffsetInput || !startOffsetField) return;
        const field = methods[methodId]?.fields?.start_offset_seconds;
        if (!field || field.hidden) {
          startOffsetField.style.display = "none";
          startOffsetInput.value = "";
          return;
        }
        startOffsetField.style.display = "";
        if (field.min != null) startOffsetInput.min = String(field.min);
        if (field.max != null) startOffsetInput.max = String(field.max);
        if (field.step != null) startOffsetInput.step = String(field.step);
        startOffsetInput.placeholder =
          field.default != null ? String(field.default) : "0";
        if (
          preferredOffset != null &&
          preferredOffset !== "" &&
          !Number.isNaN(Number(preferredOffset))
        ) {
          startOffsetInput.value = String(preferredOffset);
        } else if (field.default != null) {
          startOffsetInput.value = String(field.default);
        } else {
          startOffsetInput.value = "";
        }
      }

      function rebuildModelsForMethod(methodId, preferredModelId) {
        const methodDef = methods[methodId];
        const modelField = methodDef?.fields?.model;
        const options = modelField?.options || [];
        modelSel.innerHTML = "";
        let firstValue = null;
        for (const o of options) {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = o.label || o.value;
          modelSel.appendChild(opt);
          if (!firstValue) firstValue = o.value;
        }
        let pick = null;
        if (
          preferredModelId &&
          options.some((o) => o.value === preferredModelId)
        ) {
          pick = preferredModelId;
        } else if (
          perMethodModel[methodId] &&
          options.some((o) => o.value === perMethodModel[methodId])
        ) {
          pick = perMethodModel[methodId];
        } else if (firstValue) {
          pick = firstValue;
        }
        if (pick) modelSel.value = pick;
        return pick;
      }

      // Initial model selection
      let preferredModelId =
        savedValues && typeof savedValues.model === "string"
          ? savedValues.model
          : null;
      const initialModel = rebuildModelsForMethod(
        initialMethod,
        preferredModelId,
      );
      if (initialModel) {
        perMethodModel[initialMethod] = initialModel;
      }

      rebuildAspectRatioForMethod(
        initialMethod,
        savedValues && typeof savedValues.aspect_ratio === "string"
          ? savedValues.aspect_ratio
          : null,
      );
      rebuildDurationForMethod(
        initialMethod,
        savedValues && savedValues.duration_seconds != null
          ? savedValues.duration_seconds
          : null,
      );
      rebuildStartOffsetForMethod(
        initialMethod,
        savedValues && savedValues.start_offset_seconds != null
          ? savedValues.start_offset_seconds
          : null,
      );

      // Restore prompt, media slots, denoise
      if (savedValues && savedValues.prompt != null)
        form.prompt.value = savedValues.prompt;
      if (savedValues && savedValues.seed != null && form.seed)
        form.seed.value = savedValues.seed;
      if (savedValues && savedValues.media_values) {
        const mv = savedValues.media_values;
        mediaValues = {
          image: Array.isArray(mv.image) ? mv.image.map(String) : [""],
          video: Array.isArray(mv.video) ? mv.video.map(String) : [],
          audio: Array.isArray(mv.audio) ? mv.audio.map(String) : [],
        };
      } else {
        // Migrate older single-field saves
        const images = [];
        if (typeof savedValues?.input_images === "string" && savedValues.input_images) {
          images.push(savedValues.input_images);
        }
        if (
          typeof savedValues?.input_end_image === "string" &&
          savedValues.input_end_image
        ) {
          images.push(savedValues.input_end_image);
        }
        mediaValues = {
          image: images.length ? images : [""],
          video:
            typeof savedValues?.input_video_urls === "string" &&
            savedValues.input_video_urls
              ? [savedValues.input_video_urls]
              : [],
          audio:
            typeof savedValues?.input_audio_urls === "string" &&
            savedValues.input_audio_urls
              ? [savedValues.input_audio_urls]
              : [],
        };
      }
      if (savedValues && savedValues.denoise != null && form.denoise)
        form.denoise.value = savedValues.denoise;

      // Apply field visibility now that method is known
      updateFieldVisibility();
      renderUploadLibrary();

      // Events
      methodSel.addEventListener("change", () => {
        const methodId = methodSel.value;
        const pick = rebuildModelsForMethod(
          methodId,
          perMethodModel[methodId] || null,
        );
        if (pick) perMethodModel[methodId] = pick;
        rebuildAspectRatioForMethod(methodId, null);
        rebuildDurationForMethod(methodId, null);
        rebuildStartOffsetForMethod(methodId, null);
        saveFormValues();
        updateFamilyBadge();
        updateFieldVisibility();
      });

      modelSel.addEventListener("change", () => {
        const methodId = methodSel.value;
        if (methodId) {
          perMethodModel[methodId] = modelSel.value;
        }
        saveFormValues();
        updateFamilyBadge();
        updateFieldVisibility();
      });

      updateFamilyBadge();
      saveFormValues();
    } catch (err) {
      modelSel.innerHTML = '<option value="">Failed to load models</option>';
      setStatusMessage("Error loading capabilities: " + err.message, true);
    }
  }

  function updateFamilyBadge() {
    const opt = modelSel.options[modelSel.selectedIndex];
    const label = opt ? opt.textContent : "";
    // Label is "family: modelName" from GET /api options.
    badge.textContent = label.includes(":") ? label.split(":")[0].trim() : "";
  }

  // ── Events ────────────────────────────────────────────

  form.prompt.addEventListener("input", saveFormValues);
  form.seed?.addEventListener("input", saveFormValues);
  aspectRatioSel?.addEventListener("change", saveFormValues);
  durationInput?.addEventListener("input", saveFormValues);
  form.model.addEventListener("change", () => {
    updateFamilyBadge();
    saveFormValues();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    revokePreviewObjectUrls();
    setStatusMessage("Generating…");
    setPreviewLoading();
    metaRowEl.innerHTML = "";

    const method = methodSel.value;
    const body = {
      prompt: form.prompt.value.trim(),
      model: modelSel.value,
    };

    const seedRaw = form.seed ? form.seed.value.trim() : "";
    if (seedRaw) {
      const seedVal = Number(seedRaw);
      if (Number.isInteger(seedVal) && seedVal >= 0) {
        body.seed = seedVal;
      } else {
        setPreviewIdle();
        setStatusMessage("Error: Seed must be a non-negative integer", true);
        return;
      }
    }

    // Only send denoise for image2image
    if (method === "image2image") {
      const denoiseVal = form.denoise && form.denoise.value.trim();
      if (denoiseVal !== "" && !isNaN(Number(denoiseVal))) {
        body.denoise = Number(denoiseVal);
      }
    }

    const images = getFilledMedia("image");
    const videos = getFilledMedia("video");
    const audios = getFilledMedia("audio");

    if (method === "audio2video") {
      if (!audios.length) {
        setPreviewIdle();
        setStatusMessage(
          "Error: Input audio is required (URL, data URI, or upload)",
          true,
        );
        return;
      }
      body.input_audio_urls = audios;
      if (images.length) body.input_images = images;
    } else if (method === "video2video") {
      if (!videos.length) {
        setPreviewIdle();
        setStatusMessage("Error: Input video is required (URL or upload)", true);
        return;
      }
      body.input_video_urls = videos;
      if (images.length) body.input_images = images;
    } else if (method === "reference2video") {
      if (!images.length && !videos.length) {
        setPreviewIdle();
        setStatusMessage(
          "Error: reference2video needs at least one image or video",
          true,
        );
        return;
      }
      if (images.length) body.input_images = images;
      if (videos.length) body.input_video_urls = videos;
      if (audios.length) body.input_audio_urls = audios;
    } else if (method === "image2image" || method === "image2video") {
      if (!images.length) {
        setPreviewIdle();
        setStatusMessage("Error: Input image is required", true);
        return;
      }
      body.input_images = images;
    }

    // Keep aspect_ratio aligned with the primary input image when present.
    if (images.length) {
      await syncAspectRatioFromPrimaryImage();
    }
    if (aspectRatioSel && aspectRatioSel.value) {
      body.aspect_ratio = aspectRatioSel.value;
    }

    if (durationInput && durationField && durationField.style.display !== "none") {
      const durRaw = durationInput.value.trim();
      if (durRaw !== "") {
        const dur = Number(durRaw);
        if (!Number.isFinite(dur) || dur <= 0) {
          setPreviewIdle();
          setStatusMessage("Error: Duration must be a positive number", true);
          return;
        }
        body.duration_seconds = dur;
      }
    }

    if (
      startOffsetInput &&
      startOffsetField &&
      startOffsetField.style.display !== "none"
    ) {
      const offRaw = startOffsetInput.value.trim();
      if (offRaw !== "") {
        const off = Number(offRaw);
        if (!Number.isFinite(off) || off < 0) {
          setPreviewIdle();
          setStatusMessage(
            "Error: Start offset must be zero or a positive number",
            true,
          );
          return;
        }
        body.start_offset_seconds = off;
      }
    }

    try {
      // Provider API: start job (POST /api with method + args, no job_id).
      const startRes = await apiFetch("/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          args: body,
        }),
      });
      const startData = await startRes.json();
      if (startRes.status !== 202 || !startData.job_id) {
        throw new Error(startData.error || "Failed to start job");
      }

      // Server resets staged-file TTL on use; mirror that in the local library.
      const usedRefs = [...images, ...videos, ...audios].filter((u) =>
        String(u).includes("/api/files/"),
      );
      bumpLibraryTtlForUrls(usedRefs);

      const jobId = startData.job_id;

      // Poll until done (202 → still pending, 200 → image binary or JSON error).
      for (;;) {
        const pollRes = await apiFetch("/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method,
            args: { job_id: jobId },
          }),
        });

        if (pollRes.status === 202) {
          // Check for status in response body
          const pollData = await pollRes.json().catch(() => ({}));
          const status = pollData.status || "";
          if (status === "pending" || status === "running") {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
        }

        if (pollRes.status === 200) {
          const contentType = (
            pollRes.headers.get("Content-Type") || ""
          ).split(";")[0].trim();
          if (contentType.includes("image/png")) {
            const blob = await pollRes.blob();
            const url = URL.createObjectURL(blob);
            setPreviewImage(url);
            const meta = {
              family:
                pollRes.headers.get("X-Family") ?? badge.textContent ?? "—",
              model:
                pollRes.headers.get("X-Model") ??
                modelSel.selectedOptions[0]?.textContent
                  ?.split(":")[1]
                  ?.trim() ??
                "—",
              seed: pollRes.headers.get("X-Seed") ?? "—",
              elapsed_ms: pollRes.headers.get("X-Elapsed-Ms") ?? "—",
            };
            renderMeta(meta);
            setStatusMessage("Done.");
          } else if (contentType.toLowerCase().startsWith("video/")) {
            const blob = await pollRes.blob();
            const typedBlob =
              blob.type && blob.type.startsWith("video/")
                ? blob
                : new Blob([await blob.arrayBuffer()], { type: contentType });
            const url = URL.createObjectURL(typedBlob);
            setPreviewVideo(url);
            const meta = {
              family: badge.textContent ?? "—",
              model:
                modelSel.selectedOptions[0]?.textContent?.split(":")[1]?.trim() ??
                "—",
              seed: body.seed != null ? String(body.seed) : "—",
              elapsed_ms: pollRes.headers.get("X-Elapsed-Ms") ?? "—",
            };
            renderMeta(meta);
            setStatusMessage("Done.");
          } else {
            const pollData = await pollRes.json();
            const status = pollData.status || "";
            // If still running or pending, keep polling
            if (
              (status === "running" || status === "pending") &&
              !pollData.result
            ) {
              await new Promise((r) => setTimeout(r, 1500));
              continue;
            }
            throw new Error(
              pollData.result?.error || pollData.error || "Job failed",
            );
          }
          break;
        }

        const pollData = await pollRes.json().catch(() => ({}));
        throw new Error(pollData.error || "Poll failed");
      }
    } catch (err) {
      setPreviewIdle();
      setStatusMessage("Error: " + (err.message || "Unknown"), true);
    }
  });

  copyErrorBtn?.addEventListener("click", copyLastError);

  // ── Show/hide media fields based on method ──
  function updateFieldVisibility() {
    renderMediaSlots();
    const denoiseField = document.getElementById("denoise-field");
    if (denoiseField) {
      denoiseField.style.display =
        methodSel.value === "image2image" ? "" : "none";
    }
  }
  methodSel.addEventListener("change", updateFieldVisibility);
  // ── Init ──────────────────────────────────────────────

  savedValues = restoreSavedValues();
  setPreviewIdle();
  renderUploadLibrary();
  loadCapabilitiesAndModels();
}

// Boot sequence
document.addEventListener("DOMContentLoaded", () => {
  initTokenForm();
  const creds = getStoredCredentials();
  if (!creds) {
    showTokenGate();
  } else {
    showAppRoot();
    initApp();
  }
});
