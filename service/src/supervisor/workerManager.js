"use strict";

const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");

class WorkerManager {
  constructor({ serviceRoot, log, mode = "normal" }) {
    this.serviceRoot = serviceRoot;
    this.repoRoot = path.join(serviceRoot, "..");
    this.log = log;
    this.mode = mode;

    this.child = null;
    this.state = "stopped";
    this.restartCount = 0;
    this.lastHeartbeat = null;
    this.startedAt = null;
    this.stopping = false;

    this.heartbeatTimeoutMs = Number.parseInt(
      process.env.WORKER_HEARTBEAT_TIMEOUT_MS || "10000",
      10,
    );
    this.restartDelayMs = Number.parseInt(
      process.env.WORKER_RESTART_DELAY_MS || "1000",
      10,
    );

    this.monitorTimer = null;
    this.restartTimer = null;
    this.heartbeatFilePath = path.join(
      this.serviceRoot,
      "runtime",
      "worker-heartbeat.json",
    );
  }

  start() {
    this.stopping = false;
    this._spawnWorker();
    this._startMonitor();
  }

  async stop() {
    this.stopping = true;
    this.state = "stopped";
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (!this.child) {
      return;
    }

    await new Promise((resolve) => {
      const child = this.child;
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_) {
          // noop
        }
      }, 3000);

      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      try {
        child.kill("SIGTERM");
      } catch (_) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  getStatus() {
    return {
      pid: this.child && this.child.pid ? this.child.pid : null,
      state: this.state,
      restartCount: this.restartCount,
      lastHeartbeat: this.lastHeartbeat,
      mode: this.mode,
      heartbeatTimeoutMs: this.heartbeatTimeoutMs,
      startedAt: this.startedAt,
    };
  }

  requestRestart(reason = "external_request") {
    this._scheduleRestart(reason);
  }

  _spawnWorker() {
    const workerPath = path.join(
      this.serviceRoot,
      "src",
      "worker",
      "dummyWorker.js",
    );

    this.state = this.restartCount > 0 ? "restarting" : "starting";
    this.lastHeartbeat = null;
    this.startedAt = new Date().toISOString();

    const child = fork(workerPath, ["--mode", this.mode], {
      cwd: this.repoRoot,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: process.env,
    });
    this.child = child;

    this.log.info("worker.spawn", {
      pid: child.pid,
      mode: this.mode,
      restartCount: this.restartCount,
    });

    child.on("message", (msg) => {
      if (!msg || msg.type !== "heartbeat") {
        return;
      }
      const nowIso = new Date().toISOString();
      this.lastHeartbeat = nowIso;
      this.state = "healthy";
      this._writeHeartbeatFile({
        workerPid: child.pid,
        receivedAt: nowIso,
        mode: this.mode,
      });
    });

    child.on("exit", (code, signal) => {
      const exitedPid = child.pid;
      if (this.child && this.child.pid === exitedPid) {
        this.child = null;
      }

      if (this.stopping) {
        this.state = "stopped";
        this.log.info("worker.exit", {
          pid: exitedPid,
          code,
          signal,
          restarting: false,
        });
        return;
      }

      this.state = "unhealthy";
      this.log.warn("worker.exit", {
        pid: exitedPid,
        code,
        signal,
        restarting: true,
      });
      this._scheduleRestart("worker_exit");
    });
  }

  _startMonitor() {
    this.monitorTimer = setInterval(() => {
      if (this.stopping || !this.child) {
        return;
      }

      const now = Date.now();
      const lastHeartbeatTs = this.lastHeartbeat
        ? Date.parse(this.lastHeartbeat)
        : 0;
      const referenceTs =
        lastHeartbeatTs ||
        Date.parse(this.startedAt || new Date(0).toISOString());
      const elapsedMs = now - referenceTs;

      if (elapsedMs > this.heartbeatTimeoutMs) {
        this.state = "unhealthy";
        this.log.warn("worker.heartbeat.timeout", {
          pid: this.child.pid,
          elapsedMs,
          timeoutMs: this.heartbeatTimeoutMs,
        });
        this._scheduleRestart("heartbeat_timeout");
      }
    }, 1000);
  }

  _scheduleRestart(reason) {
    if (this.stopping || this.restartTimer) {
      return;
    }

    this.restartCount += 1;
    this.state = "restarting";
    this.log.warn("worker.restart.scheduled", {
      reason,
      delayMs: this.restartDelayMs,
      restartCount: this.restartCount,
    });

    if (this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch (_) {
        // noop
      }
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping || this.child) {
        return;
      }
      this._spawnWorker();
    }, this.restartDelayMs);
  }

  _writeHeartbeatFile(payload) {
    try {
      fs.writeFileSync(
        this.heartbeatFilePath,
        JSON.stringify(payload, null, 2),
      );
    } catch (err) {
      this.log.error("worker.heartbeat.write.error", { error: err.message });
    }
  }
}

module.exports = {
  WorkerManager,
};
