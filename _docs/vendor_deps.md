# ComfyUI Vendor Dependencies (FLUX CCR)

Dependency trace from **generator/workflows/flux_ccr.py** → **generator/lib/comfy_vendor/** to identify what is necessary to keep and what can be removed.

---

## 1. Dependency chain (source → vendor)

```
generator/workflows/flux_ccr.py
  └── lib.flux_comfy_vendored (generator/lib/flux_comfy_vendored.py)
        ├── workflows.flux (resolve_flux_model_path only; not in comfy_vendor)
        └── _init_comfy_runtime() adds ComfyUI root to sys.path and imports:
              ├── comfy.options
              ├── folder_paths
              ├── nodes
              ├── comfy.model_management
              ├── comfy.ldm.modules.attention
              ├── comfy_extras.nodes_flux  (CLIPTextEncodeFlux)
              └── comfy_extras.nodes_sd3   (EmptySD3LatentImage)
```

Runtime usage in `flux_comfy_vendored`:

- **load_pipeline**: `nodes.UNETLoader`, `nodes.DualCLIPLoader`, `nodes.VAELoader`
- **generate**: `CLIPTextEncodeFlux`, `EmptySD3LatentImage`, `nodes.ConditioningZeroOut`, `nodes.KSampler`, `nodes.VAEDecode`

---

## 2. Entry-point imports (what pulls in the rest)

| Entry point | Location | Pulls in |
|-------------|----------|----------|
| **comfy.options** | comfy/options.py | (minimal) |
| **comfy.cli_args** | comfy/cli_args.py | comfy.options |
| **folder_paths** | folder_paths.py | comfy.cli_args |
| **nodes** | nodes.py | comfy.diffusers_load, comfy.samplers, comfy.sample, **comfy.sd**, comfy.utils, comfy.controlnet, comfy.comfy_types, comfy_api.internal, comfy_api.version_list, comfy_api.latest, comfy.clip_vision, comfy.model_management, folder_paths, latent_preview, node_helpers |
| **comfy.model_management** | comfy/model_management.py | comfy.cli_args, torch, psutil |
| **comfy.ldm.modules.attention** | comfy/ldm/modules/attention.py | comfy.model_management, comfy.ops, comfy.cli_args, .diffusionmodules.util, .sub_quadratic_attention |
| **comfy_extras.nodes_flux** | comfy_extras/nodes_flux.py | node_helpers, comfy.utils, comfy_api.latest, comfy.model_management, nodes |
| **comfy_extras.nodes_sd3** | comfy_extras/nodes_sd3.py | folder_paths, **comfy.sd**, comfy.model_management, nodes, comfy_extras.nodes_slg |

Critical: **nodes** imports **comfy.sd** at top level. **comfy.sd** (sd.py) eagerly imports a very large set of submodules (see below).

---

## 3. comfy.sd top-level imports (eager load)

These run as soon as `import nodes` (or `import comfy.sd`) happens:

- comfy.model_management, comfy.utils
- comfy.ldm.models.autoencoder, comfy.ldm.cascade.stage_a, stage_c_coder
- comfy.ldm.audio.autoencoder
- comfy.ldm.genmo.vae.model
- comfy.ldm.lightricks.vae.causal_video_autoencoder
- comfy.ldm.cosmos.vae, comfy.ldm.wan.vae, comfy.ldm.wan.vae2_2
- comfy.ldm.hunyuan3d.vae, comfy.ldm.ace.vae.music_dcae_pipeline
- comfy.ldm.hunyuan_video.vae, comfy.ldm.mmaudio.vae.autoencoder
- comfy.pixel_space_convert, comfy.clip_vision, comfy.diffusers_convert, comfy.model_detection
- **comfy.sd1_clip**, **comfy.sdxl_clip**
- comfy.text_encoders.sd2_clip, **sd3_clip**, sa_t5, aura_t5, pixart_t5, hydit, **flux**, long_clipl, genmo, lt, hunyuan_video, cosmos, lumina2, wan, hidream, ace, omnigen2, qwen_image, hunyuan_image, z_image, ovis, kandinsky5
- comfy.model_patcher, comfy.lora, comfy.lora_convert, comfy.hooks
- comfy.t2i_adapter.adapter, comfy.taesd.taesd, comfy.taesd.taehv
- comfy.latent_formats
- **comfy.ldm.flux.redux**

So in practice, **almost the entire comfy_vendor tree is loaded** when the FLUX CCR path runs, even though only a subset is used for FLUX (UNet, FLUX CLIP/T5, VAE, samplers, sample, utils).

---

## 4. FLUX-specific code paths (minimal logical deps)

If we could lazy-load or stub `comfy.sd` and only load what FLUX needs:

### 4.1 Load UNet (FLUX)

- **comfy.sd**: `load_diffusion_model` → `load_diffusion_model_state_dict`
- **comfy.model_detection**: `unet_prefix_from_state_dict`, `model_config_from_unet`, `convert_diffusers_mmdit`, `model_config_from_diffusers_unet`
- **comfy.supported_models** (imported by model_detection): registers model configs; FLUX uses **comfy.ldm.flux** and **comfy.text_encoders.flux** for clip_target
- **comfy.supported_models_base**, **comfy.latent_formats**, **comfy.diffusers_convert**
- **comfy.ldm.flux**: model.py, layers.py, math.py, redux.py (redux only for flux2 image encoder; FLUX1 uses ldm.flux.model)
- **comfy.ldm.common_dit**, **comfy.patcher_extension**
- **comfy.model_patcher**, **comfy.utils**

### 4.2 Load CLIP (FLUX)

- **comfy.sd**: `load_clip` (CLIPType.FLUX) → `load_text_encoder_state_dicts` → **comfy.text_encoders.flux** (flux_clip, FluxTokenizer, t5xxl_detect)
- **comfy.text_encoders.flux**: depends on **comfy.sd1_clip**, **comfy.text_encoders.t5**, **comfy.text_encoders.sd3_clip**, **comfy.text_encoders.llama** (for flux2), **comfy.model_management**

### 4.3 Load VAE

- **comfy.sd**: VAE class and loading from checkpoint / list; for “ae.safetensors” style VAE, uses standard diffusers-style or TAESD paths in **comfy.ldm.models.autoencoder**, **comfy.taesd**, etc. One path uses **comfy.ldm.flux.redux** (ReduxImageEncoder) for flux2.

### 4.4 Sampling

- **comfy.samplers**: KSampler (used by nodes.KSampler)
- **comfy.sample**: sampling loop
- **comfy.model_patcher**, **comfy.model_management**, **comfy.utils**, **comfy.hooks**, **comfy.context_windows**, **comfy.patcher_extension**, **comfy.sampler_helpers**
- **comfy.ldm.modules.attention** (optimized_attention etc.) — used by FLUX model and samplers

### 4.5 Node / API surface

- **comfy_api**: latest (io, ComfyExtension), version_list, internal — used by nodes and comfy_extras
- **comfy.comfy_types**: IO, ComfyNodeABC, InputTypeDict, FileLocator
- **node_helpers**, **latent_preview** (nodes.py expects them)
- **comfy_extras.nodes_slg** (imported by nodes_sd3; EmptySD3LatentImage only needs nodes + model_management, but the module still imports nodes_slg)

---

## 5. Transitive dependency summary (by vendor module)

| Module / area | Used by FLUX CCR? | Notes |
|---------------|-------------------|--------|
| comfy.options, comfy.cli_args | Yes | Required for folder_paths and args |
| folder_paths | Yes | Model/VAE/CLIP paths |
| nodes | Yes | UNETLoader, DualCLIPLoader, VAELoader, KSampler, VAEDecode, ConditioningZeroOut |
| latent_preview, node_helpers | Yes | Imported by nodes |
| comfy.model_management | Yes | Device / VRAM / offload |
| comfy.ldm.modules.attention | Yes | FLUX model + samplers |
| comfy.ldm.modules.diffusionmodules.util | Yes | attention uses it |
| comfy.ldm.modules.sub_quadratic_attention | Yes | attention |
| comfy_extras.nodes_flux | Yes | CLIPTextEncodeFlux |
| comfy_extras.nodes_sd3 | Yes | EmptySD3LatentImage |
| comfy_extras.nodes_slg | Yes | Imported by nodes_sd3 |
| comfy.sd | Yes | load_diffusion_model, load_clip, VAE |
| comfy.samplers, comfy.sample | Yes | KSampler |
| comfy.utils | Yes | Load/save, state dict helpers |
| comfy.model_detection | Yes | UNet config detection |
| comfy.supported_models, supported_models_base | Yes | Model config registry (sd imports them via model_detection) |
| comfy.ldm.flux (model, layers, math, redux, controlnet) | Yes (model, layers, math; redux for flux2) | FLUX UNet + optional redux |
| comfy.text_encoders.flux | Yes | FLUX CLIP/T5 |
| comfy.sd1_clip, comfy.sdxl_clip | Yes | Base CLIP; flux and others build on them |
| comfy.text_encoders.sd3_clip, t5 | Yes | FLUX text encoder stack |
| comfy.model_patcher, comfy.ops | Yes | Loading and execution |
| comfy.latent_formats, comfy.model_base | Yes | Model/sampling config |
| comfy_api.* | Yes | Node interface (latest, version_list, internal) |
| comfy.comfy_types | Yes | Node types |
| comfy.diffusers_convert | Yes | sd / model_detection |
| comfy.clip_vision | Yes | Imported by nodes (not used in FLUX CCR path but loaded) |
| comfy.controlnet | Yes | Imported by nodes (not used in FLUX CCR path but loaded) |
| comfy.diffusers_load | Yes | Imported by nodes |
| comfy.checkpoint_pickle, comfy.float, comfy.rmsnorm, comfy.quant_ops | Yes | utils / ops / model loading |
| comfy.hooks, comfy.patcher_extension, comfy.context_windows | Yes | Samplers / model execution |
| comfy.sampler_helpers | Yes | Samplers |
| comfy.lora, lora_convert | Loaded by sd | Not used for FLUX-only load/generate |
| comfy.taesd, taehv | Loaded by sd | Used for VAE/TAE paths; FLUX can use standard VAE |
| comfy.ldm.models.autoencoder | Loaded by sd | VAE construction |
| comfy.ldm.cascade.*, ldm.audio.*, ldm.genmo.*, ldm.lightricks.*, ldm.cosmos.*, ldm.wan.*, ldm.hunyuan3d.*, ldm.ace.*, ldm.hunyuan_video.*, ldm.mmaudio.* | Loaded by sd | Not used for FLUX UNet/CLIP/sample |
| Other text_encoders.* (aura_t5, pixart_t5, hydit, genmo, lt, cosmos, lumina2, wan, hidream, ace, omnigen2, qwen_image, hunyuan_image, z_image, ovis, kandinsky5, long_clipl) | Loaded by sd | Not used for FLUX CLIP |
| comfy_extras (all other nodes_*.py except flux, sd3, slg) | Loaded only if imported | Not imported by flux_ccr path; only nodes_flux, nodes_sd3, nodes_slg are |
| app/, comfy_execution/ | Partially | Some used by comfy_api or nodes; not all |

---

## 6. What to keep vs remove

### 6.1 Current behavior (no refactor)

- **Keep**: Everything under **generator/lib/comfy_vendor/** that is transitively imported when running the FLUX CCR workflow.
- Because **nodes** and **comfy.sd** are imported eagerly, that includes almost all of:
  - **comfy/** (except maybe a few app-only or CLI-only files)
  - **comfy_extras/** (at least nodes_flux, nodes_sd3, nodes_slg; others are loaded if nodes or sd pull them in via other node registrations)
  - **comfy_api/** (used by nodes and comfy_extras)
  - **folder_paths.py**, **nodes.py**, **latent_preview.py**, **node_helpers.py**
  - **utils/** (if referenced; e.g. json_util, install_util)

So with the **current** design, there is almost nothing safe to delete from comfy_vendor without breaking “import nodes” or “import comfy.sd”.

### 6.2 If we refactor (lazy / minimal FLUX path)

To shrink the vendor we would need to:

1. **Avoid importing the full `nodes` and/or full `comfy.sd`** at startup; e.g.:
   - Lazy-import only the node classes used (UNETLoader, DualCLIPLoader, VAELoader, ConditioningZeroOut, KSampler, VAEDecode) and the FLUX/SD3 extras (CLIPTextEncodeFlux, EmptySD3LatentImage), or
   - Provide a thin **flux_comfy_slim** that calls only `comfy.sd.load_diffusion_model`, `load_clip` (FLUX), and VAE load, plus comfy.samplers/sample, without importing the rest of nodes or the full sd.py top-level imports.

2. **Trim comfy.sd** so it does not top-level-import every text encoder and every LDM/VAE. For example, only import:
   - comfy.ldm.flux.redux (if supporting flux2)
   - comfy.text_encoders.flux
   - and the shared infra (utils, model_management, model_detection, supported_models with only FLUX-related configs, etc.).

3. **Trim comfy.supported_models** so it does not import all text encoders; only the ones needed for FLUX (e.g. flux, sd1_clip, sdxl_clip, sd3_clip, t5).

Then we could **remove** (from the vendor copy) everything that is not reachable from this slim path, for example:

- Most of **comfy_extras** (keep only nodes_flux, nodes_sd3, nodes_slg and their deps).
- Most **comfy.ldm** except: **ldm.flux**, **ldm.modules** (attention, diffusionmodules.util, sub_quadratic_attention), **ldm.common_dit**, **ldm.util**, and whatever **model_detection** / **supported_models** still reference for FLUX.
- Most **comfy.text_encoders** except: **flux**, **sd1_clip**, **sdxl_clip**, **sd3_clip**, **t5**, and any they depend on (e.g. **llama** if flux2 is kept).
- **comfy.ldm** VAE/cascade/audio/genmo/lightricks/cosmos/wan/hunyuan/ace/mmaudio, etc., unless we keep one minimal VAE path.
- **app/** (if not used by the headless FLUX CCR runner).

---

## 7. File-level “keep vs remove” (after refactor)

Below is a concise list assuming we **do** the refactor above (lazy/minimal FLUX-only imports and a trimmed sd/supported_models). Until that refactor is done, **do not remove** these; they are “safe to remove only after refactor”.

### 7.1 Definitely keep (FLUX CCR minimal set)

- **Root**: folder_paths.py, nodes.py, latent_preview.py, node_helpers.py
- **comfy**: options.py, cli_args.py, model_management.py, utils.py, sd.py (slimmed), model_detection.py, supported_models_base.py, supported_models.py (slimmed), model_patcher.py, model_base.py, ops.py, float.py, rmsnorm.py, quant_ops.py, checkpoint_pickle.py, diffusers_convert.py, latent_formats.py, sample.py, samplers.py, sampler_helpers.py, hooks.py, patcher_extension.py, context_windows.py, comfy_types (all), clip_vision.py (if nodes keep it), clip_model.py
- **comfy.ldm**: flux/ (all), modules/attention.py, modules/sub_quadratic_attention.py, modules/diffusionmodules/util.py, modules/diffusionmodules/mmdit.py (if FLUX uses it), common_dit.py, util.py
- **comfy.text_encoders**: flux.py, sd1_clip.py (and deps), sdxl_clip (if needed), sd3_clip, t5, llama (only if flux2 kept)
- **comfy_extras**: nodes_flux.py, nodes_sd3.py, nodes_slg.py
- **comfy_api**: latest (and _input, _io, _util as used), version_list, internal (as used by nodes/comfy_extras)
- **comfy.model_detection**, **comfy.k_diffusion** (if samplers use it), **comfy.ldm.models.autoencoder** (minimal VAE path), **comfy.taesd** (if we keep one VAE path)

### 7.2 Can remove after refactor (not on FLUX-only path)

- **comfy.ldm**: cascade/, audio/, genmo/, lightricks/, cosmos/, wan/, hidream/, hunyuan3d/, hunyuan_video/, ace/, mmaudio/, chroma/, chroma_radiance/, lumina/, pixart/, aura/, hydit/, kandinsky5/, qwen_image/ (except if model_detection needs one), etc.
- **comfy.text_encoders**: aura_t5, pixart_t5, hydit, genmo, lt, hunyuan_video, cosmos, lumina2, wan, hidream, ace, omnigen2, qwen_image, hunyuan_image, z_image, ovis, kandinsky5, long_clipl, etc. (keep only flux, sd1_clip, sdxl_clip, sd3_clip, t5, optionally llama)
- **comfy_extras**: all nodes_*.py other than nodes_flux, nodes_sd3, nodes_slg
- **comfy**: controlnet.py, lora.py, lora_convert.py, t2i_adapter/, weight_adapter/ (unless we keep one adapter path), pixel_space_convert.py, image_encoders/ (or keep only what clip_vision needs)
- **app/**: if not used by the runner
- **comfy_execution**: keep only what comfy_api/nodes actually use

---

## 8. Summary

| Question | Answer |
|----------|--------|
| What does flux_ccr need from the vendor? | Options, folder_paths, nodes (specific loaders/sampler/VAE decode), model_management, ldm.modules.attention, comfy_extras.nodes_flux and nodes_sd3 (and nodes_slg), and the FLUX load/sample path in comfy.sd, comfy.samplers, comfy.sample, plus comfy_api/comfy_types/node_helpers/latent_preview. |
| What gets loaded today? | Almost everything, because nodes and comfy.sd are imported at top level and pull in the whole tree. |
| What can we remove without code changes? | Effectively nothing; removing files will break imports. |
| What can we remove after refactor? | All non-FLUX LDM stacks, non-FLUX text encoders, and unused comfy_extras nodes; plus optional app/, and parts of comfy_execution and comfy that are not on the minimal FLUX path above. |

To actually reduce vendor size, the necessary first step is refactoring so that the FLUX CCR path does not import the full **nodes** and full **comfy.sd** (e.g. lazy imports or a dedicated slim entry point that only imports the modules listed in §7.1).

---

## 9. Slim vendor (lib/comfy_vendor_slim/)

A reduced copy of the vendor is maintained at **generator/lib/comfy_vendor_slim/ComfyUI/** containing only files needed for the FLUX CCR workflow. It is built by copying the minimal tree and:

- **supported_models.py** – Replaced with a FLUX-only version (Flux, FluxInpaint, FluxSchnell, Flux2).
- **model_base.py** – Unused LDM/model packages are stubbed in `sys.modules` so only the FLUX path is loadable.
- **sd.py** – Same idea: stub missing text encoders and VAE/LDM modules so only FLUX load/sample paths run.
- **diffusers_load.py** and **controlnet.py** – Present so `nodes` can import; controlnet is a stub that raises if used.

To use the slim vendor instead of the full one, set:

```bash
export FLUX_CCR_USE_SLIM_VENDOR=1
```

(or `FLUX_CCR_USE_SLIM_VENDOR=true` / `yes`). The same **COMFYUI_ROOT** override still applies if you want to point to a custom path.
