# Models: disk → API → UI → generate

Notes on registry, metadata, and checkpoint vs diffusion-model loading.

## Disk scan

- `MODELS_BASE` env → root of Comfy-style tree (default path is Windows-oriented in code).
- `server/handlers/models.js`: fixed `MODEL_DIRS` list (each row = rel path + **family**, **loadKind**, **managedWorkflowId**, **comfyCheckpointGroup**), recursive `.safetensors`, dedupe by abs path.
- **modelId** = path relative to `MODELS_BASE` with `/` (stable client key).
- **name** = display stem; if two files share the same stem in one family, suffix ` (checkpoint)` / ` (diffusion)`.
- cached for process lifetime → rescan = restart server.
- `checkpoints\FLUX1` is always scanned for flux checkpoint entries (no `INCLUDE_FLUX_CHECKPOINTS` flag).

## Checkpoint vs diffusion model

- **diffusion_model** rows: under `diffusion_models\flux`, `diffusion_models\z-image` — UNet/transformer weights; `diffusionModelComfyName` is the Comfy picker string under `diffusion_models`.
- **checkpoint** rows: under `checkpoints\…` — `comfyCheckpointGroup` is the folder segment for `CheckpointLoaderSimple` (e.g. `FLUX1`, `1.5`).
- **managedWorkflowId** — which `server/generator/workflows/*.js` builder to run (`null` = no managed Comfy graph for that file yet).

## API

- `GET /api/models` → `policy.defaultManagedComfyFamilies` plus each model: `modelId`, `name`, `file`, `family`, `loadKind`, `managedWorkflowId`, `comfyCheckpointGroup`, `diffusionModelComfyName`, `defaults` (still no `fullPath`).
- `GET /api` provider options use **`modelId`** as `value` (label still `family: name`).
- `POST /api/generate` / jobs: **`body.model` / `args.model` should be `modelId`** (legacy unique `name` / filename still resolves if unambiguous).

## UI (`server/public/app.js`)

- Dropdown value = **modelId**; text = **name**.
- **Force Python worker** checkbox → `featureFlags.forcePythonWorker`; when off, **flux** list shows only **checkpoint** rows (managed Comfy path); when on, flux list shows only **diffusion_model** rows (Python worker). Other families unchanged.
- Unchecked = server default backend: families in `DEFAULT_MANAGED_COMFY_FAMILIES` use managed Comfy when the model has a `managedWorkflowId`.

## Generate

- `resolveModel` → full entry including `managedWorkflowId`, `loadKind`, Comfy hints.
- **Managed Comfy** when `wantsManagedComfyBackend` (defaults + flags) **and** `managedWorkflowId` is registered in `workflows/_index.js`. Explicit `useManagedComfy: true` with an incompatible model → **400**.
- Workflow choice is **`managedWorkflowId`**, not family alone — add new ids in `_index.js` as you add JSON graphs.

## Env

- `DEFAULT_MANAGED_COMFY_FAMILIES` — comma list, default `flux,sd15`. Those families prefer managed Comfy unless `forcePythonWorker` or `useManagedComfy: false`.

## TL;DR

- Rich metadata is on each model row; workflow routing uses **managedWorkflowId**.
- **modelId** is the stable selection key end-to-end.
- Flux UI split follows checkpoint vs diffusion **loadKind** + the force-Python toggle.
