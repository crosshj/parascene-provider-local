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
  assertExactSupportedDimensions,
  resolveGenerationDimensions,
  getImageDimensionsFromPath,
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
    expect(resolveAspectRatioDimensions("9:16", 1024, 1024)).toEqual({
      requested: "9:16",
      width: 768,
      height: 1344,
    });
    expect(resolveAspectRatioDimensions("4:5", 1024, 1024)).toEqual({
      requested: "4:5",
      width: 896,
      height: 1120,
    });
  });

  it("maps ratios at 512 base", () => {
    expect(resolveAspectRatioDimensions("16:9", 512, 512)).toEqual({
      requested: "16:9",
      width: 768,
      height: 432,
    });
  });

  it("rejects invalid aspect_ratio strings", () => {
    expect(() => resolveAspectRatioDimensions("3:2", 1024, 1024)).toThrow(
      'Unsupported aspect_ratio "3:2"',
    );
    expect(() => resolveAspectRatioDimensions("3:2", 1024, 1024)).toThrow(
      ASPECT_RATIO_OPTIONS.join(", "),
    );
  });

  it("classifies exact preset dimensions", () => {
    expect(classifyDimensions(1344, 768, 1024, 1024)).toBe("16:9");
    expect(detectAspectRatioFromDimensions(768, 1344)).toBe("9:16");
  });

  it("classifies by ratio tolerance when pixels differ slightly", () => {
    expect(classifyDimensions(1350, 760, 1024, 1024)).toBe("16:9");
  });

  it("returns null for unsupported ratios", () => {
    expect(classifyDimensions(1200, 800, 1024, 1024)).toBeNull();
  });

  it("resolveGenerationDimensions prefers explicit width/height", () => {
    expect(
      resolveGenerationDimensions(
        { width: 800, height: 600, aspect_ratio: "16:9" },
        { width: 1024, height: 1024 },
      ),
    ).toEqual({ width: 800, height: 600 });
  });

  it("resolveGenerationDimensions uses aspect_ratio when dimensions omitted", () => {
    expect(
      resolveGenerationDimensions(
        { aspect_ratio: "16:9" },
        { width: 1024, height: 1024 },
      ),
    ).toEqual({ width: 1344, height: 768 });
  });

  it("assertExactSupportedDimensions accepts preset sizes", () => {
    expect(assertExactSupportedDimensions(768, 1344)).toEqual({
      ratio: "9:16",
      width: 768,
      height: 1344,
    });
  });

  it("assertExactSupportedDimensions rejects non-preset sizes", () => {
    expect(() => assertExactSupportedDimensions(1200, 800)).toThrow(
      "do not match a supported size for image2video",
    );
  });

  describe("getImageDimensionsFromPath", () => {
    let tmpFile;

    afterEach(async () => {
      if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    });

    it("reads dimensions from a PNG file", async () => {
      tmpFile = path.join(
        os.tmpdir(),
        `aspect-test-${Date.now()}.png`,
      );
      await sharp({
        create: { width: 768, height: 1344, channels: 3, background: "#000" },
      })
        .png()
        .toFile(tmpFile);
      await expect(getImageDimensionsFromPath(tmpFile)).resolves.toEqual({
        width: 768,
        height: 1344,
      });
    });
  });

  describe("resolveAspectRatioFromInputImage", () => {
    let tmpDir;
    let tmpFile;

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

    it("uses explicit aspect_ratio without reading file", async () => {
      const result = await resolveAspectRatioFromInputImage({
        body: { aspect_ratio: "16:9" },
        inputFilename: "missing.png",
        inputDir: tmpDir,
        baseWidth: 1024,
        baseHeight: 1024,
      });
      expect(result).toEqual({
        aspectRatio: "16:9",
        width: 1344,
        height: 768,
      });
    });

    it("detects ratio from input image for i2i", async () => {
      const name = await writePng("frame.png", 1344, 768);
      const result = await resolveAspectRatioFromInputImage({
        body: {},
        inputFilename: name,
        inputDir: tmpDir,
        baseWidth: 1024,
        baseHeight: 1024,
        requireExactPixels: false,
      });
      expect(result.aspectRatio).toBe("16:9");
      expect(result.width).toBe(1344);
      expect(result.height).toBe(768);
    });

    it("rejects unsupported input ratio for i2i", async () => {
      const name = await writePng("wide.png", 1200, 800);
      await expect(
        resolveAspectRatioFromInputImage({
          body: {},
          inputFilename: name,
          inputDir: tmpDir,
          baseWidth: 1024,
          baseHeight: 1024,
          requireExactPixels: false,
        }),
      ).rejects.toThrow("Input image aspect ratio is not supported");
    });

    it("requires exact preset pixels for i2v", async () => {
      const name = await writePng("exact.png", 768, 1344);
      const result = await resolveAspectRatioFromInputImage({
        body: {},
        inputFilename: name,
        inputDir: tmpDir,
        baseWidth: 1024,
        baseHeight: 1024,
        requireExactPixels: true,
      });
      expect(result.aspectRatio).toBe("9:16");
    });

    it("rejects near-miss dimensions for i2v", async () => {
      const name = await writePng("near.png", 770, 1340);
      await expect(
        resolveAspectRatioFromInputImage({
          body: {},
          inputFilename: name,
          inputDir: tmpDir,
          baseWidth: 1024,
          baseHeight: 1024,
          requireExactPixels: true,
        }),
      ).rejects.toThrow("do not match a supported size for image2video");
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
