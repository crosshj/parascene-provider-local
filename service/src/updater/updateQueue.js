"use strict";

const fs = require("fs");
const path = require("path");
const { UpdatePipeline } = require("./updatePipeline");

class UpdateQueue {
  constructor({ serviceRoot, dataRoot, log, onRestartRequired }) {
    this.serviceRoot = serviceRoot;
    this.dataRoot = dataRoot || serviceRoot;
    this.log = log;
    this.onRestartRequired = onRestartRequired;

    this.runtimeDir = path.join(this.dataRoot, "runtime");
    this.statePath = path.join(this.runtimeDir, "update-state.json");
    this.eventsPath = path.join(this.runtimeDir, "webhook-events.jsonl");
    this.currentPointerPath = path.join(
      this.runtimeDir,
      "current-release.json",
    );

    this.queue = [];
    this.lastEvent = null;
    this.lastQueuedAt = null;
    this.lastCompletedJob = null;
    this.lastFailedJob = null;
    this.currentJob = null;
    this.state = "idle";
    this.processing = false;
    this.stopping = false;

    this.pipeline = new UpdatePipeline({
      serviceRoot: this.serviceRoot,
      dataRoot: this.dataRoot,
      log: this.log,
    });
  }

  start() {
    this.stopping = false;
    this._ensureRuntimeDir();
    this._writeState();
  }

  async stop() {
    this.stopping = true;
    this.pipeline.stop();
  }

  getStatus() {
    const currentRelease = this._readCurrentRelease();
    const currentLinkTarget = this._readCurrentLinkTarget();
    const releaseRetentionMax = Number.parseInt(
      process.env.UPDATE_MAX_RELEASES || "6",
      10,
    );
    return {
      state: this.state,
      processing: this.processing,
      queueLength: this.queue.length,
      queue: this.queue.map((job) => ({
        id: job.id,
        state: job.state,
        ref: job.ref,
        sha: job.sha,
        queuedAt: job.queuedAt,
      })),
      currentJob: this.currentJob,
      lastQueuedAt: this.lastQueuedAt,
      lastEvent: this.lastEvent,
      lastCompletedJob: this.lastCompletedJob,
      lastFailedJob: this.lastFailedJob,
      currentRelease,
      currentLinkTarget,
      releaseRetentionMax,
    };
  }

  recordWebhookEvent(event) {
    this._ensureRuntimeDir();
    try {
      fs.appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`);
    } catch (err) {
      this.log.error("webhook.event.persist.error", { error: err.message });
    }
  }

  enqueueFromWebhook(event) {
    const job = {
      id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      queuedAt: new Date().toISOString(),
      source: "github-webhook",
      eventId: event.id,
      repo: event.repo,
      ref: event.ref,
      sha: event.sha,
      state: "queued",
    };

    this.queue.push(job);
    this.lastQueuedAt = job.queuedAt;
    this.lastEvent = {
      id: event.id,
      type: event.type,
      repo: event.repo,
      ref: event.ref,
      sha: event.sha,
      receivedAt: event.receivedAt,
    };

    if (!this.processing) {
      this.state = "queued";
    }

    this._writeState();

    this.log.info("updater.job.enqueued", {
      jobId: job.id,
      eventId: event.id,
      queueLength: this.queue.length,
      repo: event.repo,
      ref: event.ref,
      sha: event.sha,
    });

    this._kickProcessing();

    return job;
  }

  _kickProcessing() {
    if (this.processing || this.stopping) {
      return;
    }
    setImmediate(() => {
      this._processQueue().catch((err) => {
        this.log.error("updater.queue.process.error", { error: err.message });
      });
    });
  }

  async _processQueue() {
    if (this.processing || this.stopping) {
      return;
    }

    this.processing = true;
    let restartRequest = null;
    try {
      while (this.queue.length > 0 && !this.stopping) {
        const job = this.queue[0];
        this.currentJob = {
          id: job.id,
          state: job.state,
          eventId: job.eventId,
          repo: job.repo,
          ref: job.ref,
          sha: job.sha,
          queuedAt: job.queuedAt,
          startedAt: new Date().toISOString(),
        };

        this.state = "queued";
        this._writeState();

        try {
          const result = await this.pipeline.run(job, {
            onStateChange: (state, details = {}) => {
              job.state = state;
              this.state = state;
              this.currentJob = {
                ...this.currentJob,
                state,
                ...details,
              };
              this._writeState();
            },
          });

          this.lastCompletedJob = {
            id: job.id,
            eventId: job.eventId,
            sha: job.sha,
            completedAt: new Date().toISOString(),
            result,
          };
          restartRequest = {
            jobId: job.id,
            eventId: job.eventId,
            releaseId: result.releaseId || null,
            releaseDir: result.releaseDir || null,
            currentPath: result.currentPath || null,
          };

          this.log.info("updater.job.complete", {
            jobId: job.id,
            eventId: job.eventId,
            sha: job.sha,
          });
        } catch (err) {
          job.state = "failed";
          this.state = "failed";
          this.lastFailedJob = {
            id: job.id,
            eventId: job.eventId,
            sha: job.sha,
            failedAt: new Date().toISOString(),
            error: err.message,
          };
          this.log.error("updater.job.failed", {
            jobId: job.id,
            eventId: job.eventId,
            sha: job.sha,
            error: err.message,
          });
        }

        this.queue.shift();
        this.currentJob = null;
        this.state = this.queue.length > 0 ? "queued" : "idle";
        this._writeState();
      }
    } finally {
      this.processing = false;
      if (!this.stopping && this.queue.length === 0) {
        this.state = "idle";
      }
      this._writeState();

      if (
        restartRequest &&
        !this.stopping &&
        this.queue.length === 0 &&
        typeof this.onRestartRequired === "function"
      ) {
        try {
          this.onRestartRequired(restartRequest);
        } catch (err) {
          this.log.error("updater.restart.request.error", {
            error: err.message,
            ...restartRequest,
          });
        }
      }
    }
  }

  _ensureRuntimeDir() {
    try {
      fs.mkdirSync(this.runtimeDir, { recursive: true });
    } catch (err) {
      this.log.error("updater.runtime.mkdir.error", { error: err.message });
    }
  }

  _writeState() {
    this._ensureRuntimeDir();
    const payload = {
      state: this.state,
      processing: this.processing,
      queueLength: this.queue.length,
      queue: this.queue.map((job) => ({
        id: job.id,
        state: job.state,
        queuedAt: job.queuedAt,
        eventId: job.eventId,
        repo: job.repo,
        ref: job.ref,
        sha: job.sha,
      })),
      currentJob: this.currentJob,
      lastQueuedAt: this.lastQueuedAt,
      lastEvent: this.lastEvent,
      lastCompletedJob: this.lastCompletedJob,
      lastFailedJob: this.lastFailedJob,
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(this.statePath, JSON.stringify(payload, null, 2));
    } catch (err) {
      this.log.error("updater.state.write.error", { error: err.message });
    }
  }

  _readCurrentRelease() {
    try {
      if (!fs.existsSync(this.currentPointerPath)) {
        return null;
      }
      const parsed = JSON.parse(
        fs.readFileSync(this.currentPointerPath, "utf8"),
      );
      return {
        releaseId: parsed.releaseId || null,
        resolvedSha: parsed.resolvedSha || null,
        requestedSha: parsed.requestedSha || null,
        releaseDir: parsed.releaseDir || null,
        updatedAt: parsed.updatedAt || null,
        mode: parsed.mode || null,
      };
    } catch (err) {
      this.log.warn("updater.current.read.error", { error: err.message });
      return null;
    }
  }

  _readCurrentLinkTarget() {
    try {
      const currentPath = path.join(this.runtimeDir, "current");
      if (!fs.existsSync(currentPath)) {
        return null;
      }
      return fs.realpathSync(currentPath);
    } catch (err) {
      this.log.warn("updater.current.link.resolve.error", {
        error: err.message,
      });
      return null;
    }
  }
}

module.exports = {
  UpdateQueue,
};
