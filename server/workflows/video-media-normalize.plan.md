# Platform video media — input normalize + delivery transcode

Implemented companion to Animate Move (prepare + delivery).
Cursor copy: `.cursor/plans/v2v_media_normalize_83d83073.plan.md`  
Animate: [video2video/wan_animate_2.plan.md](video2video/wan_animate_2.plan.md)  
Status: [video-session-status.plan.md](video-session-status.plan.md)

## Rules

1. **Input:** every `video2video` control video goes through shared `prepareControlVideo` with a **per-model profile** (designer-recommended fps / window / size). Raw uploads are not fed straight into Comfy.
2. **Output:** Comfy `SaveVideo` is intermediate. Job is **not completed** until delivery MP4 exists: H.264 `yuv420p`, AAC if audio, `+faststart`. Transcode failure = job failure.
3. **FPS:** resample **in** to model fps; delivery **preserves** that fps (no forced 24/30). Callers use `duration_seconds` + `start_offset_seconds`.

## Profiles (v1)

| Preset / family | targetFps | notes |
|---|---|---|
| `wan_animate` (Animate 2) | 16 | + 81-frame / context-window planner |
| `ltx_ic_lora` | graph fps (typ. 25) | already has Video Slice in graph; preprocess still owns offset/duration/fps consistency |
| Parked VACE (if revived) | 16 | reuse 640 / longer-edge hints |

Apply delivery transcoder to **all** `expectVideo` methods (t2v/i2v/a2v/r2v/v2v), not only video2video.

## Build order

1. `prepareControlVideo` + probe (ffprobe) + ffmpeg window/resample → staged Comfy input  
2. Wire `videoInputProfile` on presets; `comfy-args` video2video always prepares  
3. Delivery transcoder in `runComfyGeneration` (or immediately before scheduler marks complete)  
4. Tests (fixture video in → prepared fps/duration; tiny Comfy-like mp4 → delivery encode)  
5. Then Animate Move on top

## Inbox note (v2v)

Animate 2 lives in production as `wan_animate` (inbox twin: `video_wan_animate2.json`). LTX IC inbox copies are stale vs production. Director zip = later research. Animate **Mix** = later.
