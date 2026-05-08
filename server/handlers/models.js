// handlers/models.js
// HTTP handler for /api/models — builds model registry payload for frontend

"use strict";

const { sendJson } = require("../lib/http.js");
const { hasWorkflow } = require("../workflows/_index.js");
const { getModels } = require("../lib/model-registry.js");
const { BASE_MODELS_RESPONSE } = require("../configs/models-api-config.js");

function getMethodFromWorkflowId(managedWorkflowId) {
  const prefix = String(managedWorkflowId || "").split("-")[0];
  return prefix || "text2image";
}

function modelToPublicJson(m) {
  const method = getMethodFromWorkflowId(m.managedWorkflowId);
  return {
    modelId: m.modelId,
    name: m.name,
    file: m.file,
    family: m.family,
    loadKind: m.loadKind,
    managedWorkflowId: m.managedWorkflowId,
    comfyCheckpointGroup: m.comfyCheckpointGroup,
    diffusionModelComfyName: m.diffusionModelComfyName,
    defaults: m.defaults,
    methods: [method],
    supportsImageInput: method === "image2image" || method === "image2video",
  };
}

function handleModels(_req, res, _ctx) {
  const models = getModels().filter((m) => hasWorkflow(m));

  const payload = JSON.parse(JSON.stringify(BASE_MODELS_RESPONSE));
  payload.models = models.map(modelToPublicJson);

  const methods = payload.methods || {};

  for (const m of models) {
    const methodId = getMethodFromWorkflowId(m.managedWorkflowId);
    if (!methods[methodId]) {
      const isVideo = methodId === "image2video";
      methods[methodId] = {
        id: methodId,
        async: isVideo,
        name: methodId,
        description: isVideo
          ? "Video generation method."
          : "Image generation method.",
        intent: isVideo ? "video_generate" : "image_generate",
        fields: {
          model: {
            label: "Model",
            type: "select",
            required: true,
            options: [],
          },
        },
      };
    }

    const optionLabel = `${m.family}: ${m.name}`;
    methods[methodId].fields.model.options.push({
      label: optionLabel,
      value: m.modelId,
    });
  }

  payload.methods = methods;

  sendJson(res, 200, payload);
}

module.exports = {
  handleModels,
};
