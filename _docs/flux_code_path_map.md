# FLUX code path map: Comfy → files

Use this with **`_docs/flux_call_comfy_vs_diffusers.md`** to compare the Comfy path to **`generator/workflows/flux.py`** (diffusers).

**Entrypoint:** `generator/lib/flux_comfy_vendored.py` (`load_pipeline`, `generate`).  
**Full vendor:** `generator/lib/comfy_vendor/ComfyUI/`.

| Step | Where it's called | Comfy vendor files |
|------|-------------------|--------------------|
| **Load UNet** | `load_pipeline` → `nodes.UNETLoader().load_unet(...)` | `nodes.py` → `comfy/sd.py` (`load_diffusion_model`) → `comfy/model_detection.py`, `comfy/ldm/flux/model.py` |
| **Load CLIP** | `nodes.DualCLIPLoader().load_clip(...)` | `nodes.py` → `comfy/sd.py` (`load_clip`) → `comfy/text_encoders/flux.py` |
| **Load VAE** | `nodes.VAELoader().load_vae(...)` | `nodes.py` → `comfy/sd.py` (VAE) → `comfy/ldm/models/autoencoder.py` |
| **Encode text** | `CLIPTextEncodeFlux.execute(clip, prompt, prompt_2, guidance)` | `comfy_extras/nodes_flux.py` → clip `encode_from_tokens_scheduled` |
| **Zero out negative** | `nodes.ConditioningZeroOut().zero_out(positive)` | `nodes.py` (ConditioningZeroOut) |
| **Empty latent** | `EmptySD3LatentImage.generate(w, h, 1)` | `comfy_extras/nodes_sd3.py` → `torch.zeros([1, 16, h//8, w//8], ...)` |
| **Sample** | `nodes.KSampler().sample(...)` | `nodes.py` → `comfy/sample.py` → `comfy/samplers.py` → `comfy/k_diffusion/sampling.py` |
| **Decode** | `nodes.VAEDecode().decode(vae, sampled)` | `nodes.py` (VAEDecode) → vae `decode(samples)` |

**Diffusers side:** In `generator/workflows/flux.py`, `load_flux_with_local_components` does load (configs + state dicts + tokenizers); the pipeline `__call__` does encode + scheduler + sample + decode. Compare configs, key names, guidance, and latent shape (16ch, 8×) to the Comfy steps above.

**Note:** The flux-only tree (`generator/lib/comfy_vendor_flux_only/`) is missing some modules (e.g. `nodes.py`, `comfy/samplers.py`) because the build script’s init fails before they load (e.g. `torchsde`). Full vendor init also needs `torchsde` in the env. Use the **full vendor** paths above for reading the code path until the flux-only tree is complete or you install torchsde.
