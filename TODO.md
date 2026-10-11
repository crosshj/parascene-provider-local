i2v status

- i2v workflow json files exist: server/workflows/image2video/\*.json
- i2v is not executable from API yet
- frontend has partial i2v UI hints, but backend treats i2v as stub

what is missing

- no i2v entries in server/workflows/\_index.js WORKFLOWS map
- no i2v workflow builder .js modules that load/patch the json templates
- no model source mapped to image2video-\* managedWorkflowId in server/configs/model-dirs-config.js
- no image2video method in server/configs/provider-api-config.js payload
- server/lib/comfy-args.js has image2image branch only; no i2v payload branch
- server/handlers/api.js runs real jobs only for text2image/image2image; i2v falls to createStubJob
- poll response path only returns image/png for text2image/image2image; no i2v media handling

minimum implementation plan

- create i2v builders (wan, ltx) in server/workflows/image2video/\*.js
- register image2video-wan... and image2video-ltx... in server/workflows/\_index.js
- add model mapping for i2v families/models with managedWorkflowId image2video-\*
- add image2video method + fields (prompt, model, input_images, seed, steps/cfg if used) to provider-api-config
- extend buildComfyArgs for method=image2video (require input_images, pass i2v overrides)
- extend API start path to enqueue i2v like text2image/image2image
- extend API poll/complete path for i2v output type (likely video file + content type/headers)
- verify via POST /api start + poll cycle and confirm real artifact (not stub)

done when

- GET /api exposes image2video method with selectable models
- POST /api {method:image2video,args:{...}} creates non-stub job
- polling returns completed real media output and metadata
