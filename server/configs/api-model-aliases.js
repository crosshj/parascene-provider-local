"use strict";

/**
 * Maps short client `model` strings from GET /api (provider-api-config) to registry modelIds.
 * Expansion happens at request handling — capability catalogs stay free of filesystem paths.
 * Unknown strings pass through so full modelIds (e.g. GET /api/models) still work.
 *
 * Per-method sections live below; add new exports alongside `expand*` helpers as needed.
 */

const IMAGE2VIDEO_ALIAS_TO_REGISTRY_MODEL_ID = {
  wan_i2v:
    "diffusion_models/wan/i2v/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
  ltx_i2v: "checkpoints/ltx/i2v/ltx-2.3-22b-dev-fp8.safetensors",
};

function expandImage2videoModelAlias(clientModelField) {
  const q = String(clientModelField || "").trim();
  if (!q) return q;
  return IMAGE2VIDEO_ALIAS_TO_REGISTRY_MODEL_ID[q] ?? q;
}

module.exports = {
  IMAGE2VIDEO_ALIAS_TO_REGISTRY_MODEL_ID,
  expandImage2videoModelAlias,
};
