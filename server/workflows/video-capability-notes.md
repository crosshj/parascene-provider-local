# Video capability notes

WAN / LTX / MiniMax — where we are, what’s sitting unused, how to grow.

**Status:** [video-session-status.plan.md](video-session-status.plan.md)  
**Platform media (do first):** [video-media-normalize.plan.md](video-media-normalize.plan.md)  
**Then:** [video2video/wan_animate_2.plan.md](video2video/wan_animate_2.plan.md)

---

## Short term vs long term

short term
1. **Shared video input normalize** — landed (`prepareControlVideo` + `videoInputProfile`)
2. **Delivery transcoder** — landed (H.264 `yuv420p` + AAC + faststart; preserve model fps)
3. **WAN Animate 2** — landed (`wan_animate`; `WanAnimate2ToVideo` @ 16 fps)

already landed
- retention / upload / MiniMax t2v·i2v·flf + Ref2VA
- LTX `×fps+1` + TextGenerate max_length 2048
- Wan Fun VACE parked (640 aspect fix kept)
- platform media normalize + delivery + Animate Move

long term
- same verb set across families; Animate Mix; Director research
- flf + user-audio; capability matrix polish
- WAN Fun VACE unlikely soon; LTX IC-LoRA + MiniMax Ref2VA + Animate Move = video-in story

rule of thumb
- short term = **normalize in + standardize out + Animate Move**
- long term = broader cross-family feature set

---

## Shape today

method → model preset → managed workflow

key files
- server/configs/provider-api-config.js
- server/configs/api-model-aliases.js
- server/lib/comfy-args.js
- server/workflows/_index.js

image2video: second image auto-routes to flf2v (wan / ltx only)

---

## Hooked now

WAN
- t2v, i2v, flf2v
- silent video out
- v2v + motion (Fun VACE) — **parked** (see below)

---

## Parked: Wan Fun VACE

`wan_v2v` / `wan_motion` are commented out of the API surface
(`provider-api-config.js` options + `VIDEO2VIDEO_MODEL_PRESETS`).

Kept on disk (come back later if we want):
- `server/workflows/video2video/wan2_2_vace_v2v.{js,json}`
- `server/workflows/video2video/wan2_2_vace_motion.{js,json}`
- registry entries in `_index.js`
- aspect-ratio 640 table + Video Slice / resize gate from `WAN v2v++`

Why it feels like it sucks (working notes):
- Dual 14B high+low Fun VACE is heavy; easy to look “hung forever” even at 640²
- Default aspect plumbing used to blow 640 → 1024 (fixed, but showed how fragile the path is)
- Control-video decode + VACE strength behavior is finicky; quality/speed tradeoff never felt good in the harness
- Silent video out only — weaker vs LTX IC-LoRA (AV) and MiniMax Ref2VA video-in
- We spent cycles on trim/slice/resize/4n+1 just to make it survivable — still not confidence-inspiring

Prefer for video-in / v2v:
- LTX `ltx_ic_lora` (hooked video2video + shared preprocess)
- Wan Animate 2 `wan_animate` (driving video + reference; shared preprocess @ 16 fps)
- MiniMax Ref2VA `minimax_r2v` (reference2video, video refs)

To re-enable Fun VACE: uncomment presets + API options; leave graphs as-is.

### Inbox vs v2v (scoped)

| Inbox item | v2v relevance |
|---|---|
| `video_wan_animate2.json` | **Shipped** as `wan_animate` |
| `video_ltx2_3_ic_lora*.json` | Already production — stale copies |
| MiniMax `*_h3_*.json` | Already shipped |
| Director zip | Later research — not v1 |

LTX
- t2v, i2v (+ prompt magic), flf2v
- a2v / ia2v, id_lora
- style_transition (flf + transition LoRA)
- ic_lora video2video + ingredients (reference2video)
- graphs emit native AV on most LTX paths

MiniMax
- t2v / i2v / flf (FL2VA)
- reference2video Ref2VA (images + videos + audios)

shared
- media: URL + data URI (images/audio ≤256KB) + POST /api/files upload
- retention sweeper (inputs ~24h, API outputs ~1h)
- GET /api capability_matrix

---

## Inbox (`server/workflows/_inbox/`)

raw Comfy graphs only — no JS builder, preset, or API

### MiniMax (all unhooked)

two weight families
- FL2VA → MiniMaxH3ImageToVideo (t2va / i2va / flf2va)
- Ref2VA → MiniMaxH3ReferenceToVideo (omni-ref → AV)

inbox wires less than the nodes can do
- t2v: prompt only — ok
- i2v: first_frame only — last_frame / flf2va not wired (node supports both)
- r2v: two ref images only

Ref2VA real capacity (official + Comfy)
- images ≤ 9
- videos ≤ 3 (2–15s each; can carry soundtrack)  ← video-in is the point
- audios ≤ 3 (never alone; need image or video)
- mixed ≤ 12 files

smoking gun: r2v prompt mentions Audio 1 with no audio/video nodes connected

shared stack: Qwen3-VL clip (type minimax), video + audio VAE, ResolutionSelector, always AV out

### LTX (advanced still in inbox)

already graduated from inbox-shaped graphs
- flf2v, ia2v → production

still unhooked
- style_transition — flf + ltx2.3-transition.safetensors
- ic_lora — LoadVideo + MoGe + IC-LoRA (LTX video-in / v2v path)
- ic_lora_ingredients — character/prop sheet → video
- id_lora — talkvid / identity + audio
- director zip — research only

### WAN gaps

no native audio, a2v, multi-ref, style transition
Fun VACE was the only Wan video-in path — now parked (LTX/MiniMax cover video-in)

---

## Could have, not hooked (short list)

MiniMax
- entire family
- FL2VA last_frame / flf2va
- Ref2VA video refs + audio refs (inbox is image-stub)

LTX
- style transition, IC-LoRA video-in, ID-LoRA, ingredients
- “we make AV” as a product fact on t2v/i2v/flf

cross-cutting
- no reference2video method
- flf auto-route doesn’t know minimax
- no capability discovery for clients
- no last-frame-only mode
- no extend / 2K regenerate

---

## flf + user audio (important distinction)

two different products, easy to conflate

flf2va (what MiniMax/LTX templates usually mean)
- inputs: first and/or last frame + prompt
- audio: model generates soundtrack
- we have / can wire: LTX flf, MiniMax FL2VA flf

flf + a2v (what we actually need)
- inputs: first frame + last frame + user audio + prompt
- audio: caller-supplied (dialogue, music, SFX) — start/end visuals locked to that track
- use case: “start on A, end on B, lips/motion follow this clip”

status in repo
- LTX flf2v: two images, empty/generated audio path — no LoadAudio
- LTX ia2v: one image + LoadAudio — no last frame
- LTX id_lora: one image + audio — no last frame
- MiniMax FL2VA node: first/last frames, no user-audio input
- MiniMax Ref2VA: can take audio refs + multiple images — possible bridge (2 images as refs + audio), but not true first/last guide semantics
- WAN: no user-audio video path
- no inbox graph combines first + last + LoadAudio

verdict: aspiration (out of phase 1)
- not part of first-phase todos
- LTX later: merge flf guides + ia2v user-audio encode is the natural candidate (same family; new workflow, some wiring risk)
- MiniMax: no clean FL2VA user-audio in; Ref2VA bridge is weaker semantics
- WAN: gap
- when revisited: capability flag flf_user_audio (≠ flf, ≠ nativeAudio)

---

## Target verbs (model-agnostic)

t2v, i2v, flf2v, a2v, flf_a2v (first+last+user audio), r2v, v2v, motion, identity, style_transition, control

suffix “a” alone = native/generated audio out — different from user-audio conditioning

where they should land
- WAN: t2v/i2v/flf; Fun VACE video-in parked (maybe Animate / other later)
- LTX: keep current; ic_lora = primary video-in for now
- MiniMax: FL2VA for t2v/i2v/flf; Ref2VA for r2v including video-in

video-in has three homes — don’t collapse them
- WAN video2video / Fun VACE (parked)
- MiniMax reference2video / Ref2VA (hooked)
- LTX IC-LoRA via video2video (hooked)

---

## API direction

keep named methods; don’t invent a mega-endpoint yet

methods
- text2video, image2video, audio2video, video2video (keep)
- reference2video (add) — multi image/video/audio ref

auto-route on input shape (already do flf / motion)
add CAPABILITY_MATRIX on presets so UI can hide unsupported fields

promote inbox only when: JSON + JS builder + preset + comfy-args + tests

MiniMax FL2VA = one builder, optional first/last frames
MiniMax Ref2VA = extend inbox; do not ship 2-image stub as production

---

## Industry baseline (for comparison)

common elsewhere: t2v, i2v, flf, subject/style ref, motion/video ref, v2v edit, audio/lip-sync, omni-ref, extend, upscale

MiniMax/Hailuo collapse a lot of that into FL2VA + Ref2VA
Replicate-like APIs: same input keys, URL or bytes; short-lived artifacts

---

## Media inputs (Replicate-style mixed)

today: URL only → fetch into Comfy input (24h reuse TTL, no delete)

three tiers
1. https URL — large / reusable / CDN
2. data URI in same fields — small only
3. multipart upload → short-lived file ref → pass into generate

limits (defaults)
- data URI: ≤ 256KB decoded; no video data URIs
- upload: images/audio ≤ 25MB; video ≤ 100MB (Replicate Files API ceiling)
- URL fetch: mime/ext allowlist + max download bytes (~100MB video)

same field names: input_images, input_audio_urls, input_video_urls
values become: url | data:… | uploaded file url/id

v1: image data URI + upload; audio/video = upload or URL
Ref2VA makes this urgent (many assets, no pre-hosting)

---

## Retention / cleanup (also Replicate-shaped)

Replicate
- uploaded files: 24h
- API prediction io/logs/files: 1h after done
- web UI runs: until manual delete

us today
- TTL constants exist for cache reuse only
- nothing sweeps COMFY_INPUT_DIR or OUTPUT_DIR

defaults
- uploads + URL cache + data-URI files: 24h
- API outputs: 1h after job terminal
- job metadata: longer (e.g. 7d) with data_removed once files gone
- harness output TTL: env-overridable if 1h hurts local DX

need a server sweeper
- interval cleanup
- never delete files pinned by in-flight jobs
- advertise expires_at on upload + output responses
- no upload path without cleanup

env sketch
- INPUT_TTL_SECONDS=86400
- OUTPUT_TTL_SECONDS=3600
- JOB_META_TTL_SECONDS=604800
- CLEANUP_INTERVAL_SECONDS=300

---

## Phases

0 retention sweeper + TTLs
1 media: URL + data URI + upload
2 MiniMax FL2VA — t2v / i2v / flf2va (wire last_frame)
3 MiniMax Ref2VA — reference2video with images and video-in and audio
4 LTX advanced — style_transition → id_lora → ic_lora (video-in) → ingredients
5 capability matrix on presets / UI
stretch: extend, 2K regenerate, Context-IR-style prompt prep

ship 0+1 with or before upload; 3 must not be image-only R2V

---

## Principles

- methods = input modality; presets = family+recipe; capabilities = honesty
- one graph with optional inputs > N near-duplicates (FL2VA)
- auto-route on shape; explicit presets when recipes diverge
- inbox is staging; don’t promote stubs that omit first-class node inputs
- don’t fake parity across families
- every staged byte has a TTL and a sweeper
