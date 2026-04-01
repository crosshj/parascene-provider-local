/* eslint-env jest */
"use strict";

/**
 * generation-flow.test.js
 *
 * Asserts that the correct arguments reach runComfyGeneration for all four
 * generation entry points:
 *   - text2img  via generate.js  (app.html sync path)
 *   - image2image via generate.js
 *   - text2img  via api.js       (app-new.html async/scheduler path)
 *   - image2image via api.js
 *
 * Only side-effectful boundaries are mocked:
 *   - resolveModel (avoids filesystem model scan)
 *   - downloadImagesToComfyInput (avoids network/disk)
 *   - runComfyGeneration (avoids Comfy server)
 *   - scheduler._schedule (avoids setImmediate loop)
 */

// ── Fake model entries ──────────────────────────────────────────────────────

const FAKE_SDXL_TEXT2IMG = {
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
  ...FAKE_SDXL_TEXT2IMG,
  modelId: "fake-sdxl-i2i",
  managedWorkflowId: "image2image-sdxl-checkpoint",
};

// ── Mocks ───────────────────────────────────────────────────────────────────
// jest.mock paths must be string literals (Jest hoists them before var init).

jest.mock("../server/handlers/models.js", () => ({
  resolveModel: jest.fn(),
  getModels: jest.fn(() => []),
  handleModels: jest.fn(),
}));

jest.mock("../server/generator/image-input.js", () => ({
  downloadImagesToComfyInput: jest.fn(),
}));

jest.mock("../server/generator/index.js", () => ({
  runComfyGeneration: jest.fn(),
  isManagedComfyWorkflowSupported: jest.fn(() => true),
  ensureManagedComfyReady: jest.fn(),
  getManagedComfyStatus: jest.fn(),
}));

// ── Imports (after mocks are set up) ────────────────────────────────────────

const { resolveModel } = require("../server/handlers/models.js");
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
    it("text2img: uses model managedWorkflowId, no imageFilename", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_TEXT2IMG);
      const { payload, method } = await buildComfyArgs(
        { prompt: "a cat", model: "fake_sdxl", method: "text2img" },
        OUTPUT_DIR,
      );
      expect(method).toBe("text2img");
      expect(payload.managedWorkflowId).toBe("text2image-sdxl-checkpoint");
      expect(payload.prompt).toBe("a cat");
      expect(payload.inputImageFilename).toBeUndefined();
      expect(downloadImagesToComfyInput).not.toHaveBeenCalled();
    });

    it("image2image: uses image2image workflow, downloads image, sets inputImageFilename", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_I2I);
      const { payload, method } = await buildComfyArgs(
        {
          prompt: "a dog",
          model: "fake_sdxl",
          method: "image2image",
          image_url: IMAGE_URL,
          denoise: 0.7,
        },
        OUTPUT_DIR,
      );
      expect(method).toBe("image2image");
      expect(payload.managedWorkflowId).toBe("image2image-sdxl-checkpoint");
      expect(payload.inputImageFilename).toBe(FAKE_FILENAME);
      expect(payload.denoise).toBe(0.7);
      expect(downloadImagesToComfyInput).toHaveBeenCalledWith([IMAGE_URL]);
    });

    it("image2image: throws if image_url is missing", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_I2I);
      await expect(
        buildComfyArgs(
          { prompt: "a dog", model: "fake_sdxl", method: "image2image" },
          OUTPUT_DIR,
        ),
      ).rejects.toThrow("image2image requires image_url");
    });
  });

  // ── generate.js (app.html sync path) ──────────────────────────────────

  describe("generate.js handleGenerate", () => {
    const { handleGenerate } = require("../server/handlers/generate.js");

    it("text2img: passes correct payload to runComfyGeneration", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_TEXT2IMG);
      const req = fakeReq({
        prompt: "a cat",
        model: "fake_sdxl",
        method: "text2img",
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
        model: "fake_sdxl",
        method: "image2image",
        image_url: IMAGE_URL,
        denoise: 0.6,
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
    it("text2img: enqueued job payload has correct managedWorkflowId", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_TEXT2IMG);
      const comfyArgs = await buildComfyArgs(
        { prompt: "a cat", model: "fake_sdxl", method: "text2img" },
        OUTPUT_DIR,
      );
      const job = enqueueGenerationJob(comfyArgs, OUTPUT_DIR);
      expect(job.method).toBe("text2img");
      expect(job.payload.managedWorkflowId).toBe("text2image-sdxl-checkpoint");
      expect(job.payload.inputImageFilename).toBeUndefined();
    });

    it("image2image: enqueued job payload has inputImageFilename and correct workflow", async () => {
      resolveModel.mockReturnValue(FAKE_SDXL_I2I);
      const comfyArgs = await buildComfyArgs(
        {
          prompt: "a dog",
          model: "fake_sdxl",
          method: "image2image",
          image_url: IMAGE_URL,
          denoise: 0.5,
        },
        OUTPUT_DIR,
      );
      const job = enqueueGenerationJob(comfyArgs, OUTPUT_DIR);
      expect(job.method).toBe("image2image");
      expect(job.payload.managedWorkflowId).toBe("image2image-sdxl-checkpoint");
      expect(job.payload.inputImageFilename).toBe(FAKE_FILENAME);
      expect(job.payload.denoise).toBe(0.5);
    });
  });
});
