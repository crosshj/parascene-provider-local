- [x] customizable length for AI fill videos
- [x] Video to Video (WAN)
- [x] Image to Video with start/end images (LTX)
- [ ] Seedance 2.0


### NOTES

Length is customizable via `duration_seconds` on text2video, image2video, audio2video, and video2video (1–15s). Builders convert seconds → frames using workflow fps.

Video to video:
- `video2video` + `wan_v2v` — classic restyle (video + prompt) via Wan 2.2 Fun VACE
- `video2video` + `wan_motion` — motion transfer (character image + motion video + prompt)

Image to video start/end:
- `image2video` with one image = start-frame i2v (Wan / LTX)
- `image2video` with two images = first/last-frame interpolate (auto-routes to flf2v graphs for `wan_i2v` / `ltx_i2v`)

### Seedance 2.0 — out of scope here

Seedance 2.0 is a hosted ByteDance API model, not a local ComfyUI stack. It cannot be implemented in this provider. Track it on a remote/cloud provider instead.
