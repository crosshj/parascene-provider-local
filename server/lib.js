"use strict";

const http = require("http");

// Default credits for text2img operation (shared)
const TEXT2IMG_CREDITS = 0.2;

const CORS_ALLOWED_ORIGIN =
  process.env.CORS_ALLOWED_ORIGIN || "https://www.parascene.com";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "connect-src 'self' https://cloudflareinsights.com",
  "img-src 'self' data: blob:",
  "style-src 'self'",
].join("; ");

function setCorsHeaders(res, req) {
  const origin = req.headers.origin;
  if (origin === CORS_ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function setSecurityHeaders(res, req) {
  setCorsHeaders(res, req);
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
  // Suppress logging for frontend polling endpoints
  const url = req.url ? req.url.split("?")[0] : "";
  if (["/api/health", "/api/models", "/api/gpu"].includes(url)) {
    return;
  }
  const mt = req.method === "GET" || req.method === "POST" ? C.g : C.y;
  console.log(
    `${C.c}[${new Date().toISOString()}]${C.r} ${mt}${req.method}${C.r}` +
      ` ${C.m}${req.url}${C.r} ${C.y}ip=${ip}${C.r}` +
      (h["user-agent"]
        ? ` ${C.d}ua="${h["user-agent"].replace(/\s+/g, " ")}"${C.r}`
        : ""),
  );
}

function createApp(ctx) {
  const routes = [];

  function match(method, pathname) {
    for (const r of routes) {
      if (r.method !== method) continue;
      if (r.pattern === "*") return { handler: r.handler, path: pathname };
      if (r.pattern.endsWith("/*")) {
        const prefix = r.pattern.slice(0, -2);
        if (pathname === prefix || pathname.startsWith(prefix + "/"))
          return { handler: r.handler, path: pathname };
      } else if (pathname === r.pattern) {
        return { handler: r.handler, path: pathname };
      }
    }
    return null;
  }

  return {
    get(pattern, handler) {
      routes.push({ method: "GET", pattern, handler });
      return this;
    },
    post(pattern, handler) {
      routes.push({ method: "POST", pattern, handler });
      return this;
    },
    listen(port, host, cb) {
      const server = http.createServer((req, res) => {
        setSecurityHeaders(res, req);
        logRequest(req);

        const pathname = (req.url || "").split("?")[0];
        const method = req.method;

        if (method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const hit = match(method, pathname);

        if (hit) {
          return hit.handler(req, res, { ...ctx, path: hit.path });
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      });

      server.listen(port, host, cb);
      return server;
    },
  };
}

module.exports = {
  sendJson,
  readJson,
  createApp,
};
