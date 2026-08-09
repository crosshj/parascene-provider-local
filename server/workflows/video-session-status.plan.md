# Video session status (Aug 2026)

Living checklist. Platform media + Animate Move implemented (pending smoke on render host).

| Doc | Role |
|---|---|
| [video-capability-notes.md](video-capability-notes.md) | Strategy / matrix |
| [video-media-normalize.plan.md](video-media-normalize.plan.md) | Shared input + delivery encode |
| [video2video/wan_animate_2.plan.md](video2video/wan_animate_2.plan.md) | WAN Animate 2 |
| `.cursor/plans/v2v_media_normalize_83d83073.plan.md` | Cursor twin of media normalize |

---

## Done (committed `8a8a6bb`, may be unpushed)

### Harness / ops
- [x] Multi-slot refs, upload library, TTL touch-on-use
- [x] Media cards / lightbox, duration field, aspect sync from image
- [x] Comfy interrupt + longer video history polling
- [x] Stronger Node rollout health / cutover

### LTX
- [x] Duration → frames `duration × fps + 1` (`_ltx-duration.js`)
- [x] Image-conditioned `TextGenerate` with `max_length` **2048**
- [x] Skipped explicit `bit_depth: 8` (Comfy default)

### Wan Fun VACE
- [x] Slice + resize gate (`31e8c6d`)
- [x] 640 aspect table + template defaults from node `40`
- [x] `4n+1` length helper; **parked** from API (`wan_v2v` / `wan_motion`)

### Docs (this pass)
- [x] Platform media + Animate plans aligned; inbox v2v scoped to Animate only

---

## Implemented this pass

### 1. Platform media — [video-media-normalize.plan.md](video-media-normalize.plan.md)
- [x] Shared `prepareControlVideo` (probe, `start_offset_seconds`, `duration_seconds`, resample to profile fps, optional size)
- [x] Per-preset `videoInputProfile` (Animate 16; LTX IC graph fps)
- [x] Delivery transcoder: MP4 H.264 `yuv420p` + AAC + faststart; gate job completion
- [x] FPS: in→model rate; out→preserve model rate
- [x] Tests for prepare + delivery

### 2. WAN Animate 2 — [wan_animate_2.plan.md](video2video/wan_animate_2.plan.md)
- [x] Adopt `_inbox/video_wan_animate2.json` (`WanAnimate2ToVideo`)
- [x] `_wan-animate-duration.js` (81 / overlap 1; context windows for long)
- [x] Builder `wan_animate_2` + preset `wan_animate` + harness
- [ ] Smoke: short clip, extend chain, long context-window (render host)

### Explicitly later
- [ ] Animate Mix + mask
- [ ] Fancy offset scrubber; client output codecs
- [ ] Director zip / revive Fun VACE
- [ ] flf + user-audio

---

## Inbox (v2v-relevant)

| Item | Action |
|---|---|
| `video_wan_animate2.json` | Shipped as `wan_animate` |
| `video_ltx2_3_ic_lora*.json` | Already production — ignore or refresh later |
| MiniMax inbox copies | Already shipped |
| `ltx23AllInOne…Director…zip` | Research later — not v1 |

---

## Git

- `8a8a6bb` — LTX timing, VACE park, early plans (local ahead of origin if unpushed)
- Doc sync for media/Animate readiness — commit with implementation or as docs-only before coding
