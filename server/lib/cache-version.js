"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function getCacheVersion(serverDir) {
  const cwd = process.cwd();
  const metaPath = path.join(cwd, "release-metadata.json");
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta.releaseId) return meta.releaseId;
      if (meta.resolvedSha) return meta.resolvedSha.slice(0, 12);
    }
  } catch (_) {
    /* ignore */
  }
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      cwd: path.join(serverDir, ".."),
    }).trim();
  } catch (_) {
    /* ignore */
  }
  const pkg = require(path.join(serverDir, "..", "package.json"));
  return pkg.version || String(Date.now());
}

module.exports = {
  getCacheVersion,
};
