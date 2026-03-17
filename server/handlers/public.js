"use strict";

const fs = require("fs");
const path = require("path");

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

function handlePublic(_req, res, ctx) {
  const reqPath = ctx.path;
  const rel = reqPath === "/" ? "app.html" : reqPath.slice(1);
  const file = path.join(ctx.publicDir, path.normalize(rel));

  if (!file.startsWith(ctx.publicDir + path.sep) && file !== ctx.publicDir) {
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
    let body = data;

    if (ext === ".html" && ctx.cacheVersion) {
      const v = ctx.cacheVersion;
      body = Buffer.from(
        data
          .toString("utf8")
          .replace(
            /(href|src)=(")(\/[^"]*\.(css|js|html))(?!\?[^"]*)(")/g,
            `$1=$2$3?v=${v}$5`,
          ),
        "utf8",
      );
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-cache",
      });
    } else {
      res.writeHead(200, { "Content-Type": mime });
    }
    res.end(body);
  });
}

module.exports = { handlePublic };
