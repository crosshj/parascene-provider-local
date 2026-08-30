"use strict";

const http = require("http");

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.parascene.com",
  "https://parascene.com",
  "http://localhost:2367",
  "http://127.0.0.1:2367",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function extraAllowedOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(origin) {
  if (!origin) return false;
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  return extraAllowedOrigins().includes(origin);
}

/** Possession URLs: browser PUT/GET from www (or anywhere with the token). Mint stays allowlisted. */
function isOpenCorsPath(req) {
  const p = String(req.url || "").split("?")[0];
  if (p.startsWith("/cdn/u/")) return true;
  if (/^\/cdn\/[a-f0-9]{48}\/?$/i.test(p)) return true;
  return false;
}

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "connect-src 'self' https://cloudflareinsights.com",
  "img-src 'self' data: blob:",
  // <video src="blob:..."> falls back to default-src when omitted; blob must be allowed like img-src.
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

function setCorsHeaders(res, req) {
  const origin = req.headers.origin;
  if (origin && (isOpenCorsPath(req) || originAllowed(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
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
  // setHeader (not writeHead headers object) so CORS from setSecurityHeaders is kept.
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      // Allow a few small data-URI media fields in generate JSON (≤256KB each).
      if (raw.length > 5_000_000) {
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
  const mt =
    req.method === "GET" || req.method === "POST" || req.method === "PUT"
      ? C.g
      : C.y;
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
    put(pattern, handler) {
      routes.push({ method: "PUT", pattern, handler });
      return this;
    },
    delete(pattern, handler) {
      routes.push({ method: "DELETE", pattern, handler });
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

        res.setHeader("Content-Type", "text/plain");
        res.writeHead(404);
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
