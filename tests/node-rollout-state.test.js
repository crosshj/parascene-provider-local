/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  readNodeRollout,
  writeNodeRollout,
  apiPublicDirMatchesRelease,
} = require("../service/src/supervisor/nodeRolloutState.js");
const { createStatusHandler } = require("../service/src/api/status.js");

describe("node rollout state", () => {
  it("persists a failed cutover with the error text", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-"));
    const saved = writeNodeRollout(dataRoot, {
      ok: false,
      source: "rollout",
      releaseDir: "runtime/releases/2026-10-11_180043_864ac3086bff",
      port: 3092,
      error:
        "Port 3092 is occupied by another release (public_dir=runtime/releases/2026-09-20_031710_e86b0b7ebb2f/server/public)",
      at: "2026-10-11T18:00:47.000Z",
    });
    expect(saved.ok).toBe(false);
    expect(readNodeRollout(dataRoot)).toEqual(saved);
    expect(readNodeRollout(dataRoot).error).toMatch(/Port 3092 is occupied/);
  });

  it("clears the error after a successful cutover", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-"));
    writeNodeRollout(dataRoot, { ok: false, error: "boom" });
    const saved = writeNodeRollout(dataRoot, {
      ok: true,
      source: "rollout",
      port: 3091,
    });
    expect(saved.ok).toBe(true);
    expect(saved.error).toBeNull();
    expect(readNodeRollout(dataRoot).error).toBeNull();
  });

  it("compares the live public dir to the current release id", () => {
    const current = "2026-10-11_180043_864ac3086bff";
    expect(
      apiPublicDirMatchesRelease(
        "runtime/releases/2026-10-11_180043_864ac3086bff/server/public",
        current,
      ),
    ).toBe(true);
    expect(
      apiPublicDirMatchesRelease(
        "runtime/releases/2026-09-20_031710_e86b0b7ebb2f/server/public",
        current,
      ),
    ).toBe(false);
    expect(apiPublicDirMatchesRelease("", current)).toBeNull();
  });
});

describe("status payload", () => {
  it("includes the last node cutover", () => {
    const handler = createStatusHandler(() => ({
      version: "1.0.0",
      uptimeMs: 10,
      nodeRollout: {
        ok: false,
        error: "Port 3092 is occupied by another release",
      },
    }));
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(body) {
        this.body = body;
      },
    };
    handler({}, res);
    const payload = JSON.parse(res.body);
    expect(payload.nodeRollout.ok).toBe(false);
    expect(payload.nodeRollout.error).toMatch(/Port 3092/);
  });
});
