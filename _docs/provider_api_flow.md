# Full image generation flow (provider API)

End-to-end path from the browser to a generated image when using the token-gated provider API (`app_new.html`).

---

## 1. Load app and token

- User opens **`/app_new.html`**.
- **app_new.js** reads `localStorage['parascene_api_token']`.
- If **no token**: only the token-gate UI is shown (input + “Save token”). User enters the same value as `PARASCENE_API_KEY` (server env or default `parascene-local-dev-token`), submits → token is stored and the page shows the generator form.
- If **token present**: the generator form is shown immediately.

---

## 2. Get capabilities and build the form

- **app_new.js** calls **GET `/api`** with header  
  `Authorization: Bearer <token>`.
- **api.js** `handleApiGet`:
  - Verifies the bearer token against `PARASCENE_API_KEY`; if invalid → **401** (frontend clears token and shows token gate).
  - Builds **model options** from **getModels()** (same registry as `resolveModel`), so every option is a valid model name.
  - Returns **200** with JSON:
    - `status: "ok"`, `last_check_at`, `methods: [{ id: "text2img", default: true, name, description, intent, credits, fields: { model: { options: [{ label, value }] }, prompt } }]`.
- **app_new.js** picks the default method (`text2img`), reads `fields.model.options`, and fills the **model `<select>`** with those options. So the dropdown always matches what the server can resolve.

---

## 3. User submits “Generate”

- User fills prompt (and optionally negative prompt, dimensions, steps, cfg, seed) and clicks **Generate**.
- **app_new.js** collects form values into `body` (prompt, model, negative_prompt, width, height, steps, cfg, seed).

---

## 4. Start job (POST /api, no job_id)

- **app_new.js** sends **POST `/api`** with:
  - `Authorization: Bearer <token>`
  - Body: `{ method: "text2img", args: body }` (no `args.job_id`).
- **api.js** `handleApiPost`:
  - Checks bearer token again.
  - Parses body; validates `method` and `args`.
  - Sees no `args.job_id` → **Start** path.
  - For `method === "text2img"`:
    - Ensures `ctx.outputDir` is set (else **503**).
    - Generates **job_id** = `job_<timestamp36>_<random6>` (e.g. `job_m5k2x7_abc12d`).
    - **startText2ImgJob(jobId, args, ctx.outputDir)**:
      - Validates prompt and model; **resolveModel(args.model)** (using same registry as GET /api options) → **400** if unknown model.
      - Builds payload (prompt, model fullPath, family, negative_prompt, etc.) like **handleGenerate**.
      - Stores job in **jobs** map with `status: "pending"`.
      - Calls **runGenerator(payload, outputDir)** (from **generate.js**). That enqueues the job on the Python worker queue; the Promise is not awaited.
    - Responds immediately with **202** and `{ status: "pending", job_id }`.

---

## 5. Python worker runs the job

- **generate.js**: the existing queue feeds one job at a time to the Python worker. The worker writes one JSON line per completed job.
- When this job completes, **runGenerator**’s Promise resolves with `{ ok, file_name, seed, family, model, elapsed_ms }`.
- **api.js**’s `.then()` in **startText2ImgJob** runs:
  - Updates the job in **jobs** map: `status: "succeeded"`, `result: { ok: true, file_name, image_url: "/outputs/...", seed, family, model, elapsed_ms }` (or `status: "failed"`, `result: { ok: false, error }` on failure).

---

## 6. Frontend polls until done

- **app_new.js** has received **202** and **job_id**. It enters a loop:
  - **POST `/api`** with body `{ method: "text2img", args: { job_id } }`.
  - **api.js** sees `args.job_id` → **Poll** path:
    - Looks up **jobs.get(job_id)**. If missing → **404**.
    - If job `status === "pending"` → **202** `{ status: "pending", job_id }`.
    - If job `status === "succeeded"` or `"failed"` → **200** `{ status, job_id, result }`.
- **app_new.js**:
  - On **202**: waits 1.5s, then polls again.
  - On **200**: if `status === "succeeded"` and `result.image_url`, it sets the preview image to `result.image_url`, calls **renderMeta(result)**, and shows “Done.” If `status === "failed"`, it shows **result.error**.

---

## 7. User sees the image

- The **result** from the final **200** includes `image_url` (e.g. `/outputs/abc123.png`). The frontend sets `<img src="...">` to that URL; the browser requests **GET `/outputs/<file>`**, which **outputs.js** serves from the same output dir the generator wrote to. So the full chain is: token → GET /api (capabilities) → POST /api (start) → 202 + job_id → POST /api (poll) → 200 + result → GET /outputs/:file → image.

---

## Summary of connections

| Step              | Who              | Uses / produces |
|-------------------|------------------|-----------------|
| Token             | app_new.js       | `localStorage`, `Authorization` header |
| Capabilities      | GET /api         | getModels() → same names as resolveModel() |
| Model select      | app_new.js       | GET /api `methods[].fields.model.options` |
| Start job         | POST /api        | runGenerator(payload, ctx.outputDir), job_id |
| Job storage       | api.js           | jobs map, updated when runGenerator resolves |
| Poll              | POST /api        | jobs.get(job_id) → 202 or 200 + result |
| Image URL         | result.image_url | `/outputs/<file_name>` → handleOutputImage |

All dots are connected: same token for GET and POST, same model list for capabilities and text2img, same generator and output dir for the async job and for serving the file.
