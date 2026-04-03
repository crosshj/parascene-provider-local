# Full image generation flow (provider API)

End-to-end path from the browser to a generated image when using the token-gated provider API (`app-new.html`).

---

## 1. Load app and token

- User opens **`/app-new.html`**.
- **app-new.js** reads `localStorage['parascene_api_token']`.
- If **no token**: only the token-gate UI is shown (input + “Save token”). User enters the same value as `PARASCENE_API_KEY` (server env or default `parascene-local-dev-token`), submits → token is stored and the page shows the generator form.
- If **token present**: the generator form is shown immediately.

---

## 2. Get capabilities and build the form

- **app-new.js** calls **GET `/api`** with header  
  `Authorization: Bearer <token>`.
- **api.js** `handleApiGet`:
  - Verifies the bearer token against `PARASCENE_API_KEY`; if invalid → **401** (frontend clears token and shows token gate).
  - Builds **model options** from **getModels()** (same registry as `resolveModel`), filtered to models with a registered Comfy workflow (and optional sd15/sdxl allowlists).
  - Returns **200** with JSON describing `text2image` and `fields.model.options`.
- **app-new.js** picks the default method (`text2image`), reads `fields.model.options`, and fills the **model `<select>`** with those options.

---

## 3. User submits “Generate”

- User fills prompt (and optionally negative prompt, dimensions, steps, cfg, seed) and clicks **Generate**.
- **app-new.js** collects form values into `body` (prompt, model, negative_prompt, width, height, steps, cfg, seed).

---

## 4. Start job (POST /api, no job_id)

- **app-new.js** sends **POST `/api`** with:
  - `Authorization: Bearer <token>`
  - Body: `{ method: "text2image", args: body }` (no `args.job_id`).
- **api.js** `handleApiPost`:
  - Checks bearer token again.
  - Parses body; validates `method` and `args`.
  - Sees no `args.job_id` → **Start** path.
  - For `method === "text2image"`:
    - Ensures `ctx.outputDir` is set (else **503**).
    - **enqueueText2ImageJob(args, ctx.outputDir)** (**scheduler.js**):
      - Validates prompt, model, and that the model has a registered workflow → **400** if invalid.
      - Stores job in the scheduler **jobs** map with `status: "pending"`.
      - Schedules the async **scheduler** loop which calls **`runComfyGeneration`** (Comfy HTTP `/prompt` + history + `/view`) when the job runs.
    - Responds immediately with **202** and `{ status: "pending", job_id }`.

---

## 5. Scheduler runs the job (Comfy)

- **scheduler.js** processes pending jobs one at a time (with model-key stickiness), calling **`runComfyGeneration`** with the job payload (prompt, dimensions, steps, cfg, seed, model metadata).
- On success, the job record gets `status: "succeeded"` and `result` including `image_url`, `backend: "comfy"`, etc. On failure, `status: "failed"` and an error message.

---

## 6. Frontend polls until done

- **app-new.js** has received **202** and **job_id**. It enters a loop:
  - **POST `/api`** with body `{ method: "text2image", args: { job_id } }`.
  - **api.js** sees `args.job_id` → **Poll** path:
    - Looks up the job. If missing → **404**.
    - If job `status === "pending"` or `"running"` → **202** `{ status, job_id }`.
    - If job `status === "succeeded"` or `"failed"` → **200** `{ status, job_id, result }` (image body path may apply for succeeded text2image per **api.js**).
- **app-new.js** waits between polls, then shows the image or error.

---

## 7. User sees the image

- The **result** includes `image_url` (e.g. `/outputs/abc123.png`). The browser requests **GET `/outputs/<file>`**, which **outputs.js** serves from `OUTPUT_DIR`.

---

## Summary of connections

- **Token:** app-new.js → `Authorization` on GET `/api` and POST `/api`.
- **Capabilities:** GET `/api` → filtered model list matching `resolveModel` / workflows.
- **Start job:** POST `/api` → **enqueueText2ImageJob** → pending job + **202** + `job_id`.
- **Execution:** **scheduler** → **runComfyGeneration** → Comfy HTTP API → file under `OUTPUT_DIR`.
- **Poll:** POST `/api` with `job_id` → job status / result.
- **Image:** `result.image_url` → GET `/outputs/...` → **handleOutputImage**.

All dots are connected: same token, same model list, same output dir for async jobs and static file serving.
