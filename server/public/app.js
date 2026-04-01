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
    throw new Error(
      "Unauthorized: token or access credentials invalid or missing.",
    );
  }
  return res;
}

const form = document.getElementById("gen-form");
const modelSel = document.getElementById("model");
const methodSel = document.getElementById("method");
const badge = document.getElementById("family-badge");
const statusEl = document.getElementById("status");
const copyErrorBtn = document.getElementById("copy-error-btn");
const randomizeSeedBtn = document.getElementById("randomize-seed-btn");
const previewWrap = document.getElementById("preview-wrap");
const idleEl = document.getElementById("preview-idle");
const imageEl = document.getElementById("image");
const metaRowEl = document.getElementById("meta-row");
const STORAGE_KEY = "local-image-generator.form.v2";

let modelRegistry = {};
// Remember last-selected model per method (e.g. text2img, image2image).
let perMethodModel = {};
// Capabilities document from GET /api/models (methods + fields).
let capabilitiesMethods = null;
/** @type {{ ok?: boolean, models?: object[] } | null} */
let lastModelsPayload = null;
let savedValues = null;
let lastErrorText = "";
let appInitialized = false;

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

function randomizeSeed() {
  const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
  form.seed.value = String(seed);
  saveFormValues();
}

// ── Form persistence ──────────────────────────────────

function collectFormValues() {
  return {
    prompt: form.prompt.value,
    negative_prompt: form.negative_prompt.value,
    model: modelSel.value,
    width: form.width.value,
    height: form.height.value,
    steps: form.steps.value,
    cfg: form.cfg.value,
    seed: form.seed.value,
    method: methodSel ? methodSel.value : "",
    input_images: form.input_images ? form.input_images.value : "",
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

function updateFamilyBadge() {
  const entry = modelRegistry[modelSel.value];
  badge.textContent = entry ? entry.family : "";
}

// ── Capabilities loading (GET /api/models) ──────────────

async function loadCapabilities() {
  if (capabilitiesMethods) return capabilitiesMethods;
  const res = await apiFetch("/api/models", { method: "GET" });
  const data = await res.json();
  if (!data || data.ok === false) {
    throw new Error("Bad /api/models response");
  }
  lastModelsPayload = data;
  modelRegistry = {};
  if (Array.isArray(data.models)) {
    for (const m of data.models) {
      if (m && typeof m.modelId === "string") {
        modelRegistry[m.modelId] = m;
      }
    }
  }
  const methods =
    data && data.methods && typeof data.methods === "object"
      ? data.methods
      : {};
  capabilitiesMethods = methods;
  return methods;
}

function modelSupportsMethod(entry, method) {
  const methods =
    Array.isArray(entry.methods) && entry.methods.length > 0
      ? entry.methods
      : ["text2img"];
  return methods.includes(method);
}

function getAllMethodsFromModels(models) {
  const order = ["text2img", "image2image", "text2video", "image2video"];
  const seen = new Set();
  const out = [];
  for (const m of models) {
    const methods =
      Array.isArray(m.methods) && m.methods.length > 0
        ? m.methods
        : ["text2img"];
    for (const meth of methods) {
      if (!seen.has(meth)) {
        seen.add(meth);
        out.push(meth);
      }
    }
  }
  out.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return out;
}

function rebuildModelOptionsForMethod(method, preferredId) {
  modelSel.innerHTML = "";
  const groups = {};
  for (const m of Object.values(modelRegistry)) {
    if (!modelSupportsMethod(m, method)) continue;
    (groups[m.family] ??= []).push(m);
  }

  let firstValue = null;
  for (const [family, models] of Object.entries(groups)) {
    const grp = document.createElement("optgroup");
    grp.label = family.toUpperCase();
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.modelId;
      opt.textContent = m.name;
      grp.appendChild(opt);
      if (!firstValue) firstValue = m.modelId;
    }
    modelSel.appendChild(grp);
  }

  let pick = null;
  if (
    preferredId &&
    modelRegistry[preferredId] &&
    modelSupportsMethod(modelRegistry[preferredId], method)
  ) {
    pick = preferredId;
  } else if (
    perMethodModel[method] &&
    modelRegistry[perMethodModel[method]] &&
    modelSupportsMethod(modelRegistry[perMethodModel[method]], method)
  ) {
    pick = perMethodModel[method];
  } else if (firstValue) {
    pick = firstValue;
  }

  if (pick) modelSel.value = pick;
  return pick;
}

function updateFieldVisibility() {
  const imageField = form.input_images && form.input_images.closest(".field");
  const denoiseField = document.getElementById("denoise-field");
  if (!imageField || !methodSel || !denoiseField) return;
  const method = methodSel.value;
  const entry = modelRegistry[modelSel.value];
  if (!entry) {
    imageField.style.display = "none";
    denoiseField.style.display = "none";
    return;
  }
  const isImageMethod = method === "image2image" || method === "image2video";
  const supports = isImageMethod && modelSupportsMethod(entry, method);
  imageField.style.display = supports ? "" : "none";
  denoiseField.style.display = method === "image2image" ? "" : "none";
}

// ── Preview state ─────────────────────────────────────

function setPreviewIdle() {
  previewWrap.classList.remove("is-loading");
  imageEl.style.display = "none";
  idleEl.classList.remove("hidden");
}

function setPreviewLoading() {
  previewWrap.classList.add("is-loading");
  imageEl.style.display = "none";
  idleEl.classList.add("hidden");
}

function setPreviewImage(src) {
  previewWrap.classList.remove("is-loading");
  idleEl.classList.add("hidden");
  imageEl.src = src;
  imageEl.style.display = "block";
}

// ── Metadata chips ────────────────────────────────────

function renderMeta(data) {
  const items = [
    ["family", data.family],
    ["model", data.model.split(/[\\/]/).pop()],
    ["backend", data.backend || "comfy"],
    ["seed", data.seed],
    ["time", data.elapsed_ms + "\u202fms"],
  ];
  metaRowEl.innerHTML = items
    .map(
      ([k, v]) =>
        `<span class="chip"><span class="chip-k">${k}</span>${v}</span>`,
    )
    .join("");
}

function normalizeErrorText(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim();
}

async function readResponseBodyForError(res) {
  const contentType = (res.headers.get("Content-Type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => null);
    if (data && typeof data === "object") {
      const error =
        typeof data.error === "string"
          ? data.error
          : typeof data.message === "string"
            ? data.message
            : "";
      return normalizeErrorText(error);
    }
    return "";
  }

  const text = await res.text().catch(() => "");
  return normalizeErrorText(text);
}

function formatGenerateHttpError(status, bodyText) {
  if (
    status === 524 ||
    /\b524\b/.test(bodyText) ||
    /cloudflare/i.test(bodyText)
  ) {
    return "Request timed out (HTTP 524). Generation may still be running. Wait a bit, then check Service status or retry.";
  }

  if (status === 504) {
    return "Gateway timeout (HTTP 504). The server took too long to respond. Please retry.";
  }

  if (bodyText) {
    return bodyText.length > 300 ? bodyText.slice(0, 300) + "…" : bodyText;
  }

  return `Generation failed with HTTP ${status}.`;
}

// ── Model loading ─────────────────────────────────────

async function loadModels() {
  try {
    const methods = await loadCapabilities();
    const methodIds = Object.keys(methods);
    if (!methodIds.length) throw new Error("No methods from /api");

    if (savedValues && savedValues.perMethodModel) {
      perMethodModel =
        typeof savedValues.perMethodModel === "object"
          ? { ...savedValues.perMethodModel }
          : {};
    }

    const savedMethod =
      savedValues && typeof savedValues.method === "string"
        ? savedValues.method
        : null;
    const currentMethod =
      savedMethod && methodIds.includes(savedMethod)
        ? savedMethod
        : methodIds[0];

    if (methodSel) {
      methodSel.innerHTML = "";
      for (const id of methodIds) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        methodSel.appendChild(opt);
      }
      methodSel.value = currentMethod;
    }

    function rebuildModelsForMethod(methodId, preferredModelId) {
      const caps = methods[methodId];
      const options = caps?.fields?.model?.options || [];
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

    const preferredModelId =
      savedValues && typeof savedValues.model === "string"
        ? savedValues.model
        : null;
    const initialModel = rebuildModelsForMethod(
      currentMethod,
      preferredModelId,
    );
    if (initialModel) {
      perMethodModel[currentMethod] = initialModel;
      // Apply defaults for initial model
      const entry = modelRegistry[initialModel];
      if (entry?.defaults) {
        let changed = false;
        if (entry.defaults.width != null) {
          form.width.value = entry.defaults.width;
          changed = true;
        }
        if (entry.defaults.height != null) {
          form.height.value = entry.defaults.height;
          changed = true;
        }
        if (entry.defaults.steps != null) {
          form.steps.value = entry.defaults.steps;
          changed = true;
        }
        if (entry.defaults.cfg != null) {
          form.cfg.value = entry.defaults.cfg;
          changed = true;
        }
        if (changed) {
          console.log("Applied model defaults (initial):", {
            width: entry.defaults.width,
            height: entry.defaults.height,
            steps: entry.defaults.steps,
            cfg: entry.defaults.cfg,
            model: entry.modelId,
          });
        }
      }
    }

    function updateImageFieldVisibility(methodId) {
      const field = form.input_images && form.input_images.closest(".field");
      if (!field) return;
      const caps = methods[methodId];
      const hasImageUrlField =
        caps &&
        caps.fields &&
        caps.fields.input_images &&
        caps.fields.input_images.type === "image_url_array";
      field.style.display = hasImageUrlField ? "" : "none";
    }

    updateImageFieldVisibility(currentMethod);

    if (savedValues) {
      const f = savedValues;
      if (f.prompt != null) form.prompt.value = f.prompt;
      if (f.negative_prompt != null)
        form.negative_prompt.value = f.negative_prompt;
      if (f.width != null) form.width.value = f.width;
      if (f.height != null) form.height.value = f.height;
      if (f.steps != null) form.steps.value = f.steps;
      if (f.cfg != null) form.cfg.value = f.cfg;
      if (f.seed != null) form.seed.value = f.seed;
      if (form.input_images) {
        const savedInputImages =
          typeof f.input_images === "string" ? f.input_images : "";
        form.input_images.value = savedInputImages;
      }
    }

    if (!loadModels._wiredEvents) {
      if (methodSel) {
        methodSel.addEventListener("change", () => {
          const methodId = methodSel.value;
          const prevModel = modelSel.value;
          const pick = rebuildModelsForMethod(
            methodId,
            perMethodModel[methodId] || null,
          );
          if (pick) perMethodModel[methodId] = pick;
          // Apply defaults if model changed
          if (pick && pick !== prevModel) {
            const entry = modelRegistry[pick];
            if (entry?.defaults) {
              let changed = false;
              if (entry.defaults.width != null) {
                form.width.value = entry.defaults.width;
                changed = true;
              }
              if (entry.defaults.height != null) {
                form.height.value = entry.defaults.height;
                changed = true;
              }
              if (entry.defaults.steps != null) {
                form.steps.value = entry.defaults.steps;
                changed = true;
              }
              if (entry.defaults.cfg != null) {
                form.cfg.value = entry.defaults.cfg;
                changed = true;
              }
              if (changed) {
                console.log("Applied model defaults (method switch):", {
                  width: entry.defaults.width,
                  height: entry.defaults.height,
                  steps: entry.defaults.steps,
                  cfg: entry.defaults.cfg,
                  model: entry.modelId,
                });
              }
            }
          }
          updateFieldVisibility();
          saveFormValues();
        });
      }

      modelSel.addEventListener("change", () => {
        const methodId = methodSel ? methodSel.value : null;
        if (methodId) {
          perMethodModel[methodId] = modelSel.value;
        }
        // Apply per-model defaults if available
        const entry = modelRegistry[modelSel.value];
        console.log("Selected model entry:", entry);
        if (entry?.defaults) {
          let changed = false;
          if (entry.defaults.width != null) {
            form.width.value = entry.defaults.width;
            changed = true;
          }
          if (entry.defaults.height != null) {
            form.height.value = entry.defaults.height;
            changed = true;
          }
          if (entry.defaults.steps != null) {
            form.steps.value = entry.defaults.steps;
            changed = true;
          }
          if (entry.defaults.cfg != null) {
            form.cfg.value = entry.defaults.cfg;
            changed = true;
          }
          if (changed) {
            console.log("Applied model defaults:", {
              width: entry.defaults.width,
              height: entry.defaults.height,
              steps: entry.defaults.steps,
              cfg: entry.defaults.cfg,
              model: entry.modelId,
            });
          }
        }
        saveFormValues();
      });

      loadModels._wiredEvents = true;
    }

    updateFamilyBadge();
    saveFormValues();
  } catch (e) {
    modelSel.innerHTML = '<option value="">Failed to load models</option>';
    setStatusMessage("Error loading capabilities: " + e.message, true);
  }
}

function applyModelDefaults() {
  // With capabilities-driven loading, we no longer pull per-model numeric
  // defaults from /api/models; keep this as a thin wrapper to update the badge
  // and persist the selection.
  updateFamilyBadge();
  saveFormValues();
}

function initTokenForm() {
  const tokenForm = document.getElementById("token-form");
  if (!tokenForm) return;

  const textarea = document.getElementById("credentials-json");
  if (textarea) {
    const stored = getStoredCredentials();
    if (stored) {
      textarea.value = JSON.stringify(stored, null, 2);
    }
  }

  tokenForm.addEventListener("submit", (e) => {
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
    } catch {
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

    setStoredCredentials({
      token,
      cfAccessClientId: cfId,
      cfAccessClientSecret: cfSecret,
    });

    showAppRoot();
    if (!appInitialized) {
      appInitialized = true;
      savedValues = restoreSavedValues();
      loadModels();
    }
  });
}

// ── Events ────────────────────────────────────────────

[
  "prompt",
  "negative_prompt",
  "width",
  "height",
  "steps",
  "cfg",
  "seed",
  "method",
  "input_images",
].forEach((n) => form[n] && form[n].addEventListener("input", saveFormValues));
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatusMessage("Generating…");
  setPreviewLoading();
  metaRowEl.innerHTML = "";
  const longRunHintTimer = setTimeout(() => {
    if (statusEl.textContent === "Generating…") {
      setStatusMessage(
        "Still generating… some models take extra time to decode and save the image.",
      );
    }
  }, 12000);

  const body = {
    prompt: form.prompt.value.trim(),
    negative_prompt: form.negative_prompt.value.trim(),
    model: modelSel.value,
    width: Number(form.width.value),
    height: Number(form.height.value),
    steps: Number(form.steps.value),
    cfg: Number(form.cfg.value),
    method: methodSel ? methodSel.value : undefined,
  };

  const imageUrl = form.input_images ? form.input_images.value.trim() : "";
  if (imageUrl) {
    body.input_images = [imageUrl];
  }

  // Only send denoise for image2image
  if (methodSel && methodSel.value === "image2image") {
    const denoiseVal = form.denoise && form.denoise.value.trim();
    if (denoiseVal !== "" && !isNaN(Number(denoiseVal))) {
      body.denoise = Number(denoiseVal);
    }
  }

  const seedRaw = form.seed.value.trim();
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

  try {
    const r = await apiFetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const bodyText = await readResponseBodyForError(r);
      throw new Error(formatGenerateHttpError(r.status, bodyText));
    }

    const data = await r.json().catch(() => null);
    if (!data || !data.ok) {
      throw new Error(data?.error || "Generation failed.");
    }

    setPreviewImage(data.image_url + "?t=" + Date.now());
    renderMeta(data);
    setStatusMessage("Done.");
  } catch (err) {
    setPreviewIdle();
    setStatusMessage("Error: " + (err.message || "Unknown"), true);
  } finally {
    clearTimeout(longRunHintTimer);
  }
});

copyErrorBtn?.addEventListener("click", copyLastError);
randomizeSeedBtn?.addEventListener("click", randomizeSeed);

// ── Init ──────────────────────────────────────────────

initTokenForm();
const creds = getStoredCredentials();
if (creds) {
  showAppRoot();
  appInitialized = true;
  savedValues = restoreSavedValues();
  loadModels();
} else {
  showTokenGate();
}
