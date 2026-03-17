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
const badge = document.getElementById("family-badge");
const statusEl = document.getElementById("status");
const copyErrorBtn = document.getElementById("copy-error-btn");
const randomizeSeedBtn = document.getElementById("randomize-seed-btn");
const previewWrap = document.getElementById("preview-wrap");
const idleEl = document.getElementById("preview-idle");
const imageEl = document.getElementById("image");
const metaRowEl = document.getElementById("meta-row");
const STORAGE_KEY = "local-image-generator.form.v1";

let modelRegistry = {};
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
    const res = await apiFetch("/api/models", { method: "GET" });
    const data = await res.json();
    if (!data.ok) throw new Error("Bad response");

    const groups = {};
    for (const m of data.models) {
      modelRegistry[m.name] = m;
      (groups[m.family] ??= []).push(m);
    }

    modelSel.innerHTML = "";
    for (const [family, models] of Object.entries(groups)) {
      const grp = document.createElement("optgroup");
      grp.label = family.toUpperCase();
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m.name;
        opt.textContent = m.name;
        grp.appendChild(opt);
      }
      modelSel.appendChild(grp);
    }

    const hasSavedModel =
      savedValues &&
      typeof savedValues.model === "string" &&
      savedValues.model &&
      modelRegistry[savedValues.model];

    if (hasSavedModel) {
      modelSel.value = savedValues.model;
    } else {
      const first = modelSel.querySelector("option");
      if (first) modelSel.value = first.value;
    }

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
    }

    if (!savedValues) applyModelDefaults();
    else updateFamilyBadge();

    saveFormValues();
  } catch (e) {
    modelSel.innerHTML = '<option value="">Failed to load models</option>';
    setStatusMessage("Error loading models: " + e.message, true);
  }
}

function applyModelDefaults() {
  const entry = modelRegistry[modelSel.value];
  if (!entry) return;
  updateFamilyBadge();
  form.width.value = entry.defaults.width;
  form.height.value = entry.defaults.height;
  form.steps.value = entry.defaults.steps;
  form.cfg.value = entry.defaults.cfg;
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

modelSel.addEventListener("change", applyModelDefaults);

[
  "prompt",
  "negative_prompt",
  "width",
  "height",
  "steps",
  "cfg",
  "seed",
].forEach((n) => form[n].addEventListener("input", saveFormValues));

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
  };

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
