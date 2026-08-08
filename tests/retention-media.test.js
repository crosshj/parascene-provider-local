/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  sweepInputDir,
  parseInputTimestamp,
  INPUT_TTL_SECONDS,
} = require("../server/lib/retention.js");

describe("retention sweeper", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ret-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses timestamped input filenames", () => {
    expect(parseInputTimestamp("input_1710000000_abc123.png")).toBe(1710000000);
    expect(parseInputTimestamp("upload_1710000001_deadbeef.mp4")).toBe(
      1710000001,
    );
    expect(parseInputTimestamp("a2v_placeholder.png")).toBeNull();
  });

  it("deletes expired inputs and keeps pinned/fresh", () => {
    const now = Math.floor(Date.now() / 1000);
    const oldName = `input_${now - INPUT_TTL_SECONDS - 10}_oldhash.png`;
    const freshName = `input_${now - 10}_freshhash.png`;
    const pinnedName = `video_${now - INPUT_TTL_SECONDS - 10}_pinhash.mp4`;
    fs.writeFileSync(path.join(tmp, oldName), "x");
    fs.writeFileSync(path.join(tmp, freshName), "y");
    fs.writeFileSync(path.join(tmp, pinnedName), "z");
    fs.writeFileSync(path.join(tmp, "a2v_placeholder.png"), "p");
    // Ensure "old" mtime matches filename age (write is "now" by default).
    const oldDate = new Date((now - INPUT_TTL_SECONDS - 10) * 1000);
    fs.utimesSync(path.join(tmp, oldName), oldDate, oldDate);
    const pinDate = new Date((now - INPUT_TTL_SECONDS - 10) * 1000);
    fs.utimesSync(path.join(tmp, pinnedName), pinDate, pinDate);

    const result = sweepInputDir(tmp, {
      now,
      pinned: new Set([pinnedName]),
      ttlSeconds: INPUT_TTL_SECONDS,
    });

    expect(result.deleted).toContain(oldName);
    expect(fs.existsSync(path.join(tmp, oldName))).toBe(false);
    expect(fs.existsSync(path.join(tmp, freshName))).toBe(true);
    expect(fs.existsSync(path.join(tmp, pinnedName))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "a2v_placeholder.png"))).toBe(true);
  });

  it("keeps filename-expired inputs after touch (TTL reset on use)", () => {
    const { touchInputFile } = require("../server/lib/retention.js");
    const now = Math.floor(Date.now() / 1000);
    const name = `upload_${now - INPUT_TTL_SECONDS - 60}_reused.png`;
    const full = path.join(tmp, name);
    fs.writeFileSync(full, "x");
    const oldDate = new Date((now - INPUT_TTL_SECONDS - 60) * 1000);
    fs.utimesSync(full, oldDate, oldDate);

    const touched = touchInputFile(tmp, name, { ttlSeconds: INPUT_TTL_SECONDS });
    expect(touched).toBeTruthy();
    expect(Date.parse(touched.expires_at)).toBeGreaterThan(Date.now());

    const result = sweepInputDir(tmp, {
      now,
      pinned: new Set(),
      ttlSeconds: INPUT_TTL_SECONDS,
    });
    expect(result.deleted).not.toContain(name);
    expect(fs.existsSync(full)).toBe(true);
  });
});

describe("media-resolve data URI", () => {
  const prev = process.env.COMFY_INPUT_DIR;
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
    process.env.COMFY_INPUT_DIR = tmp;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.COMFY_INPUT_DIR;
    else process.env.COMFY_INPUT_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a small image data URI to Comfy input", async () => {
    const { resolveMediaValue } = require("../server/lib/media-resolve.js");
    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const dataUri = `data:image/png;base64,${png.toString("base64")}`;
    const filename = await resolveMediaValue(dataUri, { kind: "image" });
    expect(filename).toMatch(/^datauri_\d+_/);
    expect(fs.existsSync(path.join(tmp, filename))).toBe(true);
  });

  it("rejects video data URIs", async () => {
    const { resolveMediaValue } = require("../server/lib/media-resolve.js");
    await expect(
      resolveMediaValue("data:video/mp4;base64,AAAA", { kind: "video" }),
    ).rejects.toThrow(/not supported/i);
  });

  it("touches staged upload TTL when resolved by /api/files ref", async () => {
    const {
      resolveMediaValue,
      writeStagedBuffer,
    } = require("../server/lib/media-resolve.js");
    const { INPUT_TTL_SECONDS: ttl } = require("../server/lib/retention.js");
    const staged = writeStagedBuffer(Buffer.from("abc"), {
      kind: "image",
      ext: ".png",
      prefix: "upload",
    });
    const full = path.join(tmp, staged.filename);
    const old = Math.floor(Date.now() / 1000) - ttl - 120;
    const oldDate = new Date(old * 1000);
    // Rewrite with aged filename stamp by renaming
    const agedName = staged.filename.replace(/upload_\d+_/, `upload_${old}_`);
    const agedPath = path.join(tmp, agedName);
    fs.renameSync(full, agedPath);
    fs.utimesSync(agedPath, oldDate, oldDate);

    await resolveMediaValue(`/api/files/${agedName}`, { kind: "image" });
    const st = fs.statSync(agedPath);
    expect(Math.floor(st.mtimeMs / 1000)).toBeGreaterThan(old + 60);
  });
});
