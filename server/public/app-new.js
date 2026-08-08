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
  const uploadLibraryEl = document.getElementById("upload-library");

  const UPLOAD_LIBRARY_KEY = "local-image-generator.uploads.v1";
  let inputTtlSeconds = 86400;
  /** @type {Array<object>} */
  let capabilityMatrix = [];
  /** @type {{ image: string[], video: string[], audio: string[] }} */
  let mediaValues = { image: [""], video: [], audio: [] };

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
    };
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
    if (h >= 48) return `${Math.floor(h / 24)}d left`;
    if (h >= 1) return `${h}h left`;
    const m = Math.max(1, Math.floor(ms / 60000));
    return `${m}m left`;
  }

  function renderUploadLibrary() {
    if (!uploadLibraryEl) return;
    const items = pruneUploadLibrary(loadUploadLibrary());
    saveUploadLibrary(items);
    uploadLibraryEl.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "upload-library-empty";
      empty.textContent = "No uploads yet — use a slot’s file picker.";
      uploadLibraryEl.appendChild(empty);
      return;
    }
    for (const it of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "upload-library-item";
      const expired =
        it.expires_at && Date.parse(it.expires_at) <= Date.now();
      if (expired) btn.classList.add("is-expired");
      btn.innerHTML = `<span class="ul-kind">${it.kind || "?"}</span><span class="ul-name" title="${it.url}">${it.label || it.filename || it.url}</span><span class="ul-exp">${formatExpiresShort(it.expires_at)}</span>`;
      btn.addEventListener("click", () => assignLibraryItem(it));
      uploadLibraryEl.appendChild(btn);
    }
  }

  async function assignLibraryItem(item) {
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
    // Touch server TTL + refresh expires_at
    try {
      const path = item.url.startsWith("/") ? item.url : `/api/files/${encodeURIComponent(item.filename || "")}`;
      const res = await apiFetch(path, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Drop stale library entry
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
      });
      item = { ...item, url: data.url || item.url, expires_at: data.expires_at };
    } catch (err) {
      setStatusMessage("Library error: " + (err.message || "Unknown"), true);
      return;
    }

    const arr = mediaValues[kind] || [];
    let idx = arr.findIndex((v) => !String(v || "").trim());
    if (idx < 0) {
      if (arr.length >= max) {
        setStatusMessage(`All ${kind} slots are full (max ${max}).`, true);
        return;
      }
      arr.push(item.url);
    } else {
      arr[idx] = item.url;
    }
    mediaValues[kind] = arr;
    renderMediaSlots();
    saveFormValues();
    setStatusMessage(`Filled ${kind} slot from library.`);
  }

  async function uploadFileToApi(file) {
    if (!file) return null;
    const formData = new FormData();
    formData.append("content", file, file.name || "upload.bin");
    const res = await apiFetch("/api/files", {
      method: "POST",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
    const url =
      data.url ||
      (data.filename
        ? `/api/files/${encodeURIComponent(data.filename)}`
        : "");
    if (!url) throw new Error("Upload succeeded but no file URL was returned.");
    rememberUpload({
      ...data,
      url,
      label: file.name || data.filename,
      originalName: file.name,
      uploaded_at: new Date().toISOString(),
    });
    return { url, data };
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
        labelImages: "Reference images",
        labelVideos: "Reference videos",
        labelAudios: "Reference audio",
        hintImages: "MiniMax: up to 9. Prompt tags: <Picture 1>…",
        hintVideos: "MiniMax: up to 3. Prompt tags: <Video 1>…",
        hintAudios: "MiniMax: up to 3 (needs image or video). <Audio 1>…",
      };
    }
    if (method === "image2video") {
      return {
        maxImages: 2,
        maxVideos: 0,
        maxAudios: 0,
        imagesRequired: true,
        labelImages: "Start / end images",
        hintImages: "Slot 1 = start frame; slot 2 = optional end frame (FLF).",
      };
    }
    if (method === "image2image") {
      return {
        maxImages: 1,
        maxVideos: 0,
        maxAudios: 0,
        imagesRequired: true,
        labelImages: "Input image",
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
        labelImages: "Input image (optional)",
        labelAudios: "Input audio",
        hintAudios: "Required.",
      };
    }
    if (method === "video2video") {
      return {
        maxImages: 1,
        maxVideos: 1,
        maxAudios: 0,
        videosRequired: true,
        labelImages: "Character image (wan_motion)",
        labelVideos: "Input video",
        hintVideos: "Required.",
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
      if (next.length === 0 && max > 0 && minSlots > 0) next.push("");
      return next;
    };
    const imgMin =
      limits.imagesRequired || methodSel.value === "image2video" ? 1 : 0;
    const vidMin = limits.videosRequired ? 1 : 0;
    const audMin = limits.audiosRequired ? 1 : 0;
    // For reference2video show at least one empty image slot when images allowed
    const imgFloor =
      methodSel.value === "reference2video" && limits.maxImages > 0
        ? Math.max(imgMin, 1)
        : imgMin;

    mediaValues.image = clamp(mediaValues.image, limits.maxImages, imgFloor);
    mediaValues.video = clamp(mediaValues.video, limits.maxVideos, vidMin);
    mediaValues.audio = clamp(mediaValues.audio, limits.maxAudios, audMin);
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
        placeholder: "https://…, data:…, or upload",
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
        placeholder: "https://… or upload (no data URI)",
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
        placeholder: "https://…, data:…, or upload",
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
      if (labelEl) {
        const n = (mediaValues[cfg.kind] || []).filter((v) =>
          String(v || "").trim(),
        ).length;
        labelEl.textContent = `${cfg.label} (${n}/${cfg.max})`;
      }
      if (hintEl) hintEl.textContent = cfg.hint || "";

      list.innerHTML = "";
      const values = mediaValues[cfg.kind] || [];
      values.forEach((value, idx) => {
        const row = document.createElement("div");
        row.className = "media-slot";

        const text = document.createElement("input");
        text.type = "text";
        text.placeholder = cfg.placeholder;
        text.value = value || "";
        text.autocomplete = "off";
        text.addEventListener("input", () => {
          mediaValues[cfg.kind][idx] = text.value;
          saveFormValues();
          const label = document.getElementById(cfg.labelId);
          if (label) {
            const n = (mediaValues[cfg.kind] || []).filter((v) =>
              String(v || "").trim(),
            ).length;
            label.textContent = `${cfg.label} (${n}/${cfg.max})`;
          }
        });

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
              mediaValues[cfg.kind][idx] = result.url;
              text.value = result.url;
              saveFormValues();
              renderMediaSlots();
              setStatusMessage("Uploaded.");
            }
          } catch (err) {
            setStatusMessage("Upload error: " + (err.message || "Unknown"), true);
          } finally {
            file.value = "";
          }
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "media-slot-remove";
        remove.textContent = "✕";
        remove.title = "Remove slot";
        remove.addEventListener("click", () => {
          mediaValues[cfg.kind].splice(idx, 1);
          renderMediaSlots();
          saveFormValues();
        });

        row.appendChild(text);
        row.appendChild(file);
        row.appendChild(remove);
        list.appendChild(row);
      });

      if (addBtn) {
        addBtn.style.display = values.length < cfg.max ? "" : "none";
        addBtn.onclick = () => {
          if ((mediaValues[cfg.kind] || []).length >= cfg.max) return;
          mediaValues[cfg.kind].push("");
          renderMediaSlots();
          saveFormValues();
        };
      }
    }
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

    if (aspectRatioSel && aspectRatioSel.value) {
      body.aspect_ratio = aspectRatioSel.value;
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
