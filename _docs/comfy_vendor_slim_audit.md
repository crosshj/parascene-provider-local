# comfy_vendor_slim audit: what’s used and with what values

This doc ties every part of `generator/lib/comfy_vendor_slim` to the actual workflow in `flux_comfy_vendored` and the values passed. Only what’s listed is required for that hot path.

---

## 1. Entry: flux_comfy_vendored

- **load_pipeline**: uses `folder_paths`, `nodes.UNETLoader`, `nodes.DualCLIPLoader`, `nodes.VAELoader`.
- **generate**: uses `nodes.ConditioningZeroOut`, `nodes.KSampler`, `nodes.VAEDecode`, `CLIPTextEncodeFlux`, `EmptySD3LatentImage`.
- **_init_comfy_runtime**: imports `comfy.options`, `folder_paths`, `nodes`, `comfy.model_management`, `comfy.ldm.modules.attention`, `comfy_extras.nodes_flux`, `comfy_extras.nodes_sd3`; assigns `XFORMERS_IS_AVAILABLE`, `XFORMERS_ENABLED_VAE` when xformers disabled; optionally reads `extra_model_paths.yaml` and calls `folder_paths.add_model_folder_path`.

---

## 2. Actual argument values (from flux_comfy_vendored)

| Call | Values |
|------|--------|
| **load_pipeline** | |
| _find_comfy_model_name | category=`"diffusion_models"` |
| UNETLoader().load_unet | unet_name=resolved name, weight_dtype=env `FLUX_CCR_WEIGHT_DTYPE` default **`"default"`** |
| DualCLIPLoader().load_clip | clip_name, t5_name, type=**`"flux"`**, device=env `FLUX_CCR_CLIP_DEVICE` default **`"default"`** or `"cpu"` |
| VAELoader().load_vae | vae_name=env `FLUX_CCR_VAE` default **`"ae.safetensors"`** (normal file in `vae` folder) |
| **generate** | |
| CLIPTextEncodeFlux.execute | clip, prompt, prompt_2, guidance (float) |
| ConditioningZeroOut().zero_out | positive (conditioning from above) |
| EmptySD3LatentImage.generate | width, height, **batch_size=1** |
| KSampler().sample | model, seed, steps, cfg, sampler_name=**`"euler"`** (payload default), scheduler=**`"simple"`** (payload default), positive, negative, latent, denoise |
| VAEDecode().decode | vae, sampled (latent dict) |

---

## 3. File-by-file necessity

### comfy/options.py
- **enable_args_parsing(enable=True)** — called once in _init_comfy_runtime. No other code in the workflow reads `args_parsing`. So only a callable that accepts `True` is required.

### comfy/cli_args.py
- **args.base_directory** — read by folder_paths at import; workflow never passes `--base-directory`, so it is always `None`. Only need an object with `base_directory = None` (e.g. a small namespace). No argparse needed.

### folder_paths.py
- **Categories used**: `diffusion_models` (_find_comfy_model_name, UNETLoader), `text_encoders` (DualCLIPLoader), `vae` (VAELoader), `embeddings` (get_folder_paths in load_clip). Plus **add_model_folder_path** with keys from `extra_model_paths.yaml` when present.
- **Functions used**: get_filename_list, get_full_path, get_full_path_or_raise, get_folder_paths, add_model_folder_path. map_legacy used internally (unet→diffusion_models, clip→text_encoders).
- **Not used**: output_directory, temp_directory, input_directory, user_directory and their get/set; other folder categories (checkpoints, loras, clip_vision, etc.). Trimmed to the four categories above.

### nodes.py
- **MAX_RESOLUTION** — referenced by full-vendor node schemas; slim nodes_sd3 doesn’t use it (removed import).
- **ConditioningZeroOut** — generate: zero_out(positive). Only needs torch; no comfy deps.
- **VAEDecode** — generate: decode(vae, sampled). Only vae.decode(samples["samples"]); no comfy deps.
- **UNETLoader** — load_pipeline: load_unet(unet_name, weight_dtype). weight_dtype is only ever `"default"` in practice; fp8 options unused. Trimmed to single option and empty model_options.
- **DualCLIPLoader** — load_pipeline: load_clip(clip_name, t5_name, "flux", clip_device). type is always `"flux"`; device `"default"` or `"cpu"`. INPUT_TYPES and load_clip trimmed to flux-only; device branch kept.
- **VAELoader** — load_pipeline: load_vae(vae_name) with vae_name from `vae` folder (e.g. ae.safetensors). No pixel_space/taesd/vae_approx; trimmed to single path.
- **common_ksampler** — used by KSampler.sample; in slim, comfy.sample.sample raises. Needed so nodes import and KSampler.sample is definable. Uses: comfy.sample (fix_empty_latent_channels, prepare_noise, sample), latent_preview.prepare_callback, comfy.utils.PROGRESS_BAR_ENABLED.
- **KSampler** — generate: sample(..., sampler_name, scheduler, ...) with defaults "euler", "simple". INPUT_TYPES only needs SAMPLERS and SCHEDULERS; trimmed to `["euler"]` and `["simple"]`.

### comfy/sd.py
- **CLIPType** — only value passed is `"flux"`. Enum trimmed to FLUX only.
- **load_clip** — default clip_type=CLIPType.FLUX; model_options only for device when device=`"cpu"`. Stub raises.
- **load_diffusion_model** — called with model_options={}. Stub raises.
- **VAE** — VAELoader builds VAE(sd=sd); decode() and throw_exception_if_invalid() used by VAEDecode. Stub VAE has both; decode raises in slim.

### comfy/sample.py
- **prepare_noise**, **fix_empty_latent_channels** — used by common_ksampler. In slim, sample() raises so they only need to be callable for the chain to be definable; fix_empty_latent_channels uses model.get_model_object and comfy.utils.repeat_to_batch_size.
- **sample** — stub raises. Required so common_ksampler can call it.

### comfy/samplers.py
- **KSampler.SAMPLERS**, **KSampler.SCHEDULERS** — only read for nodes.KSampler.INPUT_TYPES. Workflow only passes sampler_name=`"euler"` and scheduler=`"simple"`. Trimmed to SAMPLER_NAMES = ["euler"], SCHEDULER_NAMES = ["simple"].
- **KSampler** class — only the class and those two class attributes are used; __init__ is never successfully used in slim (sample path raises).

### comfy/utils.py
- **load_torch_file** — VAELoader.load_vae (vae file path). Hot path is .safetensors; .ckpt/.pt fallback kept for compatibility.
- **repeat_to_batch_size** — comfy.sample.fix_empty_latent_channels.
- **PROGRESS_BAR_ENABLED** — common_ksampler (disable_pbar). Value only read, never written in slim.

### comfy/model_management.py
- **XFORMERS_IS_AVAILABLE**, **XFORMERS_ENABLED_VAE** — written in _init_comfy_runtime when FLUX_CCR_DISABLE_XFORMERS=1. Must exist and be assignable.
- **intermediate_device()** — called by EmptySD3LatentImage.generate() for the empty latent tensor device. Returns cpu in slim.

### comfy/ldm/modules/attention.py
- **optimized_attention**, **attention_pytorch** — when xformers disabled, _init_comfy_runtime does optimized_attention = attention_pytorch. Both must exist; stub implements both as the same callable.

### latent_preview.py
- **prepare_callback(model, steps)** — used by common_ksampler. Stub returns a no-op callback. x0_output_dict optional; workflow doesn’t rely on it.

### comfy_extras/nodes_flux.py
- **CLIPTextEncodeFlux.execute(cls, clip, clip_l, t5xxl, guidance)** — generate: execute(pipe["clip"], prompt, prompt_2, guidance). Real implementation: tokenize + encode_from_tokens_scheduled; returns (result,) for _unwrap_node_output.

### comfy_extras/nodes_sd3.py
- **EmptySD3LatentImage.generate(width, height, batch_size=1)** — generate: generate(width, height, 1). Real implementation: torch.zeros(..., device=intermediate_device()). nodes import was unused; removed.

---

## 4. Summary of trims applied

- **folder_paths**: Only diffusion_models, text_encoders, vae, embeddings; removed other categories and output/temp/input/user directory vars and getters/setters.
- **cli_args**: Replaced argparse with a simple namespace (base_directory=None).
- **nodes.UNETLoader**: weight_dtype only "default"; model_options always {}.
- **nodes.DualCLIPLoader**: type only "flux"; clip_type fixed to CLIPType.FLUX.
- **nodes.VAELoader**: Only vae-folder path (no pixel_space/taesd).
- **comfy.sd.CLIPType**: Only FLUX.
- **comfy.samplers**: SAMPLER_NAMES = ["euler"], SCHEDULER_NAMES = ["simple"].
- **comfy_extras.nodes_sd3**: Removed unused `import nodes`.

---

## 5. What is not used (and removed or left as stub)

- **options.args_parsing** — set but never read in slim; enable_args_parsing still called.
- **folder_paths** — all folder keys other than the four above; output/temp/input/user directories.
- **load_pipeline with slim only** — fails at load_unet (stub raises). generate with slim-only never runs successfully; common_ksampler/sample path exists so that imports and node definitions work, but sample() raises in slim.
