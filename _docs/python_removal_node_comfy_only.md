# Notes: drop Python worker, Node → Comfy only

- Remove the Node-spawned worker under `generator/` (`generate.py`, diffusers, etc.).
- All image gen goes through `runComfyGeneration` → Comfy HTTP API.

## Intent: mirror the **server ↔ engine** contract, not Python’s internals

- **Out of scope:** Matching how **`generate.py`** / diffusers did math inside (schedulers, exact defaults, pixel parity). Comfy can differ internally; that is fine.
- **In scope:** Keep the **operational contract** the Node server and the **service** (supervisor) already rely on for “the child process that does generation,” but with **Comfy** in that role instead of the Python worker.
- **Examples of that contract (mirror or explicitly migrate together):**
  - **Warm / ready:** same idea as `ensureWorkerStarted` → process is up before handling gen (today `ensureManagedComfyReady`; keep the guarantee).
  - **`GET /api/health`:** whatever **`service`** and **`app-status.js`** use today (`worker.running`, `worker.pid`, rollout cleanup via `health.worker.pid`) should have an **equivalent** for Comfy—either **same field names** with new semantics, or **one coordinated rename** across server + service + UI so nothing silently breaks.
  - **PID / orphan cleanup:** `runtime/.worker.pid`, `killOrphanWorker`, post-rollout `cleanupWorkerPid` — same **lifecycle story** for “the generation subprocess,” pointing at the Comfy PID (or drop PID file only if deploy story no longer needs it and all callers agree).
  - **Recycle / deploy hooks:** `performPythonRecycle`, update-queue “python recycle” — same **hook points** and guarantees (e.g. “after deploy, a fresh engine comes up”), even if the implementation becomes “restart Comfy” and log lines rename.
  - **Job / response shape to clients:** `POST /api/generate` and async jobs still return the same **success payload shape** (`ok`, `file_name`, `image_url`, `seed`, `family`, `model`, `elapsed_ms`, `backend` label policy)—only the engine behind it changes.
- **Net:** replace Python **wiring** and **observability** with Comfy; do **not** require Comfy workflows to copy Python’s internal generation choices unless you want that separately.

## Scope

- ComfyUI itself stays a **separate** Python process (`managed-instance.js` or a remote URL later).
- Only **in-repo** `/generator` application code is deleted—not “Python” on the machine in general.

## Python worker slot → Comfy slot (same integration story)

- **Same shape:** one **long-lived generation engine** the Node app owns; **warm on boot**; **visible in `/api/health`**; **PID** (or equivalent) for rollout/orphan cleanup; **service** still proxies and cares about deploy/recycle the same way—only the **process** behind the slot changes (stdin/stdout worker → Comfy HTTP + managed Comfy process).
- **Likely difference — kill / recycle policy:** the old Python worker was cheap to **restart**, so recycle hooks and “blow it away” behavior could be **aggressive**. **Comfy is heavier** (startup, model graph, VRAM); prefer **fewer full restarts**—recycle on **deploy**, **stuck** state, or an **explicit** operator path—not on every minor signal you might have used for Python. Document the chosen policy so **service** / update-queue hooks match (e.g. `performPythonRecycle` becomes rare Comfy restart vs no-op when Node restart already suffices).

## Health: what feeds what

- **`GET /system_stats`** (and similar) live on **Comfy’s** HTTP server (Comfy host/port). They are **not** routes on the Node provider app.
- **`GET /api/health`** is the **provider contract** (clients, **service**, `app-status.js`). Node **implements** it by probing Comfy internally (e.g. HTTP GET to Comfy’s **`/system_stats`**) and **merging** that signal into the JSON you expose—plus whatever else belongs there (jobs, paths, engine pid).
- **Liveness vs readiness:** Comfy “up” from a cheap GET is **liveness**; stronger “can actually run a graph” checks stay optional and also live **behind** `/api/health` if you add them.

## `models.js` registry

- `managedWorkflowId: null` today ⇒ Python-only path. Examples:
  - `diffusion_models\flux` (diffusion weights; checkpoint flux already has `text2image-flux-checkpoint`)
  - `checkpoints\pony`
  - `checkpoints\WAN`
- For each such row, either:
  - add `server/generator/workflows/<id>.js`, register in `workflows/_index.js`, set `managedWorkflowId`; or
  - remove / don’t expose the model; or
  - return **400** until a workflow exists.
- Any exposed model must resolve to a supported workflow—no silent fallback to Python.

## `generate.js`

- Strip: Python worker spawn, IPC queue, orphan kill of **that** child, SIG teardown tied to it, `GENERATOR_PYTHON_EXECUTABLE`, `PYTHON_WORKER_EXECUTABLE_OVERRIDE`.
- **PID file:** if **`service`** still expects `runtime/.worker.pid` (or similar), either write **Comfy’s** PID there or rename the file/key and update **service** in one go—don’t drop the contract by accident.
- Strip exports/impl: `runGenerator`, `ensureWorkerStarted`, `getWorkerStatus` (replace with Comfy-shaped status if you keep a `worker` field in health).
- `handleGenerate`: only `runComfyGeneration`; unsupported entry ⇒ **400**.
- Single `backend` value (drop `python-worker`).
- Keep `sanitizePromptText` (scheduler still needs it); optional move to `server/lib.js`.

## Other server files

- `scheduler.js`: `runComfyGeneration` only; align job `backend` with sync handler.
- `server.js`: drop `ensureWorkerStarted` warm start; keep `ensureManagedComfyReady`.
- `health.js`: don’t leave consumers blind—either keep **`worker`-shaped** fields (pid/running) for Comfy as a drop-in, or add **`comfy`** and update **service + `app-status.js`** in the same change so the contract stays coherent. Comfy’s own URLs (e.g. **`/system_stats`**) are probed **from Node** to build this response—see **Health: what feeds what** above.
- `generator/comfy/index.js`:
  - remove: `wantsManagedComfyBackend`, default-family list, `forcePythonWorker`, `useManagedComfy` policy
  - keep: `runComfyGeneration`, `ensureManagedComfyReady`, `getManagedComfyStatus`, `isManagedComfyWorkflowSupported`

## UI (`app.html`, `app.js`)

- Remove force-Python checkbox and related `featureFlags`.
- Remove Flux checkpoint vs diffusion list behavior tied to that toggle.
- Clean persisted keys (`force_python_worker`, `use_managed_comfy` migrations).
- Drop `python-worker` string in “backend” display.

## `service/`

- Preserve **rollout/orphan** behavior with Comfy: `getHealthJson` → **`worker.pid`** (or agreed replacement) used in **`performNodeRollout`** / **`cleanupWorkerPid`** should still resolve to the **generation engine** PID, or you intentionally redesign those paths and test deploy.
- `killOrphanWorker` / `runtime/.worker.pid`: repoint to Comfy PID, rename file/key in lockstep with server, or remove only if nothing else needs PID cleanup.
- `performPythonRecycle` / `onRollingPythonRecycle`: keep the **hook**; implement as Comfy restart (or no-op if redundant with Node restart); rename logs/events so ops isn’t tied to “python.”
- `updater/updateQueue.js`: align “recycle” messaging with the new engine name.
- `service/README.md`: describe Comfy as the server-owned engine (same ownership story as the old worker).

## Delete from repo

- `generator/generate.py`
- `generator/workflows/*.py`
- `generator/lib/` (incl. `comfy_vendor`)
- `generator/requirements.txt`, `setup_configs.py`, `generator/configs/` if generated
- venv / pip-only setup notes that only served the worker

`.gitignore` entry for `.worker.pid` can stay.

## Env / operator docs

- Remove env vars that only existed for **`generate.py`** / the worker IPC path; document whatever still matters for **launching and locating Comfy** (`managed-instance.js`, `MODELS_BASE`, optional `COMFY_BASE_URL`).
- Reminder: Comfy’s own `python` / `python_embeded` for ComfyUI is unrelated to deleting **`generator/`** app code.

## Docs to edit

- `README.md` — Node + Comfy; fix broken `_docs/BIRDS_EYE_VIEW.md` link if present
- `_docs/models_disk_to_generate.md` — no Python/flux-toggle; workflows required
- `_docs/provider_api_flow.md` — Comfy + scheduler path, not `runGenerator`

## Smoke / verify

- **Contract:** After changes, **`/api/health`** + **service proxy** + **`app-status.js`** agree on how “engine up” and **pid** are reported; deploy/rollout still cleans up the right process or you’ve consciously removed that need.
- **Product:** Hit generate + `/api` text2img for each remaining `MODEL_DIRS` row; `OUTPUT_DIR` still matches `outputs.js`.

## Later (optional)

- Remote Comfy base URL.
- Filter `GET /api/models` by `isManagedComfyWorkflowSupported`.
- Rename `server/generator/` → `server/comfy/` if the name helps.
