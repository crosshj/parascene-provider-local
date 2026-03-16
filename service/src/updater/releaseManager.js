"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

class ReleaseManager {
  constructor({ serviceRoot, log }) {
    this.serviceRoot = serviceRoot;
    this.log = log;

    this.runtimeDir = path.join(serviceRoot, "runtime");
    this.releasesDir = path.join(this.runtimeDir, "releases");
    this.currentPointerPath = path.join(
      this.runtimeDir,
      "current-release.json",
    );
  }

  ensureDirs() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    fs.mkdirSync(this.releasesDir, { recursive: true });
  }

  createReleaseContext(job) {
    this.ensureDirs();
    const timestamp = this._formatTimestamp(new Date());
    const shaPart = (job.sha || "no-sha").slice(0, 12);
    const releaseId = `${timestamp}_${shaPart}`;
    const releaseDir = path.join(this.releasesDir, releaseId);
    return {
      releaseId,
      releaseDir,
    };
  }

  async syncRepository(job, releaseCtx) {
    const branch = this._branchFromRef(job.ref);
    const repoUrl = this._buildRepoUrl(job.repo);

    await this._runGit([
      "clone",
      "--branch",
      branch,
      "--single-branch",
      "--depth",
      "50",
      repoUrl,
      releaseCtx.releaseDir,
    ]);

    let resolvedSha = await this._runGit([
      "-C",
      releaseCtx.releaseDir,
      "rev-parse",
      "HEAD",
    ]);

    const desiredSha = (job.sha || "").trim();
    if (desiredSha && !resolvedSha.startsWith(desiredSha)) {
      await this._runGit([
        "-C",
        releaseCtx.releaseDir,
        "fetch",
        "--depth",
        "1",
        "origin",
        desiredSha,
      ]);
      await this._runGit([
        "-C",
        releaseCtx.releaseDir,
        "checkout",
        "--detach",
        "FETCH_HEAD",
      ]);
      resolvedSha = await this._runGit([
        "-C",
        releaseCtx.releaseDir,
        "rev-parse",
        "HEAD",
      ]);
    }

    return {
      repoUrl: this._redactRepoUrl(repoUrl),
      branch,
      resolvedSha,
    };
  }

  writeReleaseMetadata(job, releaseCtx, syncResult) {
    const metadataPath = path.join(
      releaseCtx.releaseDir,
      "release-metadata.json",
    );
    const metadata = {
      releaseId: releaseCtx.releaseId,
      jobId: job.id,
      eventId: job.eventId,
      repo: job.repo,
      ref: job.ref,
      requestedSha: job.sha,
      resolvedSha: syncResult.resolvedSha,
      branch: syncResult.branch,
      source: syncResult.repoUrl,
      stagedAt: new Date().toISOString(),
      mode: "phase-5-real-github-fetch",
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    return metadataPath;
  }

  writeCurrentPointer(job, releaseCtx, syncResult) {
    const pointer = {
      jobId: job.id,
      eventId: job.eventId,
      ref: job.ref,
      requestedSha: job.sha,
      resolvedSha: syncResult.resolvedSha,
      releaseId: releaseCtx.releaseId,
      releaseDir: releaseCtx.releaseDir,
      updatedAt: new Date().toISOString(),
      mode: "phase-5-current-pointer",
    };
    fs.writeFileSync(this.currentPointerPath, JSON.stringify(pointer, null, 2));
    return this.currentPointerPath;
  }

  _buildRepoUrl(repo) {
    if (!repo) {
      throw new Error("Missing repository name in webhook job");
    }

    const token = process.env.GITHUB_FETCH_TOKEN || "";
    if (token) {
      return `https://x-access-token:${token}@github.com/${repo}.git`;
    }

    return `https://github.com/${repo}.git`;
  }

  _redactRepoUrl(repoUrl) {
    return repoUrl.replace(/x-access-token:[^@]+@/i, "x-access-token:***@");
  }

  _branchFromRef(ref) {
    if (!ref) {
      return "main";
    }
    if (ref.startsWith("refs/heads/")) {
      return ref.slice("refs/heads/".length);
    }
    return ref;
  }

  _formatTimestamp(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${d}_${hh}${mm}${ss}`;
  }

  _runGit(args) {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.serviceRoot,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        reject(new Error(`git error: ${err.message}`));
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `git ${args.join(" ")} failed (${code}): ${stderr.trim()}`,
            ),
          );
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}

module.exports = {
  ReleaseManager,
};
