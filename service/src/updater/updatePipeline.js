"use strict";

const fs = require("fs");
const path = require("path");
const { ReleaseManager } = require("./releaseManager");

class UpdatePipeline {
  constructor({ serviceRoot, log }) {
    this.serviceRoot = serviceRoot;
    this.log = log;
    this.runtimeDir = path.join(serviceRoot, "runtime");
    this.stopped = false;
    this.releaseManager = new ReleaseManager({
      serviceRoot: this.serviceRoot,
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
      const pointerPath = this.releaseManager.writeCurrentPointer(
        job,
        releaseCtx,
        syncResult,
      );
      await this._delay();

      await transition("restarting");
      await this._delay();

      await transition("complete", {
        releaseId: releaseCtx.releaseId,
        releaseDir: releaseCtx.releaseDir,
      });
      return {
        releaseId: releaseCtx.releaseId,
        releaseDir: releaseCtx.releaseDir,
        metadataFile: metadataPath,
        smokeFile: smokePath,
        pointerFile: pointerPath,
        mode: "phase-5-real-github-fetch",
      };
    } catch (err) {
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
    const hasPackageJson = fs.existsSync(packageJsonPath);
    const result = {
      jobId: job.id,
      ranAt: new Date().toISOString(),
      ok: hasPackageJson,
      mode: "phase-5-basic-smoke",
      resolvedSha: syncResult.resolvedSha,
      checks: {
        packageJsonExists: hasPackageJson,
      },
    };
    if (!hasPackageJson) {
      throw new Error(
        "Smoke test failed: package.json missing in staged release",
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
