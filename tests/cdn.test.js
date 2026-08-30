/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { createApp } = require("../server/lib/http.js");
const { registerCdnRoutes } = require("../server/handlers/cdn.js");
const { probeDurationSeconds } = require("../server/lib/cdn-ffmpeg.js");

const KEY = "test-cdn-mint-token";

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function listenCdn() {
  const app = createApp({});
  registerCdnRoutes(app);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function jsonReq(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json, text };
}

describe("cdn appendage", () => {
  let tmp;
  let server;
  let base;
  const prev = {};

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps-cdn-"));
    for (const key of [
      "CDN_DIR",
      "CDN_PUBLIC_BASE_URL",
      "PARASCENE_API_KEY",
    ]) {
      prev[key] = process.env[key];
    }
    process.env.CDN_DIR = tmp;
    process.env.PARASCENE_API_KEY = KEY;
    const listened = await listenCdn();
    server = listened.server;
    base = listened.base;
    process.env.CDN_PUBLIC_BASE_URL = base;
  });

  afterAll(() => {
    if (server) server.close();
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects mint without the CDN key", async () => {
    const { res, json } = await jsonReq(`${base}/cdn/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: true }),
    });
    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("does not serve /api/files routes", async () => {
    const { res } = await jsonReq(`${base}/api/files`);
    expect(res.status).toBe(404);
  });

  it("keeps CORS on OPTIONS and PUT for possession upload URLs", async () => {
    const origin = "https://www.parascene.com";
    const mint = await jsonReq(`${base}/cdn/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        pin: false,
        content_type: "text/plain",
        filename: "cors.txt",
      }),
    });
    expect(mint.res.status).toBe(201);
    const uploadUrl = mint.json.upload_url;

    const preflight = await fetch(uploadUrl, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflight.headers.get("access-control-allow-methods")).toMatch(/PUT/);

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Origin: origin,
        "Content-Type": "text/plain",
      },
      body: Buffer.from("cors-body"),
    });
    expect(put.status).toBe(201);
    expect(put.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("mints upload URL, accepts unauthed PUT, denies object id GET, serves fetch link", async () => {
    const mint = await jsonReq(`${base}/cdn/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        pin: true,
        content_type: "text/plain",
        filename: "note.txt",
      }),
    });
    expect(mint.res.status).toBe(201);
    expect(mint.json.object_id).toMatch(/^o_[a-f0-9]{24}$/);
    expect(mint.json.upload_url).toContain("/cdn/u/");
    expect(mint.json.upload_url.startsWith(base)).toBe(true);

    const payload = Buffer.from("hello-cdn");
    const put = await fetch(mint.json.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: payload,
    });
    expect(put.status).toBe(201);
    const putJson = await put.json();
    expect(putJson.object_id).toBe(mint.json.object_id);
    expect(putJson.bytes).toBe(payload.length);
    expect(putJson.pinned).toBe(true);
    expect(putJson.expires_at).toBeNull();

    const denied = await jsonReq(`${base}/cdn/${mint.json.object_id}`);
    expect(denied.res.status).toBe(403);
    expect(denied.json.error).toBe("Access denied");

    const link = await jsonReq(
      `${base}/cdn/objects/${mint.json.object_id}/links`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({}),
      },
    );
    expect(link.res.status).toBe(201);
    expect(link.json.url).toContain("/cdn/");
    expect(link.json.url).not.toContain(mint.json.object_id);

    const got = await fetch(link.json.url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).toString()).toBe("hello-cdn");
  });

  it("windows audio with so/du when ffmpeg is available", async () => {
    if (!hasFfmpeg()) return;
    const src = path.join(tmp, "tone.wav");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-c:a",
        "pcm_s16le",
        src,
      ],
      { stdio: "ignore" },
    );
    const bytes = fs.readFileSync(src);
    const mint = await jsonReq(`${base}/cdn/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ pin: true, content_type: "audio/wav" }),
    });
    expect(mint.res.status).toBe(201);
    const put = await fetch(mint.json.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "audio/wav" },
      body: bytes,
    });
    expect(put.status).toBe(201);
    const link = await jsonReq(
      `${base}/cdn/objects/${mint.json.object_id}/links`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({ so: 1, du: 1 }),
      },
    );
    expect(link.res.status).toBe(201);
    const clipPath = path.join(tmp, "clip.m4a");
    const got = await fetch(link.json.url);
    expect(got.status).toBe(200);
    fs.writeFileSync(clipPath, Buffer.from(await got.arrayBuffer()));
    const dur = await probeDurationSeconds(clipPath);
    expect(dur).toBeGreaterThan(0.7);
    expect(dur).toBeLessThan(1.4);
  }, 30000);

  async function uploadAndLink(filePath, contentType, linkBody = {}) {
    const mint = await jsonReq(`${base}/cdn/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ pin: true, content_type: contentType }),
    });
    expect(mint.res.status).toBe(201);
    const put = await fetch(mint.json.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: fs.readFileSync(filePath),
    });
    expect(put.status).toBe(201);
    const link = await jsonReq(
      `${base}/cdn/objects/${mint.json.object_id}/links`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify(linkBody),
      },
    );
    expect(link.res.status).toBe(201);
    return link.json.url.split("?")[0];
  }

  it("cover=1 is 404 when the file has no artwork", async () => {
    if (!hasFfmpeg()) return;
    const src = path.join(tmp, "no-art.wav");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-c:a",
        "pcm_s16le",
        src,
      ],
      { stdio: "ignore" },
    );
    const fetchUrl = await uploadAndLink(src, "audio/wav");
    const { res, json } = await jsonReq(`${fetchUrl}?cover=1`);
    expect(res.status).toBe(404);
    expect(json.error).toMatch(/artwork/i);
  }, 30000);

  it("cover=1 returns jpeg when the file has an attached picture", async () => {
    if (!hasFfmpeg()) return;
    const jpg = path.join(tmp, "art.jpg");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x64:d=1",
        "-frames:v",
        "1",
        jpg,
      ],
      { stdio: "ignore" },
    );
    const withArt = path.join(tmp, "with-art.mp3");
    try {
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=1",
          "-i",
          jpg,
          "-map",
          "0:a",
          "-map",
          "1:v",
          "-c:a",
          "libmp3lame",
          "-c:v",
          "mjpeg",
          "-disposition:v",
          "attached_pic",
          "-id3v2_version",
          "3",
          withArt,
        ],
        { stdio: "ignore" },
      );
    } catch {
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=1",
          "-i",
          jpg,
          "-map",
          "0:a",
          "-map",
          "1:v",
          "-c:a",
          "aac",
          "-c:v",
          "mjpeg",
          "-shortest",
          withArt.replace(/\.mp3$/, ".m4a"),
        ],
        { stdio: "ignore" },
      );
      fs.renameSync(withArt.replace(/\.mp3$/, ".m4a"), withArt);
    }
    const fetchUrl = await uploadAndLink(withArt, "audio/mpeg");
    const got = await fetch(`${fetchUrl}?cover=1`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toMatch(/image\/jpeg/);
    const buf = Buffer.from(await got.arrayBuffer());
    expect(buf.length).toBeGreaterThan(100);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  }, 30000);
});
