# Models: disk → API → UI → generate

Notes on registry, metadata, and checkpoint vs diffusion-model loading.

## Disk scan

- `MODELS_BASE` env → root of Comfy-style tree (default path is Windows-oriented in code).
- `server/handlers/models.js`: fixed `MODEL_DIRS` list (each row = rel path + **family**, **loadKind**, **managedWorkflowId**, **comfyCheckpointGroup**), recursive `.safetensors`, dedupe by abs path. Rows **without** a `managedWorkflowId` are omitted from the list (nothing to register in `workflows/_index.js` yet).
- **modelId** = path relative to `MODELS_BASE` with `/` (stable client key).
- **name** = display stem; if two files share the same stem in one family, suffix ` (checkpoint)` / ` (diffusion)`.
- cached for process lifetime → rescan = restart server.
- `checkpoints\FLUX1` is always scanned for flux checkpoint entries (no `INCLUDE_FLUX_CHECKPOINTS` flag).

## Checkpoint vs diffusion model

- **diffusion_model** rows: e.g. `diffusion_models\z-image`, `diffusion_models\qwen` — UNet/transformer weights; `diffusionModelComfyName` is the Comfy picker string under `diffusion_models`.
- **checkpoint** rows: under `checkpoints\…` — `comfyCheckpointGroup` is the folder segment for `CheckpointLoaderSimple` (e.g. `FLUX1`, `1.5`).
- **managedWorkflowId** — which `server/generator/workflows/*.js` builder to run; required for every scanned row that appears in the API.

## API

- `GET /api/models` → each model: `modelId`, `name`, `file`, `family`, `loadKind`, `managedWorkflowId`, `comfyCheckpointGroup`, `diffusionModelComfyName`, `defaults` (still no `fullPath`). Policy payload may include `defaultManagedComfyFamilies` (often empty now that routing is Comfy-only).
- `GET /api` provider options use **`modelId`** as `value` (label still `family: name`). Options are filtered to models with a registered workflow plus optional allowlists for sd15/sdxl.
- `POST /api/generate` / jobs: **`body.model` / `args.model` should be `modelId`** (legacy unique `name` / filename still resolves if unambiguous).

## UI (`server/public/app.js`)

- Dropdown value = **modelId**; text = **name**.

## Generate

- `resolveModel` → full entry including `managedWorkflowId`, `loadKind`, Comfy hints.
- Generation runs **only** when `managedWorkflowId` is registered in `workflows/_index.js`; otherwise **400**.
- Workflow choice is **`managedWorkflowId`**, not family alone — add new ids in `_index.js` as you add JSON graphs.

## TL;DR

- Rich metadata is on each model row; workflow routing uses **managedWorkflowId**.
- **modelId** is the stable selection key end-to-end.
- All supported models go through **Comfy** (`backend: "comfy"`).
