/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const {
  ASPECT_RATIO_OPTIONS,
  parseAspectRatioKey,
  resolveAspectRatioDimensions,
  classifyDimensions,
  detectAspectRatioFromDimensions,
  resolveGenerationDimensions,
  getImageDimensionsFromPath,
  scaleDownInputImageIfNeeded,
  resolveAspectRatioFromInputImage,
} = require("../server/lib/aspect-ratio.js");

describe("aspect-ratio", () => {
  it("parses ratio keys", () => {
    expect(parseAspectRatioKey("4:5").value).toBeCloseTo(0.8, 5);
    expect(parseAspectRatioKey("16:9").value).toBeCloseTo(16 / 9, 5);
  });

  it("maps ratios at 1024 base", () => {
    expect(resolveAspectRatioDimensions("1:1", 1024, 1024)).toEqual({
      requested: "1:1",
      width: 1024,
      height: 1024,
    });
    expect(resolveAspectRatioDimensions("16:9", 1024, 1024)).toEqual({
      requested: "16:9",
      width: 1344,
      height: 768,
    });
  });

  it("rejects invalid aspect_ratio strings", () => {
    expect(() => resolveAspectRatioDimensions("3:2", 1024, 1024)).toThrow(
      'Unsupported aspect_ratio "3:2"',
    );
  });

  it("classifies exact preset dimensions", () => {
    expect(classifyDimensions(1344, 768, 1024, 1024)).toBe("16:9");
    expect(detectAspectRatioFromDimensions(768, 1344)).toBe("9:16");
  });

  it("resolveGenerationDimensions prefers explicit width/height", () => {
    expect(
      resolveGenerationDimensions(
        { width: 800, height: 600, aspect_ratio: "16:9" },
        { width: 1024, height: 1024 },
      ),
    ).toEqual({ width: 800, height: 600 });
  });

  describe("resolveAspectRatioFromInputImage", () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aspect-input-"));
    });

    afterEach(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    async function writePng(name, width, height) {
      const filePath = path.join(tmpDir, name);
      await sharp({
        create: { width, height, channels: 3, background: "#000" },
      })
        .png()
        .toFile(filePath);
      return name;
    }

    it("detects ratio from input when aspect_ratio omitted", async () => {
      const name = await writePng("frame.png", 1344, 768);
      const result = await resolveAspectRatioFromInputImage({
        body: {},
        inputFilename: name,
        inputDir: tmpDir,
        baseWidth: 1024,
        baseHeight: 1024,
      });
      expect(result.aspectRatio).toBe("16:9");
      expect(result.width).toBe(1344);
      expect(result.height).toBe(768);
    });

    it("rejects unsupported input ratio", async () => {
      const name = await writePng("wide.png", 1200, 800);
      await expect(
        resolveAspectRatioFromInputImage({
          body: {},
          inputFilename: name,
          inputDir: tmpDir,
          baseWidth: 1024,
          baseHeight: 1024,
        }),
      ).rejects.toThrow("Input image aspect ratio is not supported");
    });

    it("rejects explicit aspect_ratio mismatch", async () => {
      const name = await writePng("landscape.png", 1344, 768);
      await expect(
        resolveAspectRatioFromInputImage({
          body: { aspect_ratio: "1:1" },
          inputFilename: name,
          inputDir: tmpDir,
          baseWidth: 1024,
          baseHeight: 1024,
        }),
      ).rejects.toThrow('does not match aspect_ratio "1:1"');
    });

    it("scales down oversized images to preset cap", async () => {
      const name = await writePng("large.png", 2048, 2048);
      const result = await resolveAspectRatioFromInputImage({
        body: { aspect_ratio: "1:1" },
        inputFilename: name,
        inputDir: tmpDir,
        baseWidth: 1024,
        baseHeight: 1024,
      });
      expect(result.width).toBe(1024);
      expect(result.height).toBe(1024);
      const dims = await getImageDimensionsFromPath(path.join(tmpDir, name));
      expect(dims).toEqual({ width: 1024, height: 1024 });
    });

    it("scaleDownInputImageIfNeeded is no-op within cap", async () => {
      const name = await writePng("small.png", 512, 512);
      const filePath = path.join(tmpDir, name);
      const scaled = await scaleDownInputImageIfNeeded(filePath, 1024, 1024);
      expect(scaled).toBe(false);
      await expect(getImageDimensionsFromPath(filePath)).resolves.toEqual({
        width: 512,
        height: 512,
      });
    });
  });
});

describe("image2image sdxl-checkpoint workflow", () => {
  const SDXLImageToImageWorkflow = require("../server/workflows/image2image/sdxl-checkpoint.js");

  it("patches ResizeAndPadImage target dimensions", () => {
    const wf = SDXLImageToImageWorkflow({
      prompt: "test",
      inputImageFilename: "in.png",
      width: 768,
      height: 1344,
    });
    expect(wf["36"].inputs.target_width).toBe(768);
    expect(wf["36"].inputs.target_height).toBe(1344);
  });
});
