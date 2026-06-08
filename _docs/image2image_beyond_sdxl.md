# Image-to-image beyond SDXL

Notes on what it would take to support `image2image` for model families other than SDXL.

---

## Current state

- Only [`server/workflows/image2image/sdxl-checkpoint.json`](../server/workflows/image2image/sdxl-checkpoint.json) is registered in [`server/workflows/_index.js`](../server/workflows/_index.js).
- [`server/lib/comfy-args.js`](../server/lib/comfy-args.js) routes `image2image` only when `entry.family === "sdxl"`, and always sets `managedWorkflowId: "image2image-sdxl-checkpoint"`.
- The provider API [`server/configs/provider-api-config.js`](../server/configs/provider-api-config.js) lists SDXL checkpoints only for `image2image`.

The SDXL i2i graph is a specific pattern:

`CheckpointLoaderSimple` → `LoadImage` → `ResizeAndPadImage` → `VAEEncode` → `KSampler` (denoise &lt; 1) → `VAEDecode`

---

## Do we need separate workflows?

**Yes — separate Comfy graphs per architecture (like text-to-image), not one graph per checkpoint file.**

T2i stacks already differ by family. None of the t2i JSON templates include an image input path. Enabling i2i means adding `LoadImage` plus encode/conditioning wired the way each stack expects — not reusing the SDXL i2i graph with a different checkpoint name.

| Family | T2i latent source | Loaders / conditioning |
| --- | --- | --- |
| SDXL / Pony | `EmptyLatentImage` | Single checkpoint |
| SD15 | `EmptyLatentImage` | Checkpoint, 512 defaults |
| Flux checkpoint | `EmptySD3LatentImage` | Checkpoint + `CLIPLoader` + `VAELoader` + `FluxGuidance` |
| Flux diffusion | `EmptySD3LatentImage` | `UNETLoader` + `ModelSamplingFlux` |
| Qwen | `EmptySD3LatentImage` | `UNETLoader` + `ModelSamplingAuraFlow`; edit weights may need reference-image conditioning |

Flux i2i is not “SDXL i2i with a Flux checkpoint.” It needs external VAE encode, `FluxGuidance`, cfg ≈ 1, and the correct latent nodes. Qwen edit models (`qwen_image_edit_*`) may need a dedicated edit workflow rather than plain `VAEEncode` + denoise.

---

## What to add (workflow inventory)

One i2i workflow per `(family, loadKind)` — same grouping as t2i, many models per graph:

| `managedWorkflowId` | Status | Notes |
| --- | --- | --- |
| `image2image-sdxl-checkpoint` | **Exists** | Pony can likely share this stack |
| `image2image-sd15-checkpoint` | New | Adapt from `text2image-sd15-checkpoint` |
| `image2image-flux-checkpoint` | New | Export from Comfy; separate CLIP/VAE + `FluxGuidance` |
| `image2image-flux-diffusion` | New | UNET + `ModelSamplingFlux` path |
| `image2image-qwen-diffusion` | New | Likely its own edit graph, not a generic VAE-encode clone |

For each new workflow:

1. Export or adapt the graph in ComfyUI.
2. Add a JS builder under `server/workflows/image2image/` (patch `LoadImage`, resize targets, denoise, and family-specific nodes).
3. Register in `server/workflows/_index.js`.
4. Extend `comfy-args.js` routing: choose `managedWorkflowId` from `family` + `loadKind` instead of hardcoding SDXL.
5. Add eligible models to `provider-api-config.js` (and optionally `GET /api/models` if using `app.html`).

---

## What does *not* need separate workflows

- **Aspect ratios** — already handled in [`server/lib/aspect-ratio.js`](../server/lib/aspect-ratio.js) (`aspect_ratio` → `width`/`height`). Each i2i builder only needs to patch resize/latent nodes (as SDXL does on `ResizeAndPadImage` `target_width` / `target_height`).
- **Individual checkpoint files** — same override pattern as t2i (`modelFile`, `comfyCheckpointGroup`, `diffusionModelComfyName` on the payload).

---

## Summary

Separate Comfy **graphs** per architecture are required; you do not need a new graph for every model file. Most of the work is exporting workflows, registering builders, and relaxing the SDXL-only gate in `comfy-args.js`. Flux and Qwen are the families most likely to need genuinely different graphs rather than a small tweak to the SDXL i2i template.
