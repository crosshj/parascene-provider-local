/* eslint-env jest */
"use strict";

const path = require("path");
const {
  healthMatchesRelease,
  isComfyBusyFromHealth,
  schedulerRunningCount,
  schedulerHoldPath,
  writeSchedulerHold,
  clearSchedulerHold,
  waitForComfyIdle,
} = require("../service/src/supervisor/nodeAppManager.js");

describe("healthMatchesRelease", () => {
  const releaseRoot = path.join(
    "C:",
    "svc",
    "runtime",
    "releases",
    "2026-08-08_224736_044e5ef2e56b",
  );

  it("matches public_dir_abs under the release root", () => {
    expect(
      healthMatchesRelease(
        {
          public_dir_abs: path.join(releaseRoot, "server", "public"),
        },
        releaseRoot,
      ),
    ).toBe(true);
  });

  it("rejects a different release path", () => {
    const other = path.join(
      "C:",
      "svc",
      "runtime",
      "releases",
      "2026-08-08_044711_c8fd96968713",
      "server",
      "public",
    );
    expect(
      healthMatchesRelease({ public_dir_abs: other }, releaseRoot),
    ).toBe(false);
  });

  it("falls back to release id in relative public_dir", () => {
    expect(
      healthMatchesRelease(
        {
          public_dir:
            "runtime/releases/2026-08-08_224736_044e5ef2e56b/server/public",
        },
        releaseRoot,
      ),
    ).toBe(true);
  });
});

describe("isComfyBusyFromHealth", () => {
  it("is idle when Comfy is down", () => {
    expect(isComfyBusyFromHealth({ comfy: { running: false } })).toBe(false);
  });

  it("is busy when Comfy has a running prompt", () => {
    expect(
      isComfyBusyFromHealth({
        comfy: {
          running: true,
          queue_http_status: 200,
          queue: { queue_running: [[0, "prompt-1"]], queue_pending: [] },
        },
      }),
    ).toBe(true);
  });

  it("is idle when Comfy is up with an empty queue", () => {
    expect(
      isComfyBusyFromHealth({
        comfy: {
          running: true,
          queue_http_status: 200,
          queue: { queue_running: [], queue_pending: [] },
        },
      }),
    ).toBe(false);
  });

  it("treats unknown queue as busy so we do not cut over mid-job", () => {
    expect(
      isComfyBusyFromHealth({
        comfy: { running: true, queue_http_status: 500, queue: null },
      }),
    ).toBe(true);
  });
});

describe("schedulerRunningCount", () => {
  it("reads jobs.runningCount from health", () => {
    expect(schedulerRunningCount({ jobs: { runningCount: 2 } })).toBe(2);
  });

  it("is zero when missing or invalid", () => {
    expect(schedulerRunningCount({})).toBe(0);
    expect(schedulerRunningCount(null)).toBe(0);
    expect(schedulerRunningCount({ jobs: { runningCount: "x" } })).toBe(0);
  });
});

describe("waitForComfyIdle", () => {
  it("returns immediately without waiting when timeoutMs is 0 (escalation)", async () => {
    const started = Date.now();
    const result = await waitForComfyIdle("127.0.0.1", 1, { timeoutMs: 0 });
    expect(result).toEqual({ idle: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("scheduler hold file", () => {
  const fs = require("fs");
  const os = require("os");
  const holdRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-hold-"));

  afterAll(() => {
    fs.rmSync(holdRoot, { recursive: true, force: true });
  });

  it("writes and clears runtime/scheduler.hold", () => {
    const holdPath = schedulerHoldPath(holdRoot);
    writeSchedulerHold(holdRoot);
    expect(fs.existsSync(holdPath)).toBe(true);
    clearSchedulerHold(holdRoot);
    expect(fs.existsSync(holdPath)).toBe(false);
  });
});
