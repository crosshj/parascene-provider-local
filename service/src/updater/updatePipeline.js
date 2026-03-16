"use strict";

const fs = require("fs");
const path = require("path");
const { ReleaseManager } = require("./releaseManager");

class UpdatePipeline {
  constructor({ serviceRoot, dataRoot, log }) {
    this.serviceRoot = serviceRoot;
    this.dataRoot = dataRoot || serviceRoot;
    this.log = log;
    this.runtimeDir = path.join(this.dataRoot, "runtime");
    this.stopped = false;
    this.releaseManager = new ReleaseManager({
      serviceRoot: this.serviceRoot,
      dataRoot: this.dataRoot,
      log: this.log,
    });

    this.stepDelayMs = Number.parseInt(
      process.env.UPDATE_PIPELINE_DELAY_MS || "400",
      10,
    );
  }

  stop() {
    this.stopped = true;
  }

  async run(job, { onStateChange }) {
    this._ensureDirs();

    const releaseCtx = this.releaseManager.createReleaseContext(job);
    let cutoverContext = null;

    const transition = async (state, details = {}) => {
      if (this.stopped) {
        throw new Error("Update pipeline stopped");
      }
      onStateChange(state, {
        ...details,
        transitionedAt: new Date().toISOString(),
      });
      this.log.info("updater.pipeline.state", {
        jobId: job.id,
        state,
        ...details,
      });
    };

    try {
      await transition("fetching");
      const syncResult = await this.releaseManager.syncRepository(
        job,
        releaseCtx,
      );
      await this._delay();

      await transition("staging", {
        releaseId: releaseCtx.releaseId,
        releaseDir: releaseCtx.releaseDir,
        resolvedSha: syncResult.resolvedSha,
      });
      const metadataPath = this.releaseManager.writeReleaseMetadata(
        job,
        releaseCtx,
        syncResult,
      );
      await this._delay();

      await transition("smoke-testing", {
        releaseDir: releaseCtx.releaseDir,
      });
      const smokePath = this._runSmokeTest(job, releaseCtx, syncResult);
      await this._delay();

      await transition("ready", {
        releaseDir: releaseCtx.releaseDir,
      });
      await this._delay();

      await transition("cutover", {
        releaseId: releaseCtx.releaseId,
        releaseDir: releaseCtx.releaseDir,
      });
      cutoverContext = this.releaseManager.cutoverToRelease(
        job,
        releaseCtx,
        syncResult,
      );
      await this._delay();

      await transition("restarting", {
        strategy: "external-service-restart",
      });
      await this._delay();

      const pruneResult = this.releaseManager.pruneOldReleases({
        keepReleaseIds: [
          releaseCtx.releaseId,
          cutoverContext.previousPointer
            ? cutoverContext.previousPointer.releaseId
            : null,
        ].filter(Boolean),
      });

      await transition("complete", {
        releaseId: releaseCtx.releaseId,
        releaseDir: releaseCtx.releaseDir,
        prunedReleaseIds: pruneResult.pruned,
      });
      return {
        releaseId: releaseCtx.releaseId,
        releaseDir: releaseCtx.releaseDir,
        metadataFile: metadataPath,
        smokeFile: smokePath,
        pointerFile: cutoverContext.pointerPath,
        currentPath: this.releaseManager.currentLinkPath,
        prunedReleaseIds: pruneResult.pruned,
        mode: "phase-9-staged-cutover",
      };
    } catch (err) {
      if (cutoverContext) {
        try {
          this.releaseManager.rollbackCutover(
            cutoverContext.previousPointer,
            cutoverContext.previousTarget,
          );
          this.log.warn("updater.cutover.rollback", {
            jobId: job.id,
            releaseId: releaseCtx.releaseId,
            reason: err.message,
          });
        } catch (rollbackErr) {
          this.log.error("updater.cutover.rollback.error", {
            jobId: job.id,
            releaseId: releaseCtx.releaseId,
            error: rollbackErr.message,
          });
          err = new Error(
            `${err.message}; rollback failed: ${rollbackErr.message}`,
          );
        }
      }

      onStateChange("failed", {
        error: err.message,
        failedAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  _ensureDirs() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    this.releaseManager.ensureDirs();
  }

  _runSmokeTest(job, releaseCtx, syncResult) {
    const smokePath = path.join(releaseCtx.releaseDir, "smoke-test.json");
    const packageJsonPath = path.join(releaseCtx.releaseDir, "package.json");
    const supervisorPath = path.join(
      releaseCtx.releaseDir,
      "service",
      "src",
      "supervisor",
      "index.js",
    );
    const hasPackageJson = fs.existsSync(packageJsonPath);
    const hasSupervisor = fs.existsSync(supervisorPath);
    const result = {
      jobId: job.id,
      ranAt: new Date().toISOString(),
      ok: hasPackageJson && hasSupervisor,
      mode: "phase-9-basic-smoke",
      resolvedSha: syncResult.resolvedSha,
      checks: {
        packageJsonExists: hasPackageJson,
        supervisorEntryExists: hasSupervisor,
      },
    };
    if (!hasPackageJson || !hasSupervisor) {
      throw new Error(
        "Smoke test failed: required files missing in staged release",
      );
    }
    fs.writeFileSync(smokePath, JSON.stringify(result, null, 2));
    return smokePath;
  }

  _delay() {
    if (this.stepDelayMs <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      setTimeout(resolve, this.stepDelayMs);
    });
  }
}

module.exports = {
  UpdatePipeline,
};
