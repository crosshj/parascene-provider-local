// generator/models.js
// Scans local model directories and builds a model registry.
// Directory path is used as the primary family signal; filename patterns
// are used as a fallback for ambiguous cases.

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODELS_BASE = process.env.MODELS_BASE || "D:\\comfy_models";
const INCLUDE_FLUX_CHECKPOINTS = process.env.INCLUDE_FLUX_CHECKPOINTS === "1";

// Directories to scan, each mapped to a default family.
// Order matters — first match wins if a file appears in multiple dirs.
const MODEL_DIRS = [
  // FLUX: diffusion_models is the known-good Comfy path.
  // checkpoint-style FLUX1 is optional (off by default).
  { rel: "diffusion_models\\flux", family: "flux" },
  ...(INCLUDE_FLUX_CHECKPOINTS
    ? [{ rel: "checkpoints\\FLUX1", family: "flux" }]
    : []),
  { rel: "checkpoints\\xl", family: "sdxl" },
  { rel: "checkpoints\\pony", family: "sdxl" },
  { rel: "checkpoints\\1.5", family: "sd15" },
  { rel: "checkpoints\\WAN", family: "wan" },
  { rel: "checkpoints\\qwen", family: "qwen" },
];

// Filename substring → family override (applied if directory-based detection
// is ambiguous or a model lives in an unexpected folder).
const FILENAME_OVERRIDES = [
  { test: /flux/i, family: "flux" },
  { test: /pony/i, family: "sdxl" },
  { test: /xl/i, family: "sdxl" },
  { test: /sdxl/i, family: "sdxl" },
  { test: /sd_xl/i, family: "sdxl" },
];

// Default step counts per family (used by frontend defaults).
const FAMILY_DEFAULTS = {
  flux: { steps: 20, cfg: 1.0, width: 1024, height: 1024 },
  sdxl: { steps: 30, cfg: 7.0, width: 1024, height: 1024 },
  sd15: { steps: 30, cfg: 7.0, width: 512, height: 512 },
  wan: { steps: 25, cfg: 7.0, width: 768, height: 768 },
  qwen: { steps: 25, cfg: 7.0, width: 512, height: 512 },
};

function getModelDefaults(family, fileName) {
  const base = FAMILY_DEFAULTS[family] ?? FAMILY_DEFAULTS.sd15;
  if (family !== "flux") return base;

  const lower = String(fileName || "").toLowerCase();

  // Match Comfy defaults more closely for FLUX variants.
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
  // Directory mapping is authoritative unless it is absent.
  if (dirFamily) return dirFamily;
  const stem = path.basename(filename, ".safetensors").toLowerCase();
  for (const { test, family } of FILENAME_OVERRIDES) {
    if (test.test(stem)) return family;
  }
  return "sd15";
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** @returns {{ name: string, family: string, fullPath: string, defaults: object }[]} */
function scanModels() {
  const seen = new Set();
  const models = [];

  for (const { rel, family: dirFamily } of MODEL_DIRS) {
    const dir = path.join(MODELS_BASE, rel);

    const files = collectSafetensorsRecursively(dir);
    for (const fullPath of files) {
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      const file = path.basename(fullPath);

      const family = inferFamily(dirFamily, file);
      models.push({
        name: path.basename(file, ".safetensors"),
        file,
        family,
        fullPath,
        defaults: getModelDefaults(family, file),
      });
    }
  }

  // Sort: by family then by name.
  models.sort(
    (a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name),
  );

  return models;
}

let _cache = null;

/** Cached scan — refreshed only on server restart. */
function getModels() {
  if (!_cache) _cache = scanModels();
  return _cache;
}

/** Resolve a model name to its registry entry.  Returns null if not found. */
function resolveModel(name) {
  return getModels().find((m) => m.name === name || m.file === name) ?? null;
}

module.exports = { getModels, resolveModel, FAMILY_DEFAULTS };
