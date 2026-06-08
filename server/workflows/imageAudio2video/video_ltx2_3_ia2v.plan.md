# video_ltx2_3_ia2v plan

## Goal
- wire ia2v workflow into provider api + test harness
- keep v1 simple
- support image + audio inputs

## Current State
- workflow json exists
- no js wrapper yet
- not registered in workflow index
- no method in provider capabilities
- no preset/model alias for ia2v
- args builder has image-only helper paths
- test ui has no audio field
- no browser audio recording path

## Phase 1 backend wire-up
- add js wrapper in same folder
- load template json
- patch prompt, negative prompt, seed
- patch width/height from aspect ratio mapping
- patch fps + duration/length
- patch image filename
- patch audio filename
- keep defaults aligned with graph

## Phase 1 backend registration
- register managed workflow id in workflows index
- add preset in api model aliases
- add helper getter + synthetic entry builder
- add comfy-args method branch for imageAudio2video
- validate required fields: input_images + input_audio_urls
- resolve aspect ratio from input image
- set expectVideo true

## Phase 1 capabilities
- add method to provider api config
- method id: imageAudio2video
- model select options for ltx ia2v preset
- fields: prompt, model, input_images, input_audio_urls, aspect_ratio, seed
- hide/optional decisions for first pass

## Phase 1 test harness ui
- method-driven render already present
- ensure new audio url field type can render
- if no generic renderer: add dedicated field block
- include audio url(s) in request body
- preserve local storage behavior

## Phase 1 validation + smoke tests
- generate with image + audio url
- confirm job returns video
- verify audio trimmed to duration in graph
- verify aspect ratio applies to width/height
- verify errors for missing image/audio

## Phase 2 recorder support
- add record ui control in app-new
- use MediaRecorder api in browser
- record to blob + object url preview
- upload blob to backend temp input folder
- send uploaded audio filename to api method
- add simple cleanup policy for temp audio files

## Phase 2 backend upload endpoint
- add protected endpoint for audio upload
- enforce max size + mime allowlist
- convert/normalize if needed
- return stored filename for workflow input

## Open Questions
- final method name: imageAudio2video vs imageaudio2video
- one audio only or array support
- accepted audio formats
- max audio length
- whether to expose duration control
- whether to support no-image variant later

## Nice to Have
- add lightweight unit tests for comfy args branch
- add workflow integration smoke test
- include response metadata: fps, duration, aspect ratio
