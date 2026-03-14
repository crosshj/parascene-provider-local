# comfy_vendor_slim: stub boundary and path to stub-free

## Current state

The slim vendor has **no stubs** in these areas:

- **folder_paths**, **options**, **cli_args** — real, trimmed to hot path.
- **nodes** — real (UNETLoader, DualCLIPLoader, VAELoader, ConditioningZeroOut, KSampler, VAEDecode, common_ksampler); they call into comfy.sd / comfy.sample / etc.
- **comfy.utils** — real (load_torch_file, repeat_to_batch_size, PROGRESS_BAR_ENABLED).
- **comfy.model_management** — real (XFORMERS_* flags, intermediate_device).
- **comfy.nested_tensor** — real (so **comfy.sample.prepare_noise** and **fix_empty_latent_channels** are fully real).
- **comfy.sample** — **prepare_noise** and **fix_empty_latent_channels** are real; **sample()** still raises (stub).
- **comfy_extras.nodes_flux** — real (CLIPTextEncodeFlux.execute).
- **comfy_extras.nodes_sd3** — real (EmptySD3LatentImage.generate).
- **latent_preview** — real (no-op callback; no stub).

The remaining **stubs** (they raise or return non-functional objects) are:

| Stub | Used by | Why it's stubbed |
|------|--------|-------------------|
| **comfy.sd.load_diffusion_model** | nodes.UNETLoader.load_unet | Needs model_detection, supported_models, ldm.flux, model_patcher, latent_formats, diffusers_convert, etc. (~20+ files). |
| **comfy.sd.load_clip** (FLUX) | nodes.DualCLIPLoader.load_clip | Needs text_encoders.flux, sd1_clip, text_encoders.t5, text_encoders.sd3_clip, model_management, etc. (~15+ files). |
| **comfy.sd.VAE** (decode + init from sd) | nodes.VAELoader, nodes.VAEDecode | VAE.__init__ branches on state_dict keys into ldm.models.autoencoder, taesd, diffusers_convert, etc.; decode() runs the decoder. (~10+ files). |
| **comfy.sample.sample** | nodes.common_ksampler | Needs comfy.samplers.KSampler (real), which needs k_diffusion.sampling, sampler_helpers, model_patcher, patcher_extension, hooks, context_windows, CFGGuider, etc. (~15+ files). |
| **comfy.samplers.KSampler** (real class body) | comfy.sample.sample | Same as above; the class and sample() are one dependency cluster. |

So the **stub boundary** is: **load model**, **load CLIP**, **load/decode VAE**, and **run sampling loop**. Those four sit on top of a large, shared dependency tree (model_patcher, ldm.*, text_encoders.*, k_diffusion, sampler_helpers, etc.).

---

## Why “just bring the next layer” doesn’t remove stubs

Each time we replace a stub with real code from the full vendor, we have to bring that file’s imports. Those are either:

- **Already in slim** (e.g. utils, model_management) — then we’re done for that import, or  
- **Not in slim** — then we add new files that themselves import more (sd.py → model_detection → supported_models, ldm.flux, …; samplers → k_diffusion, sampler_helpers, model_patcher, …).

So we don’t “remove one stub and stop”; we pull in a whole subgraph. For the four stubs above, that subgraph is most of ComfyUI’s core (dozens of files, thousands of lines). So we can’t remove stubs one-by-one and stay “truly slim” in the sense of “a few files”; we’d end up with a large subset of the full vendor.

---

## Ways to get to “no stubs” (truly slim = no stub code)

### Option A: Slim as a **subset copy** of the full vendor (recommended)

Don’t maintain two implementations. Instead:

1. **Single source of truth**: full ComfyUI stays in `comfy_vendor/ComfyUI/`.
2. **Slim = scripted subset**: a script (e.g. `scripts/build_slim_vendor.py`) copies only the files that are needed for the FLUX CCR hot path from `comfy_vendor/ComfyUI/` into `comfy_vendor_slim/`, preserving directory layout.
3. **No stubs**: the copied files are the real implementations; nothing raises “use full vendor”.
4. **Truly slim**: the slim tree is “slim” because it contains only those files (e.g. ~50–80 files instead of 184+), not because we rewrote or stubbed anything.

Steps to implement Option A:

- Enumerate the minimal set of files required for: load_diffusion_model (FLUX), load_clip (FLUX), VAE (standard ae.safetensors path), sample() + samplers (euler + simple). The existing `_docs/vendor_deps.md` and dependency tracing give this set.
- Write the copy script that (1) copies those files, (2) copies any `__init__.py` needed for packages, (3) optionally trims unused branches inside files (e.g. remove non-FLUX model types from sd.py) for smaller size.
- Run the script to generate or refresh `comfy_vendor_slim/`. CI or a pre-commit hook can regenerate slim from the full vendor so the two stay in sync.

Then “slim” is literally “the same code as full, but only the files we need.”

### Option B: Keep current slim; use full vendor for execution

- **Slim** = what we have now: minimal code, fast imports, hot-path logic where it’s cheap (folder_paths, nodes, prepare_noise, fix_empty_latent_channels, nodes_flux, nodes_sd3, etc.), and **stubs** for load_diffusion_model, load_clip, VAE.decode, sample/samplers.
- **Execution**: when you actually run FLUX CCR (load_pipeline + generate), you **don’t** use the slim vendor; you point to the full ComfyUI (e.g. don’t set `FLUX_CCR_USE_SLIM_VENDOR`, or put full vendor on `sys.path`). So in production there are no stubs in the code path that runs.

So “truly slim” here means “slim tree is minimal and only for structure/imports; real run is full vendor.”

### Option C: Embed the full dependency graph into slim by hand

- Copy into `comfy_vendor_slim` every file that the four stubbed areas need (and their transitive deps), then delete the stubs and wire the real implementations.
- Result: no stubs, but the slim tree becomes a large subset of ComfyUI (50–80+ files). Maintaining it by hand is tedious and error-prone; Option A automates the same idea.

---

## Recommendation

- **Short term**: Keep the current slim + stubs; use the full vendor for execution (Option B). The audit and this doc make it clear what’s real and what’s stubbed and why.
- **If you want “no stubs” and “slim” in the sense of “fewer files”**: implement Option A (slim as a scripted subset copy of the full vendor). Then you have a single codebase, no stub code, and a truly slim tree that is just a subset of the full vendor.

The only way to have **no stubs** without copying a large part of ComfyUI is to **not use ComfyUI** for those four areas (e.g. reimplement FLUX load/sample with another stack). That would be a different project, not “slim vendor.”
