/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "occupancy-priority-"));

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

const {
  occupancyPeek,
  getJob,
  linePlace,
  reloadPersistedQueueForTests,
} = require("../server/lib/scheduler.js");
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

describe("occupancy priority snapshot", () => {
  beforeEach(async () => {
    writeState({ jobs: [], pendingOrder: [], currentModelKey: null });
    await reloadPersistedQueueForTests();
  });

  it("returns pending maxes without prompts", async () => {
    const first = await postApi({
      method: "text2video",
      args: { prompt: "secret cat", model: "ltx_t2v", max_bid: 1 },
    });
    const second = await postApi({
      method: "text2video",
      args: { prompt: "secret dog", model: "ltx_t2v", max_bid: 12 },
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);

    const peek = occupancyPeek();
    expect(peek.idle).toBe(false);
    expect(JSON.stringify(peek)).not.toMatch(/secret/);
    expect(peek.highest_max).toBe(12);
    expect(peek.pending.some((row) => row.max === 12)).toBe(true);
    expect(peek.pending.some((row) => row.max === 1)).toBe(true);
  });

  it("a later higher max sits ahead of a lower pending max", async () => {
    const low = await postApi({
      method: "text2video",
      args: { prompt: "wait", model: "ltx_t2v", max_bid: 1 },
    });
    const high = await postApi({
      method: "text2video",
      args: { prompt: "jump", model: "ltx_t2v", max_bid: 40 },
    });
    const lowJob = getJob(low.body.job_id);
    const highJob = getJob(high.body.job_id);
    const peek = occupancyPeek();
    if (lowJob.status === "pending" && highJob.status === "pending") {
      expect(peek.pending[0].max).toBeGreaterThanOrEqual(40);
      return;
    }
    if (lowJob.status === "running") {
      expect(highJob.status).toBe("pending");
      expect(peek.pending.some((row) => row.max >= 40)).toBe(true);
      return;
    }
    expect(highJob.status).toBe("running");
    expect(lowJob.status).toBe("pending");
  });

  it("always_next beats a 50", async () => {
    await postApi({
      method: "text2video",
      args: { prompt: "paid", model: "ltx_t2v", max_bid: 50 },
    });
    await postApi({
      method: "text2video",
      args: { prompt: "lab", model: "ltx_t2v", always_next: true },
    });
    const peek = occupancyPeek();
    expect(peek.pending[0].max).toBeGreaterThan(50);
    expect(peek.highest_max).toBeGreaterThan(50);
  });

  it("FIFO among equal maxes keeps the earlier job first", async () => {
    const first = await postApi({
      method: "text2video",
      args: { prompt: "first", model: "ltx_t2v", max_bid: 12 },
    });
    const second = await postApi({
      method: "text2video",
      args: { prompt: "second", model: "ltx_t2v", max_bid: 12 },
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    const firstPlace = linePlace(first.body.job_id);
    const secondPlace = linePlace(second.body.job_id);
    if (firstPlace && secondPlace) {
      const a = getJob(first.body.job_id);
      const b = getJob(second.body.job_id);
      const byTime = Date.parse(a.created_at) - Date.parse(b.created_at);
      if (byTime < 0) expect(firstPlace.place).toBeLessThan(secondPlace.place);
      if (byTime > 0) expect(secondPlace.place).toBeLessThan(firstPlace.place);
      return;
    }
    expect(getJob(first.body.job_id).status).toBe("running");
    expect(secondPlace.place).toBe(1);
  });

  it("ranks on boost, not method list price", async () => {
    const videoWait = await postApi({
      method: "text2video",
      args: { prompt: "video list", model: "ltx_t2v", max_bid: 0 },
    });
    const stillBoost = await postApi({
      method: "text2video",
      args: { prompt: "still boost", model: "ltx_t2v", max_bid: 0.5 },
    });
    expect(videoWait.statusCode).toBe(202);
    expect(stillBoost.statusCode).toBe(202);
    const peek = occupancyPeek();
    if (peek.pending.length >= 2) {
      expect(peek.pending[0].max).toBe(0.5);
    } else {
      expect(getJob(stillBoost.body.job_id).status).toBe("running");
    }
  });
});
