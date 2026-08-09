/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  computeWindow,
  resolveStartOffsetSeconds,
  prepareControlVideo,
  probeVideo,
} = require("../server/lib/video-prepare.js");

describe("video-prepare", () => {
  it("computeWindow clamps duration to available after offset", () => {
    const w = computeWindow({
      sourceDuration: 10,
      startOffsetSeconds: 8,
      durationSeconds: 5,
    });
    expect(w.offset).toBe(8);
    expect(w.effectiveDuration).toBe(2);
  });

  it("computeWindow rejects offset past end", () => {
    expect(() =>
      computeWindow({
        sourceDuration: 5,
        startOffsetSeconds: 5,
        durationSeconds: 2,
      }),
    ).toThrow(/beyond source duration/);
  });

  it("resolveStartOffsetSeconds defaults to 0", () => {
    expect(resolveStartOffsetSeconds({})).toBe(0);
    expect(resolveStartOffsetSeconds({ start_offset_seconds: 2.5 })).toBe(2.5);
  });

  it("prepareControlVideo resamples a real clip to target fps", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vprep-"));
    const prev = process.env.COMFY_INPUT_DIR;
    process.env.COMFY_INPUT_DIR = tmp;
    try {
      const src = path.join(tmp, "src.mp4");
      // 2s color bars @ 30fps silent
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=320x240:d=2",
          "-r",
          "30",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          src,
        ],
        { stdio: "ignore" },
      );

      const prepared = await prepareControlVideo({
        filename: "src.mp4",
        profile: { targetFps: 16, defaultDurationSeconds: 5 },
        startOffsetSeconds: 0.5,
        durationSeconds: 1,
      });
      expect(prepared.targetFps).toBe(16);
      expect(prepared.effectiveDurationSeconds).toBe(1);
      expect(prepared.startOffsetSeconds).toBe(0.5);
      const outPath = path.join(tmp, prepared.filename);
      expect(fs.existsSync(outPath)).toBe(true);
      const probe = await probeVideo(outPath);
      expect(probe.fps).toBeGreaterThan(15);
      expect(probe.fps).toBeLessThan(17);
      expect(probe.durationSeconds).toBeGreaterThan(0.8);
      expect(probe.durationSeconds).toBeLessThan(1.3);
    } finally {
      if (prev === undefined) delete process.env.COMFY_INPUT_DIR;
      else process.env.COMFY_INPUT_DIR = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 30000);
});
