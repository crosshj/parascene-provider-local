# Handoff: FLUX slim vendor and “just the flux call”

**Goal:** Un-architect from Comfy so you can see “just the flux call,” compare it to `workflows/flux.py` (diffusers), and fix why the direct flux path fails while the Comfy path works.

---

## Where things are

### 1. Slim vendor (`generator/lib/comfy_vendor_slim/`)

- **Purpose:** Minimal Comfy surface so imports and hot-path *structure* work; execution of load/sample still needs the full vendor or a subset copy.
- **Real (no stubs):** folder_paths, options, cli_args, nodes (all six node classes + common_ksampler), comfy.utils, comfy.model_management, comfy.nested_tensor, comfy.sample (prepare_noise, fix_empty_latent_channels), comfy_extras.nodes_flux, comfy_extras.nodes_sd3, latent_preview. All trimmed to the actual workflow args (e.g. type=flux only, weight_dtype=default, sampler euler, scheduler simple, vae from folder only).
- **Still stubbed (raise or no-op):** comfy.sd (load_diffusion_model, load_clip, VAE.decode), comfy.sample.sample(), comfy.samplers.KSampler (real class body). Removing these would require pulling in most of Comfy (model_patcher, ldm.flux, text_encoders.flux, k_diffusion, sampler_helpers, etc.).
- **Docs:** `_docs/comfy_vendor_slim_audit.md` (what’s used and with what values), `_docs/comfy_vendor_slim_stub_boundary.md` (why stubs stay and options for stub-free).

### 2. FLUX call: Comfy vs diffusers

- **Doc:** `_docs/flux_call_comfy_vs_diffusers.md`
- **Content:** Exact Comfy sequence (load UNet/CLIP/VAE separately → encode → zero_out negative → empty latent 16ch/8× → sample loop → decode) and how your `workflows/flux.py` differs (diffusers load, single `pipe(...)` call). Use this to compare step-by-step when debugging.

### 3. Build FLUX-only vendor subset (script)

- **Script:** `generator/scripts/build_flux_only_vendor.py`
- **Purpose:** Run Comfy FLUX init (full vendor), record every module loaded from the vendor, copy only those `.py` files into `lib/comfy_vendor_flux_only/`. Result = one tree that contains only what runs for FLUX (no stubs; real code).
- **Must run from:** `generator/` (script uses `Path(__file__).resolve().parent.parent` as GENERATOR; if you run from repo root, GENERATOR becomes repo root and “full vendor” path is wrong).
- **Command:**  
  `cd generator`  
  `FLUX_CCR_USE_SLIM_VENDOR=0 python -m scripts.build_flux_only_vendor`
- **Requirements:** Same env as FLUX CCR (PIL, torch, safetensors, etc.). If init fails (e.g. missing PIL or “full vendor not found”), fix the path/deps and re-run.
- **Output:** `generator/lib/comfy_vendor_flux_only/` (copy of vendor files); log: `generator/_docs/build_flux_only_vendor.log` (or `_docs/build_flux_only_vendor.log` depending on script’s GENERATOR).
- **Current status:** When last run, either (a) full vendor path was wrong (script run from repo root → “Full vendor not found”), or (b) init failed (e.g. No module named 'PIL') → 0 modules collected → empty tree. **Resumed:** Use the same env as FLUX CCR (e.g. `pip install -r generator/requirements.txt`). Then: `cd generator && FLUX_CCR_USE_SLIM_VENDOR=0 python -m scripts.build_flux_only_vendor` → tree at `generator/lib/comfy_vendor_flux_only/`, log at `generator/_docs/build_flux_only_vendor.log`.

### 4. Repo layout (relevant)

- **Workflows:** `generator/workflows/flux.py` (diffusers; yours, fails), `generator/workflows/flux_ccr.py` (Comfy path, works).
- **Comfy entry:** `generator/lib/flux_comfy_vendored.py` (init, load_pipeline, generate; uses either slim or full vendor via `FLUX_CCR_USE_SLIM_VENDOR` and `COMFYUI_ROOT`).
- **Full vendor:** `generator/lib/comfy_vendor/ComfyUI/` (full ComfyUI tree).
- **Slim vendor:** `generator/lib/comfy_vendor_slim/` (minimal + stubs).
- **FLUX-only copy:** intended output of script → `generator/lib/comfy_vendor_flux_only/` (subset of full vendor, no stubs).

---

## What to do next

1. **Populate the FLUX-only tree**  
   From `generator/`, with deps installed:  
   `FLUX_CCR_USE_SLIM_VENDOR=0 python -m scripts.build_flux_only_vendor`  
   Confirm log shows “Collected N modules” with N > 0 and that `lib/comfy_vendor_flux_only/` contains `.py` files.

2. **Use the FLUX-only tree to compare**  
   Point runtime at that tree (`COMFYUI_ROOT=generator/lib/comfy_vendor_flux_only`), run FLUX CCR once to confirm it works, then read the code path (load UNet/CLIP/VAE → encode → sample → decode) and compare to `workflows/flux.py` using `_docs/flux_call_comfy_vs_diffusers.md`.

3. **Optional: trim further**  
   From the FLUX-only tree, delete or exclude modules you’re sure aren’t on the FLUX path; re-run FLUX CCR until it breaks to see what’s actually required. That gets you to a minimal “just the flux call” set.

4. **Fix or replace the diffusers path**  
   Use the comparison to fix `workflows/flux.py` (config, keys, guidance, latent shape, etc.) or to replace it with a minimal non-Comfy implementation that matches the working Comfy sequence.

---

## Quick reference

| Item | Location |
|------|----------|
| Slim vendor (real + stubs) | `generator/lib/comfy_vendor_slim/` |
| Full vendor | `generator/lib/comfy_vendor/ComfyUI/` |
| FLUX-only build script | `generator/scripts/build_flux_only_vendor.py` (run from `generator/`) |
| Comfy vs diffusers steps | `_docs/flux_call_comfy_vs_diffusers.md` |
| Slim audit (what’s used) | `_docs/comfy_vendor_slim_audit.md` |
| Stub boundary and options | `_docs/comfy_vendor_slim_stub_boundary.md` |
| Code path map (Comfy to files) | `_docs/flux_code_path_map.md` |
| Build log | `generator/_docs/build_flux_only_vendor.log` or `_docs/build_flux_only_vendor.log` |
