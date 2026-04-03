# API Model Discovery Strategies

## Requirements (all paths)

1. Checkpoint file on disk: D:\comfy_models\checkpoints\pony\ or diffusion_models\*\
2. Workflow: JS builder + JSON template in server/workflows/text2image/
3. MODEL_DIRS entry: maps directory to managedWorkflowId in handlers/models.js
4. Workflow registration: add to workflows/\_index.js
5. (Optional) Hardcoded config: required for app.js (/api), not for app-new.js (/api/models)

## app.js (dynamic)

Endpoint: `GET /api/models`

**To add a new model:**

1. Place checkpoint in D:\comfy_models\checkpoints\pony\
2. Add MODEL_DIRS entry (rel: "checkpoints\\pony", managedWorkflowId: "text2image-pony-checkpoint")
3. Create workflow files (pony-checkpoint.json, pony-checkpoint.js)
4. Register in workflows/\_index.js
5. Done—appears automatically in app.js dropdown

## app-new.js (static)

Endpoint: `GET /api`

**To add a new model:**

1. Place checkpoint in D:\comfy_models\checkpoints\pony\
2. Add MODEL_DIRS entry (rel: "checkpoints\\pony", managedWorkflowId: "text2image-pony-checkpoint")
3. Create workflow files (pony-checkpoint.json, pony-checkpoint.js)
4. Register in workflows/\_index.js
5. Hardcode in provider-api-config.js: add entry to methods.text2image.fields.model.options[]
6. Restart/reload for static payload to apply

## Key difference

app.js: steps 1-4, automatic discovery
app-new.js: steps 1-5, step 5 (hardcode in config) is the only frontend-specific requirement
