// handlers/models.js
// Scans local model directories and builds a model registry.
// Each entry carries load kind, managed Comfy workflow id, and Comfy naming hints.

"use strict";

const fs = require("fs");
const path = require("path");

const { sendJson } = require("../lib.js");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODELS_BASE = process.env.MODELS_BASE || "D:\\comfy_models";

const DIFFUSION_MODELS_SEGMENT = "diffusion_models";

// Order matters — first match wins if a file appears in multiple dirs.
// loadKind: how the Python worker / Comfy graph expects weights to be loaded.
// managedWorkflowId: which server/generator/workflows builder to use (null = Comfy path N/A).
const MODEL_DIRS = [
  {
    rel: "diffusion_models\\flux",
    family: "flux",
    loadKind: "diffusion_model",
    managedWorkflowId: null,
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
    rel: "checkpoints\\FLUX1",
    family: "flux",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-flux-checkpoint",
    comfyCheckpointGroup: "FLUX1",
  },
  {
    rel: "checkpoints\\pony",
    family: "sdxl",
    loadKind: "checkpoint",
    managedWorkflowId: null,
    comfyCheckpointGroup: "pony",
  },
  {
    rel: "checkpoints\\1.5",
    family: "sd15",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-sd15-checkpoint",
    comfyCheckpointGroup: "1.5",
  },
  {
    rel: "checkpoints\\WAN",
    family: "wan",
    loadKind: "checkpoint",
    managedWorkflowId: null,
    comfyCheckpointGroup: "WAN",
  },
  {
    rel: "checkpoints\\qwen",
    family: "qwen",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-qwen-diffusion",
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

const FAMILY_DEFAULTS = {
  flux: { steps: 20, cfg: 1.0, width: 1024, height: 1024 },
  "z-image": { steps: 9, cfg: 1.0, width: 1024, height: 1024 },
  sdxl: { steps: 30, cfg: 7.0, width: 1024, height: 1024 },
  sd15: { steps: 20, cfg: 2.0, width: 512, height: 512 },
  wan: { steps: 25, cfg: 7.0, width: 768, height: 768 },
  qwen: { steps: 4, cfg: 1.0, width: 1024, height: 1024 },
};

function getModelDefaults(family, fileName) {
  const base = FAMILY_DEFAULTS[family] ?? FAMILY_DEFAULTS.sd15;
  if (family !== "flux") return base;

  const lower = String(fileName || "").toLowerCase();

  if (lower.includes("schnell")) {
    return { ...base, steps: 4, cfg: 1.0 };
  }

  if (lower.includes("dev")) {
    return { ...base, steps: 20, cfg: 1.0 };
  }

  return base;
}

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
  const stemCounts = new Map();
  for (const m of models) {
    const stem = path.basename(m.file, ".safetensors");
    const key = `${m.family}\0${stem.toLowerCase()}`;
    stemCounts.set(key, (stemCounts.get(key) || 0) + 1);
  }
  for (const m of models) {
    const stem = path.basename(m.file, ".safetensors");
    const key = `${m.family}\0${stem.toLowerCase()}`;
    if (stemCounts.get(key) > 1) {
      m.name =
        m.loadKind === "checkpoint"
          ? `${stem} (checkpoint)`
          : `${stem} (diffusion)`;
    } else {
      m.name = stem;
    }
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
        defaults: getModelDefaults(family, file),
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
  };
}

function getModelsPolicy() {
  const raw = process.env.DEFAULT_MANAGED_COMFY_FAMILIES || "flux,sd15";
  const defaultManagedComfyFamilies = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { defaultManagedComfyFamilies };
}

function handleModels(_req, res, _ctx) {
  sendJson(res, 200, {
    ok: true,
    policy: getModelsPolicy(),
    models: getModels().map(modelToPublicJson),
  });
}

module.exports = {
  getModels,
  resolveModel,
  FAMILY_DEFAULTS,
  handleModels,
  MODELS_BASE,
};
