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
      denoise: form.denoise ? form.denoise.value : undefined,
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
      } else if (methodIds.includes("text2img")) {
        initialMethod = "text2img";
      }
      methodSel.value = initialMethod;

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

      // Restore prompt
      if (savedValues && savedValues.prompt != null)
        form.prompt.value = savedValues.prompt;

      // Events
      methodSel.addEventListener("change", () => {
        const methodId = methodSel.value;
        const prevModel = modelSel.value;
        const pick = rebuildModelsForMethod(
          methodId,
          perMethodModel[methodId] || null,
        );
        if (pick) perMethodModel[methodId] = pick;
        // Save method/model selection
        saveFormValues();
        updateFamilyBadge();
      });

      modelSel.addEventListener("change", () => {
        const methodId = methodSel.value;
        if (methodId) {
          perMethodModel[methodId] = modelSel.value;
        }
        saveFormValues();
        updateFamilyBadge();
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
  form.model.addEventListener("change", () => {
    updateFamilyBadge();
    saveFormValues();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatusMessage("Generating…");
    setPreviewLoading();
    metaRowEl.innerHTML = "";

    const body = {
      prompt: form.prompt.value.trim(),
      model: modelSel.value,
    };

    // Only send denoise for image2image
    if (methodSel && methodSel.value === "image2image") {
      const denoiseVal = form.denoise && form.denoise.value.trim();
      if (denoiseVal !== "" && !isNaN(Number(denoiseVal))) {
        body.denoise = Number(denoiseVal);
      }
    }
    // Show/hide denoise field based on method
    function updateDenoiseField() {
      const denoiseField = document.getElementById("denoise-field");
      if (!denoiseField) return;
      denoiseField.style.display =
        methodSel.value === "image2image" ? "" : "none";
    }
    methodSel.addEventListener("change", updateDenoiseField);
    updateDenoiseField();

    try {
      // Provider API: start job (POST /api with method + args, no job_id).
      const startRes = await apiFetch("/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "text2img",
          args: body,
        }),
      });
      const startData = await startRes.json();
      if (startRes.status !== 202 || !startData.job_id) {
        throw new Error(startData.error || "Failed to start job");
      }

      const jobId = startData.job_id;

      // Poll until done (202 → still pending, 200 → image binary or JSON error).
      for (;;) {
        const pollRes = await apiFetch("/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "text2img",
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
          const contentType = pollRes.headers.get("Content-Type") || "";
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

  // ── Init ──────────────────────────────────────────────

  savedValues = restoreSavedValues();
  setPreviewIdle();
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
