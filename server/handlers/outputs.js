"use strict";

const fs = require("fs");
const path = require("path");

const { sendJson } = require("../lib/http.js");

function handleOutputImage(_req, res, ctx) {
  if (!ctx.outputDir) {
    return sendJson(res, 503, { error: "OUTPUT_DIR not configured" });
  }
  const file = path.join(ctx.outputDir, path.basename(ctx.path));
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

module.exports = { handleOutputImage };
