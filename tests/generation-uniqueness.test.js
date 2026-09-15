/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "generation-uniqueness-"),
);

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

jest.mock("../server/lib/video-prepare.js", () => {
  const actual = jest.requireActual("../server/lib/video-prepare.js");
  return {
    ...actual,
    prepareControlVideo: jest.fn(async () => ({
      filename: "prep_1_abcd.mp4",
      effectiveDurationSeconds: 3,
      targetFps: 16,
      startOffsetSeconds: 0,
    })),
  };
});

jest.mock("../server/lib/model-registry.js", () => ({
  resolveModel: jest.fn(() => ({
    modelId: "fake-sdxl",
    name: "fake_sdxl",
    file: "fake.safetensors",
    family: "sdxl",
    fullPath: "/fake/fake.safetensors",
    loadKind: "checkpoint",
    managedWorkflowId: "text2image-sdxl-checkpoint",
    comfyCheckpointGroup: "checkpoints",
    diffusionModelComfyName: null,
    defaults: { width: 1024, height: 1024, steps: 20, cfg: 7 },
  })),
  getModels: jest.fn(() => []),
}));

jest.mock("../server/generator/index.js", () => ({
  runComfyGeneration: jest.fn(),
  hasWorkflow: jest.fn(() => true),
  ensureManagedComfyReady: jest.fn(),
  getManagedComfyStatus: jest.fn(),
}));

const { runComfyGeneration } = require("../server/generator/index.js");
const {
  buildFingerprint,
  startOrJoin,
  releaseInflightJob,
  rebuildInflightFromJobs,
  resetForTests,
} = require("../server/lib/generation-uniqueness.js");
const { handleApiPost } = require("../server/handlers/api.js");

const TOKEN = "parascene-local-dev-token";
const OUTPUT_DIR = path.join(process.env.DATA_ROOT, "out");

function fingerprintOf(method, args) {
  return buildFingerprint(method, args).fingerprint;
}

function t2vArgs(overrides = {}) {
  return { prompt: "queue me", model: "ltx_t2v", ...overrides };
}

function fakeJobStore() {
  const jobs = new Map();
  let seq = 0;
  return {
    getJob(id) {
      return jobs.get(id) || null;
    },
    create: jest.fn(async ({ fingerprint }) => {
      seq += 1;
      const job = {
        id: `job_${seq}`,
        status: "pending",
        fingerprint,
      };
      jobs.set(job.id, job);
      return job;
    }),
    jobs,
  };
}

describe("generation uniqueness fingerprint", () => {
  it("is stable under key reordering", () => {
    const a = fingerprintOf("text2video", {
      prompt: "a cat walks",
      model: "ltx_t2v",
      aspect_ratio: "16:9",
      duration_seconds: 6,
    });
    const b = fingerprintOf("text2video", {
      duration_seconds: 6,
      model: "ltx_t2v",
      aspect_ratio: "16:9",
      prompt: "a cat walks",
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("applies field defaults so omitted aspect_ratio matches 1:1", () => {
    const omitted = fingerprintOf("text2video", {
      prompt: "orbit",
      model: "ltx_t2v",
    });
    const explicit = fingerprintOf("text2video", {
      prompt: "orbit",
      model: "ltx_t2v",
      aspect_ratio: "1:1",
    });
    expect(omitted).toBe(explicit);
  });

  it("sanitizes prompt the same way generation does", () => {
    const fancy = fingerprintOf("text2video", {
      prompt: "\u201Ca cat\u201D walks\u2026",
      model: "ltx_t2v",
    });
    const plain = fingerprintOf("text2video", {
      prompt: '"a cat" walks...',
      model: "ltx_t2v",
    });
    expect(fancy).toBe(plain);
  });

  it("omitted seed matches across retries; explicit seed is unique", () => {
    const autoA = fingerprintOf("text2video", {
      prompt: "wind",
      model: "wan_t2v",
    });
    const autoB = fingerprintOf("text2video", {
      prompt: "wind",
      model: "wan_t2v",
      seed: "",
    });
    const seeded = fingerprintOf("text2video", {
      prompt: "wind",
      model: "wan_t2v",
      seed: 42,
    });
    expect(autoA).toBe(autoB);
    expect(seeded).not.toBe(autoA);
  });

  it("different prompts or durations do not match", () => {
    const base = {
      prompt: "wind",
      model: "ltx_t2v",
      duration_seconds: 5,
    };
    expect(fingerprintOf("text2video", base)).not.toBe(
      fingerprintOf("text2video", { ...base, prompt: "rain" }),
    );
    expect(fingerprintOf("text2video", base)).not.toBe(
      fingerprintOf("text2video", { ...base, duration_seconds: 8 }),
    );
  });

  it("resolved model identity uses workflow/family, not only the caller key", () => {
    expect(
      fingerprintOf("text2video", { prompt: "x", model: "ltx_t2v" }),
    ).not.toBe(fingerprintOf("text2video", { prompt: "x", model: "wan_t2v" }));
  });

  it("includes media slots so different images do not join", () => {
    const a = fingerprintOf("image2video", {
      prompt: "pan",
      model: "wan_i2v",
      input_images: ["https://cdn.example/a.png"],
    });
    const b = fingerprintOf("image2video", {
      prompt: "pan",
      model: "wan_i2v",
      input_images: ["https://cdn.example/b.png"],
    });
    expect(a).not.toBe(b);
  });

  it("preserves image order for first/last frame", () => {
    const forward = fingerprintOf("image2video", {
      prompt: "morph",
      model: "ltx_i2v",
      input_images: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
    });
    const reversed = fingerprintOf("image2video", {
      prompt: "morph",
      model: "ltx_i2v",
      input_images: ["https://cdn.example/b.png", "https://cdn.example/a.png"],
    });
    expect(forward).not.toBe(reversed);
  });

  it("folds image_url into input_images", () => {
    const arrayForm = fingerprintOf("image2video", {
      prompt: "pan",
      model: "ltx_i2v",
      input_images: ["https://cdn.example/start.png"],
    });
    const urlForm = fingerprintOf("image2video", {
      prompt: "pan",
      model: "ltx_i2v",
      image_url: "https://cdn.example/start.png",
    });
    expect(arrayForm).toBe(urlForm);
  });

  it("strips staging timestamps so Direct re-uploads of the same bytes join", () => {
    const first = fingerprintOf("image2video", {
      prompt: "pan",
      model: "wan_i2v",
      input_images: ["/api/files/upload_1_aabbccddeeff.png"],
    });
    const retry = fingerprintOf("image2video", {
      prompt: "pan",
      model: "wan_i2v",
      input_images: ["/api/files/upload_999_aabbccddeeff.png"],
    });
    expect(first).toBe(retry);
  });

  it("does not hash job_id or other volatile fields", () => {
    const a = fingerprintOf("text2video", {
      prompt: "stay",
      model: "ltx_t2v",
      job_id: "job_old",
      async: true,
    });
    const b = fingerprintOf("text2video", {
      prompt: "stay",
      model: "ltx_t2v",
    });
    expect(a).toBe(b);
  });

  it("applies prompt_magic default so omitted matches true", () => {
    const omitted = fingerprintOf("image2video", {
      prompt: "nod",
      model: "ltx_i2v",
      input_images: ["https://cdn.example/a.png"],
    });
    const explicit = fingerprintOf("image2video", {
      prompt: "nod",
      model: "ltx_i2v",
      input_images: ["https://cdn.example/a.png"],
      prompt_magic: true,
    });
    const off = fingerprintOf("image2video", {
      prompt: "nod",
      model: "ltx_i2v",
      input_images: ["https://cdn.example/a.png"],
      prompt_magic: false,
    });
    expect(omitted).toBe(explicit);
    expect(off).not.toBe(omitted);
  });

  it("exposes a short prefix for responses", () => {
    const built = buildFingerprint("text2video", {
      prompt: "prefix",
      model: "ltx_t2v",
    });
    expect(built.prefix).toHaveLength(12);
    expect(built.fingerprint.startsWith(built.prefix)).toBe(true);
  });
});

describe("startOrJoin", () => {
  beforeEach(() => {
    resetForTests();
  });

  it("creates once and joins a duplicate start", async () => {
    const store = fakeJobStore();
    const first = await startOrJoin({
      method: "text2video",
      args: t2vArgs(),
      getJob: store.getJob,
      create: store.create,
    });
    const second = await startOrJoin({
      method: "text2video",
      args: t2vArgs(),
      getJob: store.getJob,
      create: store.create,
    });
    expect(store.create).toHaveBeenCalledTimes(1);
    expect(first.fields.dedupe_state).toBe("miss");
    expect(second.fields.dedupe_state).toBe("joined_inflight");
    expect(second.job.id).toBe(first.job.id);
    expect(first.job.fingerprint).toBe(fingerprintOf("text2video", t2vArgs()));
  });

  it("does not join a different prompt", async () => {
    const store = fakeJobStore();
    const first = await startOrJoin({
      method: "text2video",
      args: t2vArgs({ prompt: "a walking cat" }),
      getJob: store.getJob,
      create: store.create,
    });
    const second = await startOrJoin({
      method: "text2video",
      args: t2vArgs({ prompt: "a running dog" }),
      getJob: store.getJob,
      create: store.create,
    });
    expect(store.create).toHaveBeenCalledTimes(2);
    expect(second.fields.dedupe_state).toBe("miss");
    expect(second.job.id).not.toBe(first.job.id);
  });

  it("overlapping creates share one job", async () => {
    const jobs = new Map();
    let release;
    const create = jest.fn(
      () =>
        new Promise((resolve) => {
          release = () => {
            const job = { id: "job_1", status: "pending" };
            jobs.set(job.id, job);
            resolve(job);
          };
        }),
    );
    const args = t2vArgs();
    const firstPromise = startOrJoin({
      method: "text2video",
      args,
      getJob: (id) => jobs.get(id) || null,
      create,
    });
    await Promise.resolve();
    const secondPromise = startOrJoin({
      method: "text2video",
      args,
      getJob: (id) => jobs.get(id) || null,
      create,
    });
    await Promise.resolve();
    expect(create).toHaveBeenCalledTimes(1);
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.fields.dedupe_state).toBe("miss");
    expect(second.fields.dedupe_state).toBe("joined_inflight");
    expect(second.job.id).toBe(first.job.id);
  });

  it("create failure lets a later start try again", async () => {
    const store = fakeJobStore();
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error("restage failed"))
      .mockImplementation(store.create);
    await expect(
      startOrJoin({
        method: "text2video",
        args: t2vArgs(),
        getJob: store.getJob,
        create,
      }),
    ).rejects.toThrow("restage failed");
    const retry = await startOrJoin({
      method: "text2video",
      args: t2vArgs(),
      getJob: store.getJob,
      create,
    });
    expect(retry.fields.dedupe_state).toBe("miss");
    expect(retry.job.id).toBe("job_1");
  });

  it("starts a new job after the first is released", async () => {
    const store = fakeJobStore();
    const first = await startOrJoin({
      method: "text2video",
      args: t2vArgs(),
      getJob: store.getJob,
      create: store.create,
    });
    releaseInflightJob(first.job.id);
    store.jobs.get(first.job.id).status = "failed";
    const second = await startOrJoin({
      method: "text2video",
      args: t2vArgs(),
      getJob: store.getJob,
      create: store.create,
    });
    expect(store.create).toHaveBeenCalledTimes(2);
    expect(second.fields.dedupe_state).toBe("miss");
    expect(second.job.id).not.toBe(first.job.id);
  });

  it("rebuilds pointers from pending scheduler jobs", async () => {
    const fp = fingerprintOf("text2video", t2vArgs({ prompt: "resume" }));
    const live = { id: "job_live", status: "pending", fingerprint: fp };
    rebuildInflightFromJobs([
      { id: "job_old", status: "succeeded", fingerprint: fp },
      live,
    ]);
    const create = jest.fn();
    const joined = await startOrJoin({
      method: "text2video",
      args: t2vArgs({ prompt: "resume" }),
      getJob: (id) => (id === live.id ? live : null),
      create,
    });
    expect(create).not.toHaveBeenCalled();
    expect(joined.job.id).toBe("job_live");
    expect(joined.fields.dedupe_state).toBe("joined_inflight");
  });

  it("does not coalesce text2image", async () => {
    const create = jest.fn(async () => ({ id: "job_x", status: "pending" }));
    const first = await startOrJoin({
      method: "text2image",
      args: { prompt: "still" },
      getJob: () => null,
      create,
    });
    const second = await startOrJoin({
      method: "text2image",
      args: { prompt: "still" },
      getJob: () => null,
      create,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].fingerprint).toBeNull();
    expect(first.fields).toEqual({});
    expect(second.fields).toEqual({});
  });
});

describe("api start path joins in-flight jobs", () => {
  const drainGeneration = [];

  async function resolveHungGenerations() {
    while (drainGeneration.length) drainGeneration.pop()();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }

  beforeEach(async () => {
    await resolveHungGenerations();
    resetForTests();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    runComfyGeneration.mockImplementation(
      () =>
        new Promise((resolve) => {
          drainGeneration.push(() =>
            resolve({ ok: false, error: "test drain" }),
          );
        }),
    );
  });

  afterEach(async () => {
    await resolveHungGenerations();
  });

  function fakeReq(body) {
    const str = JSON.stringify({ method: body.method, args: body.args });
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
    const res = {
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
    return res;
  }

  async function startVideo(args = {}) {
    const req = fakeReq({
      method: "text2video",
      args: {
        prompt: "a walking cat",
        model: "ltx_t2v",
        aspect_ratio: "16:9",
        ...args,
      },
    });
    const res = fakeRes();
    await handleApiPost(req, res, { outputDir: OUTPUT_DIR });
    return {
      statusCode: res.statusCode,
      body: JSON.parse(res._body),
    };
  }

  it("returns miss then joins a duplicate start to the same job_id", async () => {
    const first = await startVideo();
    expect(first.statusCode).toBe(202);
    expect(first.body.status).toBe("pending");
    expect(first.body.place).toBe(1);
    expect(first.body.ahead).toBe(0);
    expect(first.body.dedupe_state).toBe("miss");
    expect(first.body.job_id).toMatch(/^job_/);
    expect(first.body.dedupe_fingerprint_prefix).toHaveLength(12);

    const second = await startVideo();
    expect(second.statusCode).toBe(202);
    expect(second.body.dedupe_state).toBe("joined_inflight");
    expect(second.body.job_id).toBe(first.body.job_id);
    expect(second.body.dedupe_fingerprint_prefix).toBe(
      first.body.dedupe_fingerprint_prefix,
    );
  });

  it("does not join a different prompt", async () => {
    const first = await startVideo({ prompt: "a walking cat" });
    const second = await startVideo({ prompt: "a running dog" });
    expect(second.body.dedupe_state).toBe("miss");
    expect(second.body.job_id).not.toBe(first.body.job_id);
  });

  it("does not attach dedupe fields on text2image", async () => {
    const req = fakeReq({
      method: "text2image",
      args: { prompt: "still", model: "does-not-need-to-resolve-here" },
    });
    const res = fakeRes();
    await handleApiPost(req, res, { outputDir: OUTPUT_DIR });
    const body = JSON.parse(res._body);
    if (res.statusCode === 202) {
      expect(body.dedupe_state).toBeUndefined();
    }
  });
});
