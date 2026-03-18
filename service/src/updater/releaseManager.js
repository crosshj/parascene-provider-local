"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

class ReleaseManager {
  constructor({ serviceRoot, dataRoot, log }) {
    this.serviceRoot = serviceRoot;
    this.dataRoot = dataRoot || serviceRoot;
    this.log = log;
    this.repoRoot = path.join(this.serviceRoot, "..");

    this.runtimeDir = path.join(this.dataRoot, "runtime");
    this.releasesDir = path.join(this.runtimeDir, "releases");
    this.currentLinkPath = path.join(this.runtimeDir, "current");
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
      mode: "phase-9-staged-release",
      headCommit: job.headCommit || null,
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    return metadataPath;
  }

  getCurrentPointer() {
    try {
      if (!fs.existsSync(this.currentPointerPath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(this.currentPointerPath, "utf8"));
    } catch (err) {
      this.log.warn("updater.pointer.read.error", {
        error: err.message,
      });
      return null;
    }
  }

  resolveCurrentTarget() {
    try {
      if (!fs.existsSync(this.currentLinkPath)) {
        return null;
      }
      return fs.realpathSync(this.currentLinkPath);
    } catch (err) {
      this.log.warn("updater.current.resolve.error", {
        error: err.message,
      });
      return null;
    }
  }

  cutoverToRelease(job, releaseCtx, syncResult) {
    const previousPointer = this.getCurrentPointer();
    const previousTarget = this.resolveCurrentTarget();

    this._setCurrentLink(releaseCtx.releaseDir);

    const pointerPath = this.writeCurrentPointer(job, releaseCtx, syncResult, {
      previousReleaseId: previousPointer ? previousPointer.releaseId : null,
      previousReleaseDir: previousTarget,
    });

    return {
      pointerPath,
      previousPointer,
      previousTarget,
    };
  }

  rollbackCutover(previousPointer, previousTarget) {
    if (!previousTarget) {
      throw new Error("Cannot rollback cutover: previous target not available");
    }
    this._setCurrentLink(previousTarget);
    if (previousPointer) {
      fs.writeFileSync(
        this.currentPointerPath,
        JSON.stringify(previousPointer, null, 2),
      );
    }
  }

  writeCurrentPointer(job, releaseCtx, syncResult, extra = {}) {
    const pointer = {
      jobId: job.id,
      eventId: job.eventId,
      ref: job.ref,
      requestedSha: job.sha,
      resolvedSha: syncResult.resolvedSha,
      releaseId: releaseCtx.releaseId,
      releaseDir: releaseCtx.releaseDir,
      currentPath: this.currentLinkPath,
      updatedAt: new Date().toISOString(),
      mode: "phase-9-current-pointer",
      headCommit: job.headCommit || null,
      ...extra,
    };
    fs.writeFileSync(this.currentPointerPath, JSON.stringify(pointer, null, 2));
    return this.currentPointerPath;
  }

  ensureCurrentLink(targetRepoRoot) {
    this.ensureDirs();
    const target = path.resolve(targetRepoRoot || this.repoRoot);
    this._setCurrentLink(target);
  }

  pruneOldReleases({ keepReleaseIds = [], maxReleases }) {
    this.ensureDirs();
    const maxCount = Number.isFinite(maxReleases)
      ? maxReleases
      : Number.parseInt(process.env.UPDATE_MAX_RELEASES || "6", 10);

    if (!Number.isFinite(maxCount) || maxCount < 1) {
      return { pruned: [], kept: [] };
    }

    const keep = new Set(keepReleaseIds.filter(Boolean));
    const current = this.getCurrentPointer();
    if (current && current.releaseId) {
      keep.add(current.releaseId);
    }

    const releaseEntries = fs
      .readdirSync(this.releasesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = path.join(this.releasesDir, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          id: entry.name,
          path: fullPath,
          mtimeMs: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const kept = [];
    const pruned = [];

    for (const entry of releaseEntries) {
      if (keep.has(entry.id) || kept.length < maxCount) {
        kept.push(entry.id);
        continue;
      }
      try {
        fs.rmSync(entry.path, { recursive: true, force: true });
        pruned.push(entry.id);
      } catch (err) {
        this.log.warn("updater.release.prune.error", {
          releaseId: entry.id,
          error: err.message,
        });
      }
    }

    if (pruned.length > 0) {
      this.log.info("updater.release.pruned", {
        pruned,
        kept,
        maxCount,
      });
    }

    return { pruned, kept };
  }

  detectServiceCodeChanges({ previousTarget, releaseDir }) {
    const previousRoot = previousTarget ? path.resolve(previousTarget) : null;
    const nextRoot = path.resolve(releaseDir);

    if (!previousRoot || !fs.existsSync(previousRoot)) {
      return {
        requiresServiceRestart: true,
        serviceChangedFiles: ["service/src/**"],
        serviceChangedCount: 1,
        reason: "previous_target_missing",
      };
    }

    const previousSnapshot = this._buildServiceCodeSnapshot(previousRoot);
    const nextSnapshot = this._buildServiceCodeSnapshot(nextRoot);
    const changed = this._diffSnapshotKeys(previousSnapshot, nextSnapshot);

    return {
      requiresServiceRestart: changed.length > 0,
      serviceChangedFiles: changed,
      serviceChangedCount: changed.length,
      reason:
        changed.length > 0 ? "service_code_changed" : "service_code_unchanged",
    };
  }

  _setCurrentLink(targetDir) {
    const resolvedTarget = path.resolve(targetDir);
    if (!fs.existsSync(resolvedTarget)) {
      throw new Error(`Cutover target does not exist: ${resolvedTarget}`);
    }

    if (fs.existsSync(this.currentLinkPath)) {
      let isLink = false;
      try {
        fs.readlinkSync(this.currentLinkPath);
        isLink = true;
      } catch (_) {
        isLink = false;
      }

      const st = fs.lstatSync(this.currentLinkPath);
      if (isLink || st.isSymbolicLink()) {
        fs.rmSync(this.currentLinkPath, { recursive: true, force: true });
      } else if (st.isDirectory()) {
        const files = fs.readdirSync(this.currentLinkPath);
        if (files.length > 0) {
          throw new Error(
            `Refusing to replace non-empty current directory: ${this.currentLinkPath}`,
          );
        }
        fs.rmdirSync(this.currentLinkPath);
      } else {
        fs.rmSync(this.currentLinkPath, { force: true });
      }
    }

    fs.symlinkSync(resolvedTarget, this.currentLinkPath, "junction");
  }

  _buildServiceCodeSnapshot(repoRoot) {
    const snapshot = new Map();
    const serviceSrcRoot = path.join(repoRoot, "service", "src");

    if (fs.existsSync(serviceSrcRoot)) {
      this._walkFiles(serviceSrcRoot, (absoluteFilePath) => {
        const relativePath = path
          .relative(repoRoot, absoluteFilePath)
          .split(path.sep)
          .join("/");
        snapshot.set(relativePath, this._hashFile(absoluteFilePath));
      });
    }

    for (const relativePath of [
      "service/package.json",
      "service/package-lock.json",
      "service/npm-shrinkwrap.json",
    ]) {
      const absolutePath = path.join(repoRoot, ...relativePath.split("/"));
      if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
        snapshot.set(relativePath, this._hashFile(absolutePath));
      }
    }

    return snapshot;
  }

  _walkFiles(rootDir, onFile) {
    const stack = [rootDir];
    while (stack.length > 0) {
      const currentDir = stack.pop();
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          onFile(fullPath);
        }
      }
    }
  }

  _hashFile(filePath) {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
  }

  _diffSnapshotKeys(previousSnapshot, nextSnapshot) {
    const changed = [];
    const keys = new Set([...previousSnapshot.keys(), ...nextSnapshot.keys()]);
    for (const key of keys) {
      if (previousSnapshot.get(key) !== nextSnapshot.get(key)) {
        changed.push(key);
      }
    }
    changed.sort();
    return changed;
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
        cwd: this.repoRoot,
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
