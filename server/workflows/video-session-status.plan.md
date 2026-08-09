# Video session status (Aug 2026)

Living checklist for work done around the harness / LTX / WAN v2v / Animate thread.
Companion docs:
- Strategy: [video-capability-notes.md](video-capability-notes.md)
- Next: [video2video/wan_animate_2_move.plan.md](video2video/wan_animate_2_move.plan.md)
- Older Cursor vision: `.cursor/plans/video_capability_vision_b6089069.plan.md`

---

## Done (code present; some still uncommitted)

### Harness / media (earlier in thread; mostly committed as `92ed1ee` etc.)
- [x] Multi-slot refs for reference2video (images / videos / audios)
- [x] Upload library + TTL touch-on-use
- [x] Media cards, thumbnails, lightbox
- [x] Duration field on video models
- [x] Auto aspect sync from primary image
- [x] Comfy interrupt API + longer video history polling
- [x] Stronger Node rollout health / cutover

### LTX timing + prompt magic (local / uncommitted unless committed later)
- [x] Duration → frames = `duration × fps + 1` (`_ltx-duration.js`) for i2v / flf2v / t2v / ia2v
- [x] Graph math `a * b + 1` on ia2v + ingredients
- [x] Keep image-conditioned `TextGenerate` (not `TextGenerateLTX2Prompt`)
- [x] Raise `TextGenerate` `max_length` 256 → **2048** (JSON + builders)
- [x] Skipped `CreateVideo bit_depth: 8` (default already 8; schema risk on older Comfy)

### WAN Fun VACE
- [x] Commit `WAN v2v++` (`31e8c6d`): Video Slice + resize gate on control video; LTX IC-LoRA longer_edge tweak
- [x] Fix accidental **640 → 1024** aspect blow-up (640 size table + VACE template defaults from node `40`)
- [x] Wan length snap `4n+1` (`_wan-duration.js`) on VACE builders
- [x] **Park** `wan_v2v` / `wan_motion` from API + presets (graphs kept); notes in capability doc
- [x] Tests updated for parked presets + slice wiring `control_video → 96`

### Docs
- [x] Parked VACE section in [video-capability-notes.md](video-capability-notes.md)
- [x] Animate Move plan written: [wan_animate_2_move.plan.md](video2video/wan_animate_2_move.plan.md)

---

## In progress / next

### WAN Animate 2 Move (planned, not implemented)
See [wan_animate_2_move.plan.md](video2video/wan_animate_2_move.plan.md).

- [ ] Flatten Move-only API graph + max ~15s extend chain
- [ ] Probe / `start_offset_seconds` + duration window / resample to 16 fps
- [ ] Auto-chain 77-frame blocks (overlap 5); trim leftovers
- [ ] Preset `wan_animate` on `video2video` + harness fields
- [ ] Tests + capability-notes “hooked” update

### Explicitly later
- [ ] Animate **Mix** + mask strategy
- [ ] Fancy offset scrubber UI
- [ ] Revive Fun VACE (unlikely soon)
- [ ] flf + user-audio merge candidate

---

## Working tree note

As of last check, LTX duration/prompt-length, VACE park, aspect 640, and this status/Animate plan files may still be **uncommitted** relative to `31e8c6d`. Commit when ready as one or more focused commits (LTX timing / VACE park / Animate plan docs).
