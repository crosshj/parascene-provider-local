# app.html method-first + capabilities wiring (notes)

These are notes of the intended changes discussed for making `app.html` method-first and aligned with the capabilities GET (`GET /api`) used by `app-new.html`. They are written as guidance, not yet fully applied code.

## Backend (already applied)

- `server/handlers/models.js`
  - Added:
    - `methods: deriveModelMethods(m)` on each model JSON.
    - `supportsImageInput: deriveSupportsImageInput(m)`.
  - Special-cased SDXL:
    - `managedWorkflowId === "text2image-sdxl-checkpoint" && family === "sdxl"` → `methods: ["text2image", "image2image"]`.

- `server/workflows/image2image/sdxl-checkpoint.js`
  - New builder that:
    - Clones `image2image/sdxl-checkpoint.json`.
    - Sets `workflow["6"].inputs.text` to `prompt`.
    - Sets `workflow["33"].inputs.text` to `negativePrompt`.
    - Sets `workflow["31"].inputs.seed/steps/cfg` from overrides.
    - Sets `workflow["34"].inputs.image = inputImageFilename`.

- `server/workflows/_index.js`
  - Registered:
    - `"image2image-sdxl-checkpoint": require("./image2image/sdxl-checkpoint.js")`.

- `server/generator/image-input.js`
  - `downloadImagesToComfyInput(urlArray)` downloads image URLs into Comfy’s `input` dir and returns filenames.

- `server/handlers/generate.js`
  - Now accepts both text2image and image2image via `method` and `image_url`:

  ```js
  const method = String(body.method || "").trim() || "text2image";
  const seed = /* from body.seed or randomInt */;

  function runWithWorkflow(managedWorkflowId, extraOverrides = {}) {
    return runComfyGeneration(
      {
        family: entry.family,
        managedWorkflowId,
        modelFile: entry.file,
        modelPath: entry.fullPath,
        comfyCheckpointGroup: entry.comfyCheckpointGroup,
        diffusionModelComfyName: entry.diffusionModelComfyName,
        loadKind: entry.loadKind,
        prompt,
        negativePrompt,
        seed,
        width: body.width,
        height: body.height,
        steps: body.steps,
        cfg: body.cfg,
        ...extraOverrides,
      },
      ctx.outputDir,
    );
  }

  if (method === "image2image" && entry.family === "sdxl") {
    const imageUrl = String(body.image_url || "").trim();
    if (!imageUrl) {
      return sendJson(res, 400, {
        error: "image2image requires image_url to be provided.",
      });
    }
    generationPromise = downloadImagesToComfyInput([imageUrl]).then((files) => {
      const [filename] = files;
      if (!filename) {
        throw new Error("Failed to prepare input image for image2image.");
      }
      return runWithWorkflow("image2image-sdxl-checkpoint", {
        inputImageFilename: filename,
      });
    });
  } else {
    generationPromise = runWithWorkflow(entry.managedWorkflowId);
  }
  ```

- `server/handlers/api.js` (`handleApiGet`)
  - Capabilities `GET /api` now exposes:
    - `methods.text2image` (unchanged, but model options filtered).
    - New `methods.image2image` with:

  ```js
  const image2ImageModels = filteredModels.filter((m) =>
    Array.isArray(m.methods) ? m.methods.includes("image2image") : false,
  );
  const image2ImageModelOptions = image2ImageModels.map((m) => ({
    label: `${m.family}: ${m.name}`,
    value: m.modelId,
  }));

  methods: {
    text2image: { /* existing fields */ },
    image2image: {
      id: "image2image",
      default: false,
      async: true,
      name: "Image To Image",
      description: "Generate an image from an input image and text.",
      intent: "image_generate",
      credits: TEXT2IMAGE_CREDITS,
      fields: {
        model: {
          label: "Model",
          type: "select",
          required: true,
          options: image2ImageModelOptions,
        },
        prompt: {
          label: "Prompt",
          type: "text",
          required: true,
        },
        image_url: {
          label: "Image URL",
          type: "text",
          required: true,
        },
      },
    },
  }
  ```

## Frontend: intended method-first behaviour for `app.html`

Target file: `server/public/app.js`.

Key goals:

- Use `GET /api` (capabilities) to:
  - Build the **Method** dropdown from `Object.keys(data.methods)`.
  - Build the **Model** dropdown for each method from `methods[methodId].fields.model.options`.
  - Toggle `image_url` visibility based on whether the selected method declares an `image_url` field.
- POST `/api/generate` stays as is:

  ```js
  {
    prompt,
    negative_prompt,
    model,
    width, height, steps, cfg,
    seed?,
    method,      // "text2image" | "image2image"
    image_url?,  // for image2image
  }
  ```

### Planned `app.js` changes (not all applied)

1. **Globals**

   ```js
   const STORAGE_KEY = "local-image-generator.form.v2";

   let modelRegistry = {};
   let capabilitiesMethods = null; // from GET /api
   let perMethodModel = {}; // remember last model per method
   ```

2. **Extend `collectFormValues`**

   ```js
   function collectFormValues() {
     return {
       prompt: form.prompt.value,
       negative_prompt: form.negative_prompt.value,
       model: modelSel.value,
       width: form.width.value,
       height: form.height.value,
       steps: form.steps.value,
       cfg: form.cfg.value,
       seed: form.seed.value,
       method: methodSel ? methodSel.value : "",
       image_url: form.image_url ? form.image_url.value : "",
       perMethodModel,
     };
   }
   ```

3. **Restore `perMethodModel` during init**

   After `savedValues = restoreSavedValues();`:

   ```js
   savedValues = restoreSavedValues();
   if (
     savedValues &&
     savedValues.perMethodModel &&
     typeof savedValues.perMethodModel === "object"
   ) {
     perMethodModel = { ...savedValues.perMethodModel };
   }
   loadModels();
   ```

4. **Load capabilities from `/api`**

   ```js
   async function loadCapabilities() {
     if (capabilitiesMethods) return capabilitiesMethods;
     const res = await apiFetch("/api", { method: "GET" });
     const data = await res.json();
     const methods =
       data && data.methods && typeof data.methods === "object"
         ? data.methods
         : {};
     capabilitiesMethods = methods;
     return methods;
   }
   ```

5. **Method-first `loadModels` using `/api`**

   Replace the existing `loadModels` (currently using `/api/models`) with a version that:

   ```js
   async function loadModels() {
     try {
       const methods = await loadCapabilities();
       const methodIds = Object.keys(methods);
       if (!methodIds.length) throw new Error("No methods from /api");

       const savedMethod =
         savedValues && typeof savedValues.method === "string"
           ? savedValues.method
           : null;
       const currentMethod =
         savedMethod && methodIds.includes(savedMethod)
           ? savedMethod
           : methodIds[0];

       if (methodSel) {
         methodSel.innerHTML = "";
         for (const id of methodIds) {
           const opt = document.createElement("option");
           opt.value = id;
           opt.textContent = id;
           methodSel.appendChild(opt);
         }
         methodSel.value = currentMethod;
       }

       function rebuildModelsForMethod(methodId, preferredModelId) {
         const caps = methods[methodId];
         const options = caps?.fields?.model?.options || [];
         modelSel.innerHTML = "";
         let firstValue = null;

         for (const o of options) {
           const opt = document.createElement("option");
           opt.value = o.value;
           opt.textContent = o.label;
           modelSel.appendChild(opt);
           if (!firstValue) firstValue = o.value;
         }

         let pick = null;
         if (
           preferredModelId &&
           options.some((o) => o.value === preferredModelId)
         ) {
           pick = preferredModelId;
         } else if (
           perMethodModel[methodId] &&
           options.some((o) => o.value === perMethodModel[methodId])
         ) {
           pick = perMethodModel[methodId];
         } else if (firstValue) {
           pick = firstValue;
         }
         if (pick) modelSel.value = pick;
         return pick;
       }

       const preferredModelId =
         savedValues && typeof savedValues.model === "string"
           ? savedValues.model
           : null;
       const initialModel = rebuildModelsForMethod(
         currentMethod,
         preferredModelId,
       );
       if (initialModel) {
         perMethodModel[currentMethod] = initialModel;
       }

       function updateImageFieldVisibility(methodId) {
         const field = form.image_url && form.image_url.closest(".field");
         if (!field) return;
         const caps = methods[methodId];
         const hasImageUrlField =
           caps &&
           caps.fields &&
           caps.fields.image_url &&
           caps.fields.image_url.type === "text";
         field.style.display = hasImageUrlField ? "" : "none";
       }

       updateImageFieldVisibility(currentMethod);

       if (savedValues) {
         const f = savedValues;
         if (f.prompt != null) form.prompt.value = f.prompt;
         if (f.negative_prompt != null)
           form.negative_prompt.value = f.negative_prompt;
         if (f.width != null) form.width.value = f.width;
         if (f.height != null) form.height.value = f.height;
         if (f.steps != null) form.steps.value = f.steps;
         if (f.cfg != null) form.cfg.value = f.cfg;
         if (f.seed != null) form.seed.value = f.seed;
         if (f.image_url != null && form.image_url)
           form.image_url.value = f.image_url;
       }

       if (!loadModels._wiredEvents) {
         if (methodSel) {
           methodSel.addEventListener("change", () => {
             const methodId = methodSel.value;
             const pick = rebuildModelsForMethod(
               methodId,
               perMethodModel[methodId] || null,
             );
             if (pick) perMethodModel[methodId] = pick;
             updateImageFieldVisibility(methodId);
             saveFormValues();
           });
         }

         modelSel.addEventListener("change", () => {
           const methodId = methodSel ? methodSel.value : null;
           if (methodId) {
             perMethodModel[methodId] = modelSel.value;
           }
           saveFormValues();
         });

         loadModels._wiredEvents = true;
       }

       saveFormValues();
     } catch (e) {
       modelSel.innerHTML =
         '<option value="">Failed to load methods/models</option>';
       setStatusMessage("Error loading capabilities: " + e.message, true);
     }
   }
   ```

6. **Submit handler**

The current submit body shape is already compatible with the backend:

```js
const body = {
  prompt: form.prompt.value.trim(),
  negative_prompt: form.negative_prompt.value.trim(),
  model: modelSel.value,
  width: Number(form.width.value),
  height: Number(form.height.value),
  steps: Number(form.steps.value),
  cfg: Number(form.cfg.value),
  method: methodSel ? methodSel.value : undefined,
};

const imageUrl = form.image_url ? form.image_url.value.trim() : "";
if (imageUrl) {
  body.image_url = imageUrl;
}
```

No change needed here as long as the UI drives `method`/`image_url` consistently via `/api` capabilities.

## API changes still needed for full alignment with app-new

The following are not all implemented yet, but describe what the API should look like to fully match the app-new flow.

### 1. POST body shape `{ method, args }`

App-new uses a wrapped payload of the form:

```json
{
  "method": "text2image",
  "args": {
    "model": "diffusion_models/flux/flux1-dev.safetensors",
    "prompt": "1 banana in the middle of 2 avocados"
  }
}
```

To support that shape in the local provider without breaking `app.html`, `server/handlers/generate.js` should:

- Detect wrapped vs flat bodies:

```js
const isWrapped = body && typeof body === "object" && body.args && body.method;

const method = isWrapped
  ? String(body.method || "").trim() || "text2image"
  : String(body.method || "").trim() || "text2image";

const args =
  isWrapped && body.args && typeof body.args === "object" ? body.args : body;
```

- Then use `args.*` instead of `body.*` for:
  - `prompt`, `negative_prompt`
  - `model`
  - `width`, `height`, `steps`, `cfg`
  - `seed`
  - `image_url`

This preserves backward compatibility (flat shape from `app.html`) while allowing app-new to send `{ method, args }`.

### 2. Capabilities GET as single source of truth

Right now:

- `GET /api` (in `server/handlers/api.js`) returns a **filtered** capabilities document for the provider API UI, with:
  - `methods.text2image` (with filtered `model` options).
  - `methods.image2image` (with filtered `model` options and an `image_url` field).
- `GET /api/models` returns an **unfiltered** model list with added `methods` and `supportsImageInput`.

To make `app.html` and `app-new.html` consume the same description cleanly:

- Treat `GET /api` as the **primary capabilities endpoint**:
  - All UIs (including `app.html`) should ideally use `Object.keys(methods)` and `methods[methodId].fields.*` to decide:
    - Which methods exist.
    - Which models and fields each method supports.
- Keep `GET /api/models` as an unfiltered, model-centric view for debugging / internal use only, or gradually refactor `app.html` away from it.

### 3. Per-method defaults (optional)

The app-new capabilities doc can also carry per-method defaults, e.g.:

```json
methods: {
  "text2image": {
    fields: {
      width: { default: 1024 },
      height: { default: 1024 },
      steps: { default: 24 },
      cfg: { default: 4 }
    }
  }
}
```

If we want `app.html` to stop depending on `defaults` from `/api/models`, we could:

- Extend `handleApiGet` to embed these `default` values from `m.defaults` into each method’s field definitions.
- Update `app.js` to read defaults from the capabilities document instead of from the per-model `defaults` object.

### 4. Error surface for invalid method/model combos

Even with a method-first UI, the backend should defensively validate:

- `method` is one of the supported methods from `GET /api`.
- The chosen `model` is valid for that `method`:

```js
// After resolving entry
if (method === "image2image" && entry.family !== "sdxl") {
  return sendJson(res, 400, {
    error: "image2image is only supported for SDXL models in this provider.",
  });
}
```

`GET /api` should be treated as the contract for which (method, model) pairs are expected to succeed; `POST /api/generate` should enforce the same rules.
