"use strict";

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

/**
 * Resolve paths relative to the service directory.
 * When run as "node service/src/supervisor/index.js" from repo root,
 * __dirname in supervisor is service/src/supervisor, so service root is ../..
 */
function getServiceRoot(fromDirname) {
  return path.resolve(fromDirname, "..", "..");
}

/**
 * Load configuration. Expects serviceRoot to be the service/ directory.
 * Reads version from repo root package.json.
 */
function loadConfig(serviceRoot) {
  const repoRoot = path.join(serviceRoot, "..");
  const dataRoot = process.env.SERVICE_DATA_ROOT
    ? path.resolve(process.env.SERVICE_DATA_ROOT)
    : serviceRoot;
  const envServiceRoot = dataRoot;
  const envRepoRoot = path.join(envServiceRoot, "..");

  loadDotenvFiles({
    envServiceRoot,
    envRepoRoot,
    releaseServiceRoot: serviceRoot,
    releaseRepoRoot: repoRoot,
  });

  const pkgPath = path.join(repoRoot, "package.json");
  let version = "0.0.0";
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    version = pkg.version || version;
  } catch (_) {
    // use default
  }
  const port = parseInt(process.env.SERVICE_PORT || "3090", 10);
  const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET || "";
  const githubWebhookRepo = process.env.GITHUB_WEBHOOK_REPO || "";
  const githubWebhookBranch = process.env.GITHUB_WEBHOOK_BRANCH || "main";
  return {
    version,
    port,
    serviceRoot,
    repoRoot,
    dataRoot,
    githubWebhookSecret,
    githubWebhookRepo,
    githubWebhookBranch,
  };
}

function loadDotenvFiles({
  envServiceRoot,
  envRepoRoot,
  releaseServiceRoot,
  releaseRepoRoot,
}) {
  const dotenvFiles = [
    path.join(envServiceRoot, ".env"),
    path.join(envRepoRoot, ".env"),
    path.join(releaseServiceRoot, ".env"),
    path.join(releaseRepoRoot, ".env"),
  ];

  const seen = new Set();

  for (const dotenvPath of dotenvFiles) {
    if (seen.has(dotenvPath)) {
      continue;
    }
    seen.add(dotenvPath);

    if (!fs.existsSync(dotenvPath)) {
      continue;
    }
    dotenv.config({
      path: dotenvPath,
      override: false,
    });
  }
}

module.exports = {
  getServiceRoot,
  loadConfig,
};
