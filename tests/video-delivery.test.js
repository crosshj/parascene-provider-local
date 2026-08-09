/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { transcodeToDeliveryMp4 } = require("../server/lib/video-delivery.js");
const { probeVideo } = require("../server/lib/video-prepare.js");

describe("video-delivery", () => {
  it("transcodes to h264 yuv420p mp4 and preserves fps", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vdeliv-"));
    try {
      const src = path.join(tmp, "raw.mp4");
      const out = path.join(tmp, "out.mp4");
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=256x256:d=1",
          "-r",
          "16",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          src,
        ],
        { stdio: "ignore" },
      );
      await transcodeToDeliveryMp4(src, out);
      expect(fs.existsSync(out)).toBe(true);
      expect(fs.statSync(out).size).toBeGreaterThan(100);
      const probe = await probeVideo(out);
      expect(probe.fps).toBeGreaterThan(15);
      expect(probe.fps).toBeLessThan(17);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 30000);
});
