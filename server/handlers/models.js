// handlers/models.js
// Scans local model directories and builds a model registry.
// Each entry carries load kind, managed Comfy workflow id, and Comfy naming hints.

"use strict";

const fs = require("fs");
const path = require("path");

const { sendJson } = require("../lib/http.js");
const { isManagedComfyWorkflowSupported } = require("../workflows/_index.js");
const { getModelDefaults } = require("../workflows/_defaults.js");
const { BASE_MODELS_RESPONSE } = require("../configs/models-api-config.js");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODELS_BASE = process.env.MODELS_BASE || "D:\\comfy_models";

const DIFFUSION_MODELS_SEGMENT = "diffusion_models";

// Order matters — first match wins if a file appears in multiple dirs.
// loadKind: how Comfy graphs expect weights to be loaded.
// managedWorkflowId: which server/workflows builder to use (null = excluded from API).
const MODEL_DIRS = [
  {
    rel: "diffusion_models\\qwen",
    family: "qwen",
    loadKind: "diffusion_model",
    managedWorkflowId: "text2image-qwen-diffusion",
    comfyCheckpointGroup: null,
  },
  {
    rel: "diffusion_models\\z-image",
    family: "z-image",
    loadKind: "diffusion_model",
    managedWorkflowId: "text2image-zimage-diffusion",
    comfyCheckpointGroup: null,
  },
  {
    rel: "diffusion_models\\flux",
    family: "flux",
    loadKind: "diffusion_model",
    managedWorkflowId: "text2image-flux-diffusion",
    comfyCheckpointGroup: null,
  },
  {
    rel: "checkpoints\\FLUX1",
    family: "flux",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-flux-checkpoint",
    comfyCheckpointGroup: "FLUX1",
  },
  {
    rel: "checkpoints\\1.5",
    family: "sd15",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-sd15-checkpoint",
    comfyCheckpointGroup: "1.5",
  },
  {
    rel: "checkpoints\\qwen",
    family: "qwen",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-qwen-checkpoint",
    comfyCheckpointGroup: "qwen",
  },
  {
    rel: "checkpoints\\xl",
    family: "sdxl",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-sdxl-checkpoint",
    comfyCheckpointGroup: "xl",
  },
];

const FILENAME_OVERRIDES = [
  { test: /flux/i, family: "flux" },
  { test: /z-image/i, family: "z-image" },
  { test: /pony/i, family: "sdxl" },
  { test: /xl/i, family: "sdxl" },
  { test: /sdxl/i, family: "sdxl" },
  { test: /sd_xl/i, family: "sdxl" },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferFamily(dirFamily, filename) {
  if (dirFamily) return dirFamily;
  const stem = path.basename(filename, ".safetensors").toLowerCase();
  for (const { test, family } of FILENAME_OVERRIDES) {
    if (test.test(stem)) return family;
  }
  return "sd15";
}

function toPosixModelId(modelsBase, fullPath) {
  const rel = path.relative(modelsBase, fullPath);
  return rel.split(path.sep).join("/");
}

/** Comfy UNET / diffusion_models picker string (backslashes), or null if outside diffusion_models. */
function diffusionModelComfyName(modelsBase, fullPath) {
  const dmRoot = path.join(modelsBase, DIFFUSION_MODELS_SEGMENT);
  const rel = path.relative(dmRoot, fullPath);
  if (rel.startsWith("..")) return null;
  return rel.split(path.sep).join("\\");
}

function collectSafetensorsRecursively(rootDir) {
  const out = [];
  const stack = [rootDir];

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".safetensors")) {
        out.push(full);
      }
    }
  }

  return out;
}

function disambiguateStemNames(models) {
  for (const m of models) {
    m.name = path.basename(m.file, ".safetensors");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function scanModels() {
  const seen = new Set();
  const models = [];

  for (const spec of MODEL_DIRS) {
    const dir = path.join(MODELS_BASE, spec.rel);
    const files = collectSafetensorsRecursively(dir);
    for (const fullPath of files) {
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      const file = path.basename(fullPath);
      const family = inferFamily(spec.family, file);
      const modelId = toPosixModelId(MODELS_BASE, fullPath);
      const diffusionName =
        spec.loadKind === "diffusion_model"
          ? diffusionModelComfyName(MODELS_BASE, fullPath)
          : null;

      models.push({
        modelId,
        name: path.basename(file, ".safetensors"),
        file,
        family,
        fullPath,
        loadKind: spec.loadKind,
        managedWorkflowId: spec.managedWorkflowId ?? null,
        comfyCheckpointGroup: spec.comfyCheckpointGroup ?? null,
        diffusionModelComfyName: diffusionName,
        defaults: getModelDefaults(family, file, spec.managedWorkflowId),
      });
    }
  }

  disambiguateStemNames(models);

  models.sort(
    (a, b) =>
      a.family.localeCompare(b.family) ||
      a.name.localeCompare(b.name) ||
      a.modelId.localeCompare(b.modelId),
  );

  return models;
}

let _cache = null;

function getModels() {
  if (!_cache) _cache = scanModels();
  return _cache;
}

/**
 * @param {string} query modelId (preferred), disambiguated name, file basename, or legacy stem
 */
function resolveModel(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const list = getModels();

  const byId = list.find((m) => m.modelId === q);
  if (byId) return byId;

  const matches = list.filter(
    (m) =>
      m.name === q ||
      m.file === q ||
      path.basename(m.file, ".safetensors") === q,
  );
  if (matches.length === 1) return matches[0];
  return null;
}

function modelToPublicJson(m) {
  return {
    modelId: m.modelId,
    name: m.name,
    file: m.file,
    family: m.family,
    loadKind: m.loadKind,
    managedWorkflowId: m.managedWorkflowId,
    comfyCheckpointGroup: m.comfyCheckpointGroup,
    diffusionModelComfyName: m.diffusionModelComfyName,
    defaults: m.defaults,
    // Capability-style fields so UIs (app.html, app-new.html) can reason about
    // how each model can be used without re-encoding workflow naming rules.
    methods: deriveModelMethods(m),
    supportsImageInput: deriveSupportsImageInput(m),
  };
}

/**
 * Derive the list of supported generation "methods" for a model based on its
 * managed workflow id and other metadata. This is intentionally simple and
 * conservative so it stays in sync with our internal workflow naming.
 *
 * Examples:
 * - "text2image-flux-diffusion"  -> ["text2img"]
 * - "image2image-sdxl-checkpoint" -> ["image2image"]
 *
 * Later, as we add text2video/image2video, we can extend this mapping without
 * changing the UI contract.
 */
function deriveModelMethods(m) {
  const id = String(m.managedWorkflowId || "");
  if (!id) {
    // Fallback: treat as a plain text-to-image model.
    return ["text2img"];
  }

  // Special-case SDXL so the UI can expose both text2img and image2image
  // methods even though the registry row currently only carries the
  // text2image managed workflow id.
  if (id === "text2image-sdxl-checkpoint" && m.family === "sdxl") {
    return ["text2img", "image2image"];
  }

  if (id.startsWith("text2image-")) {
    return ["text2img"];
  }
  if (id.startsWith("image2image-")) {
    return ["image2image"];
  }
  if (id.startsWith("text2video-")) {
    return ["text2video"];
  }
  if (id.startsWith("image2video-")) {
    return ["image2video"];
  }

  // Default to text2img unless a workflow explicitly opts into something else.
  return ["text2img"];
}

function deriveSupportsImageInput(m) {
  const methods = deriveModelMethods(m);
  // For now, only image2image / image2video style workflows require an input
  // image. If we later add other methods that can optionally take images, we
  // can broaden this.
  return methods.some(
    (method) => method === "image2image" || method === "image2video",
  );
}

function handleModels(_req, res, _ctx) {
  const models = getModels().filter((m) => isManagedComfyWorkflowSupported(m));

  const payload = JSON.parse(JSON.stringify(BASE_MODELS_RESPONSE));
  payload.models = models.map(modelToPublicJson);

  const methods = payload.methods || {};

  for (const m of models) {
    const modelMethods = deriveModelMethods(m);
    for (const methodId of modelMethods) {
      if (!methods[methodId]) {
        methods[methodId] = {
          id: methodId,
          async: false,
          name: methodId,
          description: "Image generation method.",
          intent: "image_generate",
          fields: {
            model: {
              label: "Model",
              type: "select",
              required: true,
              options: [],
            },
          },
        };
      }

      const optionLabel = `${m.family}: ${m.name}`;
      methods[methodId].fields.model.options.push({
        label: optionLabel,
        value: m.modelId,
      });
    }
  }

  payload.methods = methods;

  sendJson(res, 200, payload);
}

module.exports = {
  getModels,
  resolveModel,
  handleModels,
  MODELS_BASE,
};
