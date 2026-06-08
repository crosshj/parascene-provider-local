/* eslint-env jest */
"use strict";

/**
 * generation-flow.test.js
 *
 * Asserts that the correct arguments reach runComfyGeneration for all four
 * generation entry points:
 *   - text2image via generate.js  (app.html sync path)
 *   - image2image via generate.js
 *   - text2image via api.js       (app-new.html async/scheduler path)
 *   - image2image via api.js
 *
 * Only side-effectful boundaries are mocked:
 *   - resolveModel (avoids filesystem model scan)
 *   - downloadImagesToComfyInput (avoids network/disk)
 *   - runComfyGeneration (avoids Comfy server)
 *   - scheduler._schedule (avoids setImmediate loop)
 */

// ── Fake model entries ──────────────────────────────────────────────────────

const FAKE_SDXL_TEXT2IMAGE = {
  modelId: "fake-sdxl-t2i",
  name: "fake_sdxl",
  file: "fake_sdxl.safetensors",
  fullPath: "D:/models/fake_sdxl.safetensors",
  family: "sdxl",
  loadKind: "checkpoint",
  managedWorkflowId: "text2image-sdxl-checkpoint",
  comfyCheckpointGroup: "checkpoints",
  diffusionModelComfyName: null,
  defaults: { width: 1024, height: 1024, steps: 20, cfg: 7 },
};

const FAKE_SDXL_I2I = {
  ...FAKE_SDXL_TEXT2IMAGE,
  modelId: "fake-sdxl-i2i",
  managedWorkflowId: "image2image-sdxl-checkpoint",
};

jest.mock("../server/lib/aspect-ratio.js", () => {
  const actual = jest.requireActual("../server/lib/aspect-ratio.js");
  return {
    ...actual,
    resolveAspectRatioFromInputImage: jest.fn(async ({ body, inputFilename }) => {
      const explicit = String(body.aspect_ratio ?? "").trim();
      const aspectRatio =
        explicit ||
        actual.classifyDimensions(1344, 768, 1024, 1024) ||
        "16:9";
      const dims = actual.resolveAspectRatioDimensions(
        aspectRatio,
        1024,
        1024,
      );
      return {
        aspectRatio: dims.requested,
        width: dims.width,
        height: dims.height,
        inputFilename,
      };
    }),
  };
});

// ── Mocks ───────────────────────────────────────────────────────────────────
// jest.mock paths must be string literals (Jest hoists them before var init).

jest.mock("../server/lib/model-registry.js", () => ({
  resolveModel: jest.fn(),
  getModels: jest.fn(() => []),
}));

jest.mock("../server/generator/image-input.js", () => ({
  downloadImagesToComfyInput: jest.fn(),
  COMFY_INPUT_DIR: "/fake/comfy/input",
}));

jest.mock("../server/generator/index.js", () => ({
  runComfyGeneration: jest.fn(),
  hasWorkflow: jest.fn(() => true),
  ensureManagedComfyReady: jest.fn(),
  getManagedComfyStatus: jest.fn(),
}));

// ── Imports (after mocks are set up) ────────────────────────────────────────

const { resolveModel } = require("../server/lib/model-registry.js");
const {
  downloadImagesToComfyInput,
} = require("../server/generator/image-input.js");
const { runComfyGeneration } = require("../server/generator/index.js");
const { buildComfyArgs } = require("../server/lib/comfy-args.js");
const { enqueueGenerationJob } = require("../server/lib/scheduler.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

const OUTPUT_DIR = "/fake/output";
const IMAGE_URL = "http://example.com/input.png";
const FAKE_FILENAME = "input_123_abc.png";

function fakeSuccess() {
  return {
    ok: true,
    file_name: "out.png",
    seed: 1,
    family: "sdxl",
    model: "x",
    elapsed_ms: 100,
  };
}

// Minimal http request/response helpers for generate.js
function fakeReq(body) {
  const str = JSON.stringify(body);
  const req = {
    headers: { "content-type": "application/json" },
    _str: str,
    setEncoding() {},
    on(event, cb) {
      if (event === "data") cb(this._str);
      if (event === "end") cb();
      return this;
    },
  };
  return req;
}

function fakeRes() {
  const res = {
    statusCode: null,
    _headers: {},
    _body: null,
    writeHead(code, headers) {
      this.statusCode = code;
      this._headers = headers;
    },
    end(data) {
      this._body = data;
    },
    write(data) {
      this._body = data;
    },
  };
  return res;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generation flow — correct args reach runComfyGeneration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runComfyGeneration.mockResolvedValue(fakeSuccess());
    downloadImagesToComfyInput.mockResolvedValue([FAKE_FILENAME]);
  });

  // ── buildComfyArgs unit ────────────────────────────────────────────────

  describe("buildComfyArgs", () => {
    it("text2image: uses model managedWorkflowId, no imageFilename", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_TEXT2IMAGE);
      const { payload, method } = await buildComfyArgs(
        { prompt: "a cat", model: "fake_sdxl", method: "text2image" },
        OUTPUT_DIR,
      );
      expect(method).toBe("text2image");
      expect(payload.managedWorkflowId).toBe("text2image-sdxl-checkpoint");
      expect(payload.prompt).toBe("a cat");
      expect(payload.inputImageFilename).toBeUndefined();
      expect(downloadImagesToComfyInput).not.toHaveBeenCalled();
    });

    it("text2image: maps aspect_ratio 16:9 to workflow dimensions", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_TEXT2IMAGE);
      const { payload } = await buildComfyArgs(
        {
          prompt: "a cat",
          model: "fake_sdxl",
          method: "text2image",
          aspect_ratio: "16:9",
        },
        OUTPUT_DIR,
      );
      expect(payload.width).toBe(1344);
      expect(payload.height).toBe(768);
    });

    it("image2image: SDXL checkpoint uses registry model and sdxl workflow", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_I2I);
      const { payload, method } = await buildComfyArgs(
        {
          prompt: "a dog",
          model: "checkpoints/xl/sd_xl_base_1.0.safetensors",
          method: "image2image",
          input_images: [IMAGE_URL],
          denoise: 0.7,
          aspect_ratio: "9:16",
        },
        OUTPUT_DIR,
      );
      expect(method).toBe("image2image");
      expect(payload.managedWorkflowId).toBe("image2image-sdxl-checkpoint");
      expect(payload.modelFile).toBe(FAKE_SDXL_I2I.file);
      expect(payload.inputImageFilename).toBe(FAKE_FILENAME);
      expect(payload.denoise).toBe(0.7);
      expect(payload.width).toBe(768);
      expect(payload.height).toBe(1344);
      expect(resolveModel).toHaveBeenCalled();
    });

    it("image2image: flux kontext preset maps to fixed workflow", async () => {
      const { payload } = await buildComfyArgs(
        {
          prompt: "edit",
          model: "flux_kontext_i2i",
          method: "image2image",
          input_images: [IMAGE_URL],
          aspect_ratio: "1:1",
        },
        OUTPUT_DIR,
      );
      expect(payload.managedWorkflowId).toBe("image2image-flux-kontext");
    });

    it("image2image: throws if input_images is missing", async () => {
      await expect(
        buildComfyArgs(
          {
            prompt: "a dog",
            model: "checkpoints/xl/sd_xl_base_1.0.safetensors",
            method: "image2image",
          },
          OUTPUT_DIR,
        ),
      ).rejects.toThrow("image2image requires input_images");
    });

    it("image2video: ltx preset maps to ltx workflow", async () => {
      const { payload, entry } = await buildComfyArgs(
        {
          prompt: "camera pan",
          model: "ltx_i2v",
          method: "image2video",
          input_images: [IMAGE_URL],
          aspect_ratio: "1:1",
        },
        OUTPUT_DIR,
      );
      expect(entry.managedWorkflowId).toBe("image2video-ltx2_3");
      expect(payload.width).toBe(1024);
      expect(payload.height).toBe(1024);
    });
  });

  // ── generate.js (app.html sync path) ──────────────────────────────────

  describe("generate.js handleGenerate", () => {
    const { handleGenerate } = require("../server/handlers/generate.js");

    it("text2image: passes correct payload to runComfyGeneration", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_TEXT2IMAGE);
      const req = fakeReq({
        prompt: "a cat",
        model: "fake_sdxl",
        method: "text2image",
      });
      const res = fakeRes();
      await new Promise((resolve) => {
        res.end = resolve;
        handleGenerate(req, res, { outputDir: OUTPUT_DIR });
      });
      expect(runComfyGeneration).toHaveBeenCalledTimes(1);
      const [input] = runComfyGeneration.mock.calls[0];
      expect(input.managedWorkflowId).toBe("text2image-sdxl-checkpoint");
      expect(input.prompt).toBe("a cat");
      expect(input.inputImageFilename).toBeUndefined();
    });

    it("image2image: passes correct payload with inputImageFilename to runComfyGeneration", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_I2I);
      const req = fakeReq({
        prompt: "a dog",
        model: "checkpoints/xl/sd_xl_base_1.0.safetensors",
        method: "image2image",
        input_images: [IMAGE_URL],
        denoise: 0.6,
        aspect_ratio: "1:1",
      });
      const res = fakeRes();
      await new Promise((resolve) => {
        res.end = resolve;
        handleGenerate(req, res, { outputDir: OUTPUT_DIR });
      });
      expect(runComfyGeneration).toHaveBeenCalledTimes(1);
      const [input] = runComfyGeneration.mock.calls[0];
      expect(input.managedWorkflowId).toBe("image2image-sdxl-checkpoint");
      expect(input.inputImageFilename).toBe(FAKE_FILENAME);
      expect(input.denoise).toBe(0.6);
    });
  });

  // ── api.js + scheduler (app-new.html async path) ──────────────────────

  describe("api.js → enqueueGenerationJob → scheduler", () => {
    it("text2image: enqueued job payload has correct managedWorkflowId", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_TEXT2IMAGE);
      const comfyArgs = await buildComfyArgs(
        { prompt: "a cat", model: "fake_sdxl", method: "text2image" },
        OUTPUT_DIR,
      );
      const job = enqueueGenerationJob(comfyArgs, OUTPUT_DIR);
      expect(job.method).toBe("text2image");
      expect(job.payload.managedWorkflowId).toBe("text2image-sdxl-checkpoint");
      expect(job.payload.inputImageFilename).toBeUndefined();
    });

    it("image2image: enqueued job payload has inputImageFilename and correct workflow", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_I2I);
      const comfyArgs = await buildComfyArgs(
        {
          prompt: "a dog",
          model: "checkpoints/xl/sd_xl_base_1.0.safetensors",
          method: "image2image",
          input_images: [IMAGE_URL],
          denoise: 0.5,
          aspect_ratio: "1:1",
        },
        OUTPUT_DIR,
      );
      const job = enqueueGenerationJob(comfyArgs, OUTPUT_DIR);
      expect(job.method).toBe("image2image");
      expect(job.payload.managedWorkflowId).toBe("image2image-sdxl-checkpoint");
      expect(job.payload.inputImageFilename).toBe(FAKE_FILENAME);
      expect(job.payload.denoise).toBe(0.5);
      expect(job.payload.width).toBe(1024);
      expect(job.payload.height).toBe(1024);
    });
  });
});

describe("api.js field defaults", () => {
  const { applyMethodFieldDefaults } = require("../server/handlers/api.js");

  it("applies aspect_ratio default 1:1 for text2image jobs", async () => {
    resolveModel.mockReturnValue(FAKE_SDXL_TEXT2IMAGE);
    const args = applyMethodFieldDefaults("text2image", {
      model: "fake_sdxl",
      prompt: "hello",
    });
    expect(args.aspect_ratio).toBe("1:1");
    const { payload } = await buildComfyArgs(
      { ...args, method: "text2image" },
      OUTPUT_DIR,
    );
    expect(payload.width).toBe(1024);
    expect(payload.height).toBe(1024);
  });
});
