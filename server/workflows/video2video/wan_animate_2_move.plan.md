# WAN Animate 2 (Move) — transparent length/fps

Graduate WAN Animate 2 **Move** (pose transfer) into the API with transparent fps/duration handling: resample source to 16 fps, optional start offset + duration window, auto-chain ~77-frame blocks, and hide segment math from callers.

Prior session work (LTX timing, VACE park, harness): [../video-session-status.plan.md](../video-session-status.plan.md).

## Goal

Ship **Move** (pose transfer: reference image + control video → animated video) as a `video2video` preset, replacing parked Fun VACE as the Wan video-in path. Users pass **image + video + prompt + optional `duration_seconds` + optional `start_offset_seconds`**; the provider handles fps resampling, source windowing, and multi-block chaining.

`start_offset_seconds` is in **v1** because it falls out of the same preprocess path as duration trim (cheap even if the harness barely exposes it).

## Product surface

- Method: existing `video2video`
- Preset: `wan_animate` (label e.g. “Wan — Animate 2 Move”)
- Required: `input_video_urls[0]`, `input_images[0]` (character), `prompt`
- Optional:
  - `duration_seconds` (clamp 1–15)
  - `start_offset_seconds` (≥0; default `0`) — window start into the source before taking `duration_seconds`
  - `seed`, `aspect_ratio` / dims via 640 table
- Not in v1: Mix/mask, interactive PointsEditor

Parked VACE stays commented out. Update [video-capability-notes.md](../video-capability-notes.md) to point video-in at Animate Move.

## Hard constraints (make transparent)

| Constraint | Strategy |
|---|---|
| Native ~**77** frames / block @ **16 fps** (~4.8s) | Fixed `MODEL_FPS = 16`, `BLOCK_FRAMES = 77`, overlap `continue_motion_max_frames = 5` |
| Longer than one block | Auto-chain N extend segments until coverage ≥ target frames; **trim** final output to exact target |
| Source fps ≠ 16 | **Resample** control video to 16 fps before pose extract |
| Source window | `prepareControlVideo` seeks to `start_offset_seconds`, then takes `duration_seconds` (default offset `0`) |
| Offset past end / short remainder | Clamp: available = `max(0, sourceDuration - offset)`; effective duration = `min(requested, available)`; reject if nothing left |
| Source shorter than request | Cap duration to available after offset + resample |

Target frames from effective duration × 16; output trim to wall-clock duration.

```mermaid
flowchart LR
  upload[Upload video plus image]
  probe[Probe fps and duration]
  window[Seek offset then take duration]
  resample[Resample window to 16fps]
  plan[Plan N blocks of 77]
  run[Run Move chain]
  stitch[Concat plus trim leftovers]
  out[SaveVideo with audio pass-through]
  upload --> probe --> window --> resample --> plan --> run --> stitch --> out
```

## Graph work

Source: [`_inbox/video_wan2_2_14B_animate.json`](../_inbox/video_wan2_2_14B_animate.json) (UI + subgraphs).

1. **Export / flatten** to API-format JSON for Move only:
   - Keep: LoadVideo, GetVideoComponents, LoadImage, CLIPVision, DWPose face+body, `WanAnimateToVideo`, sample, CreateVideo/SaveVideo, audio remux
   - **Disconnect** `background_video` + `character_mask` (Move mode)
   - Drop / bypass SAM2, PointsEditor, BlockifyMask, DrawMaskOnImage
2. Build a **max-chain template** with enough extend stages for 15s @ 16fps:
   - Coverage per new block ≈ `77 - 5 = 72` new frames after the first
   - First block 77 → ~4.8s; each extend ~4.5s new → **4 blocks** cover ≥15s with margin
   - Builder **enables first K stages**, bypasses the rest (same pattern as inbox’s bypassed second extend)
3. New builder: `wan2_2_animate_move.js` (+ `.json`) in this folder
   - Patch: video file, image file, prompt/neg, seed, width/height (640 table), fps=16
   - Compute `targetFrames`, `stagesNeeded`; set each stage `length=77`, `video_frame_offset` / `continue_motion` wiring; final trim to `targetFrames`
4. Register in [`_index.js`](../_index.js); preset in [`api-model-aliases.js`](../../configs/api-model-aliases.js); option in [`provider-api-config.js`](../../configs/provider-api-config.js) (`requiresReferenceImage: true`)

## Media / duration plumbing (shared resilience)

Add a small **video timing** helper used by Animate (and later other models):

- Probe source: duration, fps, frame count (ffprobe or existing stack if present)
- `prepareControlVideo({ filename, targetFps: 16, durationSeconds, startOffsetSeconds })` → seek + take window + resample → staged file
- Resolve offset: `Number(body.start_offset_seconds ?? body.startOffsetSeconds ?? 0)`, reject negatives; clamp against probed duration
- Dedicated Animate frame math (do **not** reuse VACE `4n+1` / 81): e.g. `_wan-animate-duration.js` with `BLOCK=77`, `OVERLAP=5`, `stagesFor(targetFrames)`

Wire through [`comfy-args.js`](../../lib/comfy-args.js) `video2video` when preset is `wan_animate`.

Prefer implementing the window with the same tool as VACE’s **Video Slice** mindset (start_time + duration) either via ffmpeg preprocess **or** a Comfy `Video Slice` node at graph head — pick whichever is already reliable on the render host; API field stays the same either way.

## API / harness

- Expose optional `start_offset_seconds` on `video2video` (number, min 0, step 0.1); harness: simple number field when `wan_animate` selected (can stay advanced/collapsed)
- Ensure `wan_animate` shows video + image slots and duration
- Capability matrix: `v2v`, `refVideo`, motion-like; `nativeAudio: true` (pass-through)

## Tests

- Builder: stage count for 3s / 5s / 12s / 15s; Move has no mask/background links; fps forced 16
- `buildComfyArgs`: `wan_animate` requires image+video; rejects without image
- Timing helper: offset+duration window math; clamp when offset near end; default offset 0
- Duration helper unit tests for stage planning + trim
- Keep parked-VACE “unknown model” tests

## Explicitly later

- **Mix** mode + auto SAM2 / uploaded mask
- Dynamic N beyond static max-chain (or recursive queue of extends)
- Perfect last-window sizing without pad/trim (trim-after is fine for v1)
- Fancy harness scrubber UI for offset (API field is enough for v1)

## Implementation order

1. Flatten Move API graph + max extend chain
2. Timing helper (probe / offset+duration window / resample) + animate stage math
3. JS builder + registry + preset + API option (+ `start_offset_seconds` field)
4. comfy-args + tests + capability notes + minimal harness field
5. Smoke on render server (short clip, >5s auto-chain, offset into a longer clip)

## Todos

- [ ] Flatten inbox Animate UI graph to Move-only API JSON with max ~15s extend chain
- [ ] Add video probe/resample/trim window (offset+duration) + Animate 77/5 stage planner
- [ ] `wan2_2_animate_move` builder, `_index`, `wan_animate` preset, API option including `start_offset_seconds`
- [ ] Wire comfy-args for `wan_animate`; tests + capability notes; harness field for offset
