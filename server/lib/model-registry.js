// lib/model-registry.js
// Shared model discovery and resolution logic

"use strict";

const fs = require("fs");
const path = require("path");

const { hasWorkflow } = require("../workflows/_index.js");
const { getModelDefaults } = require("../workflows/_defaults.js");
const {
  MODELS_BASE,
  DIFFUSION_MODELS_SEGMENT,
  MODEL_DIRS,
  FILENAME_OVERRIDES,
} = require("../configs/model-dirs-config.js");

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

module.exports = {
  getModels,
  resolveModel,
};
