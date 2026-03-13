// server.js
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const { runGenerator } = require("./generator.js");
const { getModels, resolveModel } = require("./models.js");

const PUBLIC_DIR = path.join(__dirname, "../public");
const OUTPUT_DIR = path.join(__dirname, "../outputs");

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
].join("; ");

function setSecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=()",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function logRequest(req) {
  const h = req.headers || {};
  const ip =
    h["cf-connecting-ip"] ||
    h["true-client-ip"] ||
    (h["x-forwarded-for"] || "").split(",")[0].trim() ||
    (req.socket?.remoteAddress ?? "");
  const C = {
    r: "\x1b[0m",
    c: "\x1b[36m",
    g: "\x1b[32m",
    m: "\x1b[35m",
    y: "\x1b[33m",
    d: "\x1b[2m",
  };
  const mt = req.method === "GET" || req.method === "POST" ? C.g : C.y;
  console.log(
    `${C.c}[${new Date().toISOString()}]${C.r} ${mt}${req.method}${C.r}` +
      ` ${C.m}${req.url}${C.r} ${C.y}ip=${ip}${C.r}` +
      (h["user-agent"]
        ? ` ${C.d}ua="${h["user-agent"].replace(/\s+/g, " ")}"${C.r}`
        : ""),
  );
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleModels(_req, res) {
  const models = getModels().map(({ name, file, family, defaults }) => ({
    name,
    file,
    family,
    defaults,
  }));
  sendJson(res, 200, { ok: true, models });
}

function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    models: getModels().length,
    output_dir: OUTPUT_DIR,
  });
}

function handleOutputImage(_req, res, reqPath) {
  const file = path.join(OUTPUT_DIR, path.basename(reqPath));
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(data);
  });
}

function handleGenerate(req, res) {
  readJson(req)
    .then((body) => {
      const prompt = String(body.prompt || "").trim();
      if (!prompt)
        return sendJson(res, 400, {
          error: "Missing required field: prompt",
        });

      const modelName = String(body.model || "").trim();
      if (!modelName)
        return sendJson(res, 400, {
          error: "Missing required field: model",
        });

      const entry = resolveModel(modelName);
      if (!entry)
        return sendJson(res, 400, {
          error: `Unknown model: "${modelName}". Check GET /api/models.`,
        });

      const payload = {
        ...body,
        prompt,
        model: entry.fullPath,
        family: entry.family,
      };

      return runGenerator(payload, OUTPUT_DIR).then((result) => {
        if (!result?.ok || !result.file_name) {
          return sendJson(res, 500, {
            error: result?.error ?? "Generator did not return an image.",
          });
        }
        sendJson(res, 200, {
          ok: true,
          file_name: result.file_name,
          image_url: `/outputs/${result.file_name}`,
          seed: result.seed,
          family: result.family,
          model: result.model,
          elapsed_ms: result.elapsed_ms,
        });
      });
    })
    .catch((err) =>
      sendJson(res, 500, { error: err.message ?? "Generation failed." }),
    );
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

function handlePublic(_req, res, reqPath) {
  // Resolve the requested path inside PUBLIC_DIR; default to app.html
  const rel = reqPath === "/" ? "app.html" : reqPath.slice(1);
  const file = path.join(PUBLIC_DIR, path.normalize(rel));

  // Prevent path traversal outside PUBLIC_DIR
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not Found" : "Server Error");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  setSecurityHeaders(res);
  logRequest(req);

  const p = (req.url || "").split("?")[0];
  const { method } = req;

  if (method === "GET" && p === "/api/health") return handleHealth(req, res);
  if (method === "GET" && p === "/api/models") return handleModels(req, res);
  if (method === "POST" && p === "/api/generate")
    return handleGenerate(req, res);
  if (method === "GET" && p.startsWith("/outputs/"))
    return handleOutputImage(req, res, p);
  if (method === "GET") return handlePublic(req, res, p);

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("404 Not Found");
});

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
server.listen(PORT, HOST, () =>
  console.log(`Server running at http://${HOST}:${PORT}/`),
);
