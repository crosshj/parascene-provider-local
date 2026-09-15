/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "scheduler-resume-"),
);

jest.mock("../server/generator/index.js", () => ({
  runComfyGeneration: jest.fn(),
  hasWorkflow: jest.fn(() => true),
  ensureManagedComfyReady: jest.fn(async () => ({ running: true })),
  getManagedComfyStatus: jest.fn(),
}));

const { runComfyGeneration, ensureManagedComfyReady } = require("../server/generator/index.js");
const {
  enqueueGenerationJob,
  getJob,
  getSummary,
  linePlace,
  loadPersistedStateForTests,
  reloadPersistedQueueForTests,
  resumePersistedQueue,
  rehydratePersistedQueue,
  writeSchedulerHoldForTests,
  clearSchedulerHoldForTests,
} = require("../server/lib/scheduler.js");

const OUTPUT_DIR = path.join(process.env.DATA_ROOT, "out");
const STATE_PATH = path.join(
  process.env.DATA_ROOT,
  "runtime",
  "jobs-state.json",
);

function okResult() {
  return {
    ok: true,
    file_name: "out.png",
    seed: 1,
    family: "ltx",
    model: "ltx_t2v",
    elapsed_ms: 1,
  };
}

function persistedJob(id, overrides = {}) {
  return {
    id,
    method: "text2video",
    status: "pending",
    family: "ltx",
    modelId: "ltx_t2v",
    modelName: "ltx_t2v",
    created_at: "2026-01-01T00:00:00.000Z",
    payload: { prompt: id },
    outputDir: OUTPUT_DIR,
    ...overrides,
  };
}

function writeState(payload) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2));
}

async function flushScheduler() {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("persisted queue resume", () => {
  beforeEach(async () => {
    runComfyGeneration.mockReset();
    runComfyGeneration.mockResolvedValue(okResult());
    ensureManagedComfyReady.mockReset();
    ensureManagedComfyReady.mockResolvedValue({ running: true });
    writeState({ jobs: [], pendingOrder: [], currentModelKey: null });
    await reloadPersistedQueueForTests();
  });

  it("resumes persisted pending jobs without a new enqueue", async () => {
    writeState({
      jobs: [
        persistedJob("job_old_a", { created_at: "2026-01-01T00:00:00.000Z" }),
        persistedJob("job_old_b", { created_at: "2026-01-01T00:01:00.000Z" }),
      ],
      pendingOrder: ["job_old_a", "job_old_b"],
      currentModelKey: null,
    });
    await reloadPersistedQueueForTests();
    await flushScheduler();

    expect(runComfyGeneration).toHaveBeenCalledTimes(2);
    expect(runComfyGeneration.mock.calls[0][0].prompt).toBe("job_old_a");
    expect(runComfyGeneration.mock.calls[1][0].prompt).toBe("job_old_b");
    expect(getJob("job_old_a").status).toBe("succeeded");
    expect(getJob("job_old_b").status).toBe("succeeded");
  });

  it("puts interrupted running jobs back in line", async () => {
    writeState({
      jobs: [
        persistedJob("job_wait", { created_at: "2026-01-01T00:00:00.000Z" }),
        persistedJob("job_was_running", {
          status: "running",
          created_at: "2026-01-01T00:00:30.000Z",
        }),
      ],
      pendingOrder: ["job_wait"],
      currentModelKey: "sdxl:other",
    });
    await reloadPersistedQueueForTests();
    await flushScheduler();

    expect(runComfyGeneration.mock.calls.map((call) => call[0].prompt)).toEqual(
      ["job_wait", "job_was_running"],
    );
  });

  it("keeps a later enqueue behind restored jobs even when models differ", async () => {
    writeState({
      jobs: [
        persistedJob("job_old", {
          created_at: "2026-01-01T00:00:00.000Z",
          family: "ltx",
          modelId: "ltx_t2v",
          modelName: "ltx_t2v",
        }),
      ],
      pendingOrder: ["job_old"],
      currentModelKey: "sdxl:newer",
    });
    await reloadPersistedQueueForTests();

    const newer = enqueueGenerationJob(
      {
        payload: { prompt: "job_new" },
        entry: {
          family: "sdxl",
          modelId: "newer",
          modelName: "newer",
        },
        method: "text2image",
      },
      OUTPUT_DIR,
    );

    expect(linePlace("job_old").place).toBe(1);
    expect(linePlace(newer.id).place).toBe(2);

    await flushScheduler();
    expect(runComfyGeneration.mock.calls.map((call) => call[0].prompt)).toEqual(
      ["job_old", "job_new"],
    );
  });

  it("restart resume keeps FIFO order instead of stale model affinity", async () => {
    writeState({
      jobs: [
        persistedJob("job_ltx_a", {
          created_at: "2026-01-01T00:00:00.000Z",
          family: "ltx",
          modelId: "ltx_t2v",
          modelName: "ltx_t2v",
        }),
        persistedJob("job_sdxl_b", {
          created_at: "2026-01-01T00:00:10.000Z",
          family: "sdxl",
          modelId: "newer",
          modelName: "newer",
        }),
      ],
      pendingOrder: ["job_ltx_a", "job_sdxl_b"],
      currentModelKey: "sdxl:newer",
    });
    await reloadPersistedQueueForTests();

    expect(linePlace("job_ltx_a").place).toBe(1);
    expect(linePlace("job_sdxl_b").place).toBe(2);

    await flushScheduler();
    expect(runComfyGeneration.mock.calls.map((call) => call[0].prompt)).toEqual(
      ["job_ltx_a", "job_sdxl_b"],
    );
  });

  it("resumePersistedQueue is a no-op when the line is empty", () => {
    resumePersistedQueue();
    expect(runComfyGeneration).not.toHaveBeenCalled();
  });

  it("status/poll kick-starts a leftover line without a new job", async () => {
    writeState({
      jobs: [
        persistedJob("job_stuck", { created_at: "2026-01-01T00:00:00.000Z" }),
      ],
      pendingOrder: ["job_stuck"],
      currentModelKey: null,
    });
    loadPersistedStateForTests();
    expect(runComfyGeneration).not.toHaveBeenCalled();

    getSummary();
    await flushScheduler();

    expect(runComfyGeneration).toHaveBeenCalledTimes(1);
    expect(getJob("job_stuck").status).toBe("succeeded");
  });

  it("does not start Comfy work while held, then runs the line after release", async () => {
    writeState({
      jobs: [
        persistedJob("job_hold_a", { created_at: "2026-01-01T00:00:00.000Z" }),
        persistedJob("job_hold_b", { created_at: "2026-01-01T00:01:00.000Z" }),
      ],
      pendingOrder: ["job_hold_a", "job_hold_b"],
      currentModelKey: null,
    });
    loadPersistedStateForTests();
    writeSchedulerHoldForTests();
    const pending = rehydratePersistedQueue();
    await flushScheduler();
    expect(runComfyGeneration).not.toHaveBeenCalled();

    clearSchedulerHoldForTests();
    await pending;
    await flushScheduler();
    expect(runComfyGeneration.mock.calls.map((call) => call[0].prompt)).toEqual(
      ["job_hold_a", "job_hold_b"],
    );
  });

  it("does not submit to Comfy until the engine is ready", async () => {
    let releaseComfy;
    ensureManagedComfyReady.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseComfy = resolve;
        }),
    );
    writeState({
      jobs: [
        persistedJob("job_wait_comfy", {
          created_at: "2026-01-01T00:00:00.000Z",
        }),
      ],
      pendingOrder: ["job_wait_comfy"],
      currentModelKey: null,
    });
    const pending = rehydratePersistedQueue();
    await flushScheduler();
    expect(runComfyGeneration).not.toHaveBeenCalled();

    releaseComfy({ running: true });
    await pending;
    await flushScheduler();
    expect(runComfyGeneration).toHaveBeenCalledTimes(1);
    expect(runComfyGeneration.mock.calls[0][0].prompt).toBe("job_wait_comfy");
  });
});
