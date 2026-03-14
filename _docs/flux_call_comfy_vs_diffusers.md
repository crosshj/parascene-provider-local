# The FLUX call: Comfy path vs your diffusers path

This doc spells out **exactly** what the Comfy-based FLUX path does (flux_ccr → flux_comfy_vendored), so you can compare it to **workflows/flux.py** (diffusers) and see why Comfy works and where yours might differ.

---

## 1. Load (Comfy)

Comfy does **not** use `FluxPipeline.from_single_file()` or `from_pretrained()`. It loads three pieces separately and keeps them as Comfy objects:

| Piece | Comfy call | What it does |
|-------|------------|--------------|
| **UNet** | `nodes.UNETLoader().load_unet(unet_name, "default")` | `comfy.sd.load_diffusion_model(unet_path, {})` → reads safetensors, detects FLUX via `model_detection`, builds `ldm.flux.model.FluxModel`, wraps in `ModelPatcher`. |
| **CLIP** | `nodes.DualCLIPLoader().load_clip(clip_name, t5_name, "flux", device)` | `comfy.sd.load_clip([clip_path, t5_path], ..., clip_type=FLUX)` → loads two state dicts, `text_encoders.flux` builds a dual-encoder (CLIP + T5) object Comfy calls "CLIP". |
| **VAE** | `nodes.VAELoader().load_vae(vae_name)` | Loads `ae.safetensors`, `comfy.sd.VAE(sd=sd)` → detects format from keys (e.g. diffusers-style `decoder.conv_in.weight`), builds `ldm.models.autoencoder.AutoencodingEngine` or similar, wraps in Comfy's VAE wrapper. |

So Comfy uses **Comfy’s** state-dict handling, model configs, and wrapper types (ModelPatcher, VAE, CLIP), not HuggingFace `from_pretrained` / diffusers `from_single_file`.

---

## 2. Generate (Comfy), step by step

Each step is what `flux_comfy_vendored.generate()` does in order:

1. **Encode text (positive)**  
   `positive = CLIPTextEncodeFlux.execute(clip, prompt, prompt_2, guidance)`  
   - Calls `clip.tokenize(prompt)` and `clip.tokenize(prompt_2)` (Comfy tokenizers).  
   - Then `clip.encode_from_tokens_scheduled(tokens, add_dict={"guidance": guidance})`.  
   - Returns a **conditioning** structure (list of tuples, with tensor + dict that includes the guidance value).  
   So: two prompts, one guidance scale; encoding is Comfy’s FLUX text pipeline, not HF `tokenizer()` + `text_encoder()`.

2. **Negative conditioning**  
   `negative = nodes.ConditioningZeroOut().zero_out(positive)`  
   - Takes the same structure and zeros out pooled output / conditioning_lyrics.  
   So: “negative” is not a separate negative prompt string; it’s the same conditioning with certain tensors zeroed.

3. **Empty latent**  
   `latent = EmptySD3LatentImage.generate(width, height, 1)`  
   - `torch.zeros([1, 16, height//8, width//8], device=...)`  
   So: 16 channels, 8× downscale (SD3-style latent shape for FLUX in Comfy).

4. **Sample**  
   `sampled = nodes.KSampler().sample(model, seed, steps, cfg, sampler_name, scheduler, positive, negative, latent, denoise)`  
   - `common_ksampler` → `comfy.sample.prepare_noise(...)`, `comfy.sample.fix_empty_latent_channels(model, latent_image)`, then `comfy.sample.sample(model, noise, steps, cfg, sampler_name, scheduler, positive, negative, latent_image, denoise=..., callback=..., seed=seed)`.  
   - Inside `comfy.sample.sample`: builds `comfy.samplers.KSampler(model, steps=..., device=model.load_device, sampler=sampler_name, scheduler=scheduler, denoise=denoise)` and calls `sampler.sample(noise, positive, negative, cfg=cfg, latent_image=latent_image, ...)`.  
   - That uses Comfy’s euler + simple scheduler, `model.apply_model(x, timestep, **cond)`, and Comfy’s CFG in the loop.  
   So: one denoising loop, Comfy’s scheduler and sampler, Comfy’s model forward and CFG application.

5. **Decode**  
   `images = nodes.VAEDecode().decode(vae, sampled)`  
   - `vae.decode(sampled["samples"])` → Comfy’s VAE decode (their wrapper around the same decoder you’d get from diffusers, but called via Comfy’s interface).  
   - Then `_tensor_to_pil(images[0])` for the final image.

So the “FLUX call” in Comfy is: **encode (Comfy FLUX text) → zero_out negative → empty latent (16ch, 8×) → one Comfy sample loop (euler, simple) → Comfy VAE decode**.

---

## 3. Your path (workflows/flux.py)

- **Load**: You use `FluxPipeline.from_single_file()` or `load_flux_with_local_components()` with diffusers/HuggingFace: `CLIPTextModel`, `T5EncoderModel`, tokenizers from config dirs, `AutoencoderKL.from_single_file()`, then `FluxPipeline.from_single_file(transformer_path, text_encoder=..., text_encoder_2=..., vae=..., tokenizer=..., tokenizer_2=...)`.  
  So: **different** load path (HF/diffusers configs and APIs, not Comfy’s state-dict + model_detection + ModelPatcher).

- **Generate**: You call `pipe(prompt=..., width=..., height=..., num_inference_steps=steps, generator=..., guidance_scale=guidance)` and then use `result.images[0]`.  
  So: one black-box `pipe()` call; diffusers does encoding, scheduling, sampling, and decode inside the pipeline.

So the **difference** is not “one call vs many”; it’s that:

- Comfy: **explicit** steps with Comfy’s types (conditioning, latent shape 16ch/8×, their scheduler/sampler, their apply_model and CFG).
- Yours: **diffusers pipeline** does the same conceptually, but with diffusers’ configs, tokenizers, and scheduler. If something is wrong (e.g. config, key names, guidance application, latent shape), the pipeline can fail or give different results.

To “un-architect from Comfy” and get to “just the flux call” you need a tree that contains **only** the code that runs for the steps above. Then you can:

- Compare **load**: Comfy’s UNet/CLIP/VAE load vs your `from_single_file` / `load_flux_with_local_components` (state dict keys, configs, shapes).
- Compare **generate**: Comfy’s encode → zero_out → empty latent → sample loop → decode vs what `pipe()` does under the hood (scheduler, steps, CFG/guidance, latent format).

---

## 4. Getting a FLUX-only tree so you can trim and compare

To get a vendor tree that contains **only** what runs for the FLUX path (no stubs, real code):

1. **Trace what actually loads**  
   Run the Comfy FLUX init (so `nodes` → `comfy.sd` → … pull in everything they use). Record every module that gets loaded from the vendor.

2. **Copy that subset**  
   Copy only those files into a new directory (e.g. `lib/comfy_vendor_flux_only`). That tree is “slim” in the sense of “only FLUX-related code,” and you can read it to see the exact load/generate path.

**Script:** `scripts/build_flux_only_vendor.py`

- From `generator/`:  
  `FLUX_CCR_USE_SLIM_VENDOR=0 python -m scripts.build_flux_only_vendor`
- Requires the same deps as the FLUX CCR workflow (e.g. `PIL`, `torch`, `safetensors`; see generator requirements). If init fails (e.g. `No module named 'PIL'`), install deps then re-run.
- Writes a copy of the vendor containing only modules that were loaded during init (default: `lib/comfy_vendor_flux_only`). Log: `generator/_docs/build_flux_only_vendor.log`.
- Use `--trace-only` to only print the set of loaded modules and files (no copy).
- Use `--out-dir <path>` to choose the output directory.

After building, point your runtime at that tree (e.g. `COMFYUI_ROOT=lib/comfy_vendor_flux_only`) and run the FLUX workflow. Then you can diff or compare that code path to `workflows/flux.py` (diffusers) and see why Comfy’s path works and where the diffusers path diverges.
