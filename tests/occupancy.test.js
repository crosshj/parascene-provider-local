/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "occupancy-"));

jest.mock("../server/generator/image-input.js", () => ({
  downloadImagesToComfyInput: jest.fn(async () => ["input_1_abc.png"]),
  ensureAudio2videoPlaceholderImage: jest.fn(async () => "a2v_placeholder.png"),
  COMFY_INPUT_DIR: "/fake/comfy/input",
  A2V_PLACEHOLDER_IMAGE_FILENAME: "a2v_placeholder.png",
}));

jest.mock("../server/generator/audio-input.js", () => ({
  downloadAudioToComfyInput: jest.fn(async () => ["audio_1_abc.mp3"]),
}));

jest.mock("../server/generator/video-input.js", () => ({
  downloadVideoToComfyInput: jest.fn(async () => ["video_1_abc.mp4"]),
}));

jest.mock("../server/lib/model-registry.js", () => ({
  resolveModel: jest.fn(() => ({
    modelId: "ltx_t2v",
    name: "ltx_t2v",
    file: "ltx.safetensors",
    family: "ltx",
    fullPath: "/fake/ltx.safetensors",
    loadKind: "checkpoint",
    managedWorkflowId: "text2video-ltx",
    comfyCheckpointGroup: "checkpoints",
    diffusionModelComfyName: null,
    defaults: { width: 1024, height: 576, steps: 20, cfg: 7 },
  })),
  getModels: jest.fn(() => []),
}));

jest.mock("../server/generator/index.js", () => ({
  runComfyGeneration: jest.fn(() => new Promise(() => {})),
  hasWorkflow: jest.fn(() => true),
  ensureManagedComfyReady: jest.fn(async () => ({ running: true })),
  getManagedComfyStatus: jest.fn(),
}));

jest.mock("../server/lib/comfy-args.js", () => ({
  buildComfyArgs: jest.fn(async (args) => ({
    payload: { prompt: args.prompt, width: 1024, height: 576 },
    entry: {
      modelId: "ltx_t2v",
      modelName: "ltx_t2v",
      family: "ltx",
      file: "ltx.safetensors",
      fullPath: "/fake/ltx.safetensors",
      loadKind: "checkpoint",
      managedWorkflowId: "text2video-ltx",
      comfyCheckpointGroup: "checkpoints",
      diffusionModelComfyName: null,
    },
    method: args.method || "text2video",
  })),
}));

const { occupancyPeek, reloadPersistedQueueForTests } = require("../server/lib/scheduler.js");
const { handleApiPost } = require("../server/handlers/api.js");

const TOKEN = "parascene-local-dev-token";
const OUTPUT_DIR = path.join(process.env.DATA_ROOT, "out");
const STATE_PATH = path.join(
  process.env.DATA_ROOT,
  "runtime",
  "jobs-state.json",
);

function writeState(payload) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2));
}

function fakeReq(body) {
  const str = JSON.stringify(body);
  return {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    setEncoding() {},
    on(event, cb) {
      if (event === "data") cb(str);
      if (event === "end") cb();
      return this;
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    _headers: {},
    _body: null,
    setHeader(key, value) {
      this._headers[key] = value;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      if (headers) Object.assign(this._headers, headers);
    },
    end(data) {
      this._body = data;
    },
  };
}

async function postApi(body) {
  const res = fakeRes();
  await handleApiPost(fakeReq(body), res, { outputDir: OUTPUT_DIR });
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res._body),
  };
}

async function flush() {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("occupancy query", () => {
  beforeEach(async () => {
    writeState({ jobs: [], pendingOrder: [], currentModelKey: null });
    await reloadPersistedQueueForTests();
  });
  it("returns idle with method cost and does not enqueue", async () => {
    const idle = occupancyPeek();
    expect(idle.idle).toBe(true);
    expect(idle.ahead).toBe(0);
    expect(idle.running).toBeNull();
    expect(idle.eta_s).toBe(0);

    const res = await postApi({
      method: "query",
      args: { method: "text2video" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.supported).toBe(true);
    expect(res.body.cost).toBe(1);
    expect(res.body.idle).toBe(true);
    expect(res.body.ahead).toBe(0);
    expect(res.body.job_id).toBeUndefined();
  });

  it("advanced_query also returns occupancy", async () => {
    const res = await postApi({
      method: "advanced_query",
      args: { prompt: "x" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.supported).toBe(true);
    expect(typeof res.body.idle).toBe("boolean");
    expect(typeof res.body.ahead).toBe("number");
    expect(typeof res.body.eta_s).toBe("number");
  });

  it("reports a running video without other people's prompts", async () => {
    const started = await postApi({
      method: "text2video",
      args: { prompt: "secret walking cat", model: "ltx_t2v" },
    });
    expect(started.statusCode).toBe(202);
    await flush();

    const peek = occupancyPeek();
    expect(peek.idle).toBe(false);
    expect(peek.running).toEqual({ kind: "video", family: "ltx" });
    expect(JSON.stringify(peek)).not.toMatch(/secret walking cat/);

    const res = await postApi({
      method: "query",
      args: { method: "text2image" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.idle).toBe(false);
    expect(res.body.running).toEqual({ kind: "video", family: "ltx" });
    expect(res.body.cost).toBe(0.1);
    expect(res.body.eta_s).toBeGreaterThan(0);
  });
});
