"use strict";

const fs = require("fs");
const path = require("path");

class UpdateQueue {
  constructor({ serviceRoot, log }) {
    this.serviceRoot = serviceRoot;
    this.log = log;

    this.runtimeDir = path.join(serviceRoot, "runtime");
    this.statePath = path.join(this.runtimeDir, "update-state.json");
    this.eventsPath = path.join(this.runtimeDir, "webhook-events.jsonl");

    this.queue = [];
    this.lastEvent = null;
    this.lastQueuedAt = null;
  }

  start() {
    this._ensureRuntimeDir();
    this._writeState();
  }

  getStatus() {
    return {
      state: this.queue.length > 0 ? "queued" : "idle",
      queueLength: this.queue.length,
      lastQueuedAt: this.lastQueuedAt,
      lastEvent: this.lastEvent,
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

    this._writeState();

    this.log.info("updater.job.enqueued", {
      jobId: job.id,
      eventId: event.id,
      queueLength: this.queue.length,
      repo: event.repo,
      ref: event.ref,
      sha: event.sha,
    });

    return job;
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
      state: this.queue.length > 0 ? "queued" : "idle",
      queueLength: this.queue.length,
      lastQueuedAt: this.lastQueuedAt,
      lastEvent: this.lastEvent,
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(this.statePath, JSON.stringify(payload, null, 2));
    } catch (err) {
      this.log.error("updater.state.write.error", { error: err.message });
    }
  }
}

module.exports = {
  UpdateQueue,
};
