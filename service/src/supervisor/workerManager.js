"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const { fork, spawn, spawnSync } = require("child_process");

class WorkerManager {
  constructor({
    serviceRoot,
    dataRoot,
    log,
    mode = "normal",
    impl = "python",
  }) {
    this.serviceRoot = serviceRoot;
    this.dataRoot = dataRoot || serviceRoot;
    this.repoRoot = path.join(serviceRoot, "..");
    this.log = log;
    this.mode = mode;
    this.impl = impl;

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
    this.readyTimeoutMs = Number.parseInt(
      process.env.WORKER_READY_TIMEOUT_MS || "30000",
      10,
    );
    this.restartDelayMs = Number.parseInt(
      process.env.WORKER_RESTART_DELAY_MS || "1000",
      10,
    );

    this.pyWorkerHost = process.env.PY_WORKER_HOST || "127.0.0.1";
    this.pyWorkerPort = Number.parseInt(
      process.env.PY_WORKER_PORT || "3199",
      10,
    );
    this.pythonExecutable = process.env.PYTHON_WORKER_EXECUTABLE_OVERRIDE || "";
    this.pythonWorkerScript =
      process.env.PYTHON_WORKER_SCRIPT ||
      path.join(this.repoRoot, "generator", "worker_server.py");

    this.monitorTimer = null;
    this.restartTimer = null;
    this.heartbeatFilePath = path.join(
      this.dataRoot,
      "runtime",
      "worker-heartbeat.json",
    );
  }

  start() {
    this.stopping = false;
    this._spawnWorker().catch((err) => {
      this.log.error("worker.spawn.error", {
        error: err.message,
        impl: this.impl,
      });
      this._scheduleRestart("worker_spawn_error");
    });
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
      impl: this.impl,
      restartCount: this.restartCount,
      lastHeartbeat: this.lastHeartbeat,
      mode: this.mode,
      heartbeatTimeoutMs: this.heartbeatTimeoutMs,
      readyTimeoutMs: this.readyTimeoutMs,
      endpoint:
        this.impl === "python"
          ? `http://${this.pyWorkerHost}:${this.pyWorkerPort}`
          : null,
      startedAt: this.startedAt,
    };
  }

  requestRestart(reason = "external_request") {
    this._scheduleRestart(reason);
  }

  async _spawnWorker() {
    this.state = this.restartCount > 0 ? "restarting" : "starting";
    this.lastHeartbeat = null;
    this.startedAt = new Date().toISOString();

    let child;
    if (this.impl === "dummy") {
      child = this._spawnDummyWorker();
    } else {
      child = this._spawnPythonWorker();
    }
    this.child = child;

    child.on("error", (err) => {
      this.log.error("worker.process.error", {
        impl: this.impl,
        pid: child.pid || null,
        error: err.message,
      });
    });

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        const msg = String(chunk || "").trim();
        if (!msg) {
          return;
        }
        this.log.info("worker.stdout", {
          impl: this.impl,
          pid: child.pid || null,
          msg,
        });
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const msg = String(chunk || "").trim();
        if (!msg) {
          return;
        }
        this.log.warn("worker.stderr", {
          impl: this.impl,
          pid: child.pid || null,
          msg,
        });
      });
    }

    child.on("exit", (code, signal) => {
      const exitedPid = child.pid;
      if (this.child && this.child.pid === exitedPid) {
        this.child = null;
      }

      if (this.stopping) {
        this.state = "stopped";
        this.log.info("worker.exit", {
          pid: exitedPid,
          impl: this.impl,
          code,
          signal,
          restarting: false,
        });
        return;
      }

      this.state = "unhealthy";
      this.log.warn("worker.exit", {
        pid: exitedPid,
        impl: this.impl,
        code,
        signal,
        restarting: true,
      });
      this._scheduleRestart("worker_exit");
    });

    this.log.info("worker.spawn", {
      pid: child.pid,
      impl: this.impl,
      pythonExec:
        this.impl === "python" ? this._lastPythonExecLabel || "unknown" : null,
      mode: this.mode,
      restartCount: this.restartCount,
    });

    if (this.impl === "dummy") {
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
          impl: this.impl,
        });
      });
    }

    if (this.impl === "python") {
      try {
        await this._waitForPythonReady();
      } catch (err) {
        this.log.error("worker.ready.error", {
          impl: this.impl,
          pid: child.pid || null,
          error: err.message,
        });
        if (this.child && this.child.pid === child.pid) {
          try {
            this.child.kill("SIGTERM");
          } catch (_) {
            // noop
          }
        }
        throw err;
      }
      const nowIso = new Date().toISOString();
      this.lastHeartbeat = nowIso;
      this.state = "healthy";
      this._writeHeartbeatFile({
        workerPid: child.pid,
        receivedAt: nowIso,
        mode: this.mode,
        impl: this.impl,
        ready: true,
      });
    }
  }

  _spawnDummyWorker() {
    const workerPath = path.join(
      this.serviceRoot,
      "src",
      "worker",
      "dummyWorker.js",
    );
    return fork(workerPath, ["--mode", this.mode], {
      cwd: this.repoRoot,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: process.env,
    });
  }

  _spawnPythonWorker() {
    const { exec, args, label } = this._resolvePythonLaunchCommand();
    this._lastPythonExecLabel = label;

    if (!this._isPythonLaunchUsable(exec)) {
      this.log.warn("worker.python.unavailable.fallback", {
        exec,
        label,
        fallbackImpl: "dummy",
      });
      this.impl = "dummy";
      this._lastPythonExecLabel = "fallback:dummy";
      return this._spawnDummyWorker();
    }

    const env = {
      ...process.env,
      PY_WORKER_HOST: this.pyWorkerHost,
      PY_WORKER_PORT: String(this.pyWorkerPort),
    };

    return spawn(exec, args, {
      cwd: this.repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  }

  _isPythonLaunchUsable(exec) {
    try {
      const probeArgs = /py(\.exe)?$/i.test(exec)
        ? ["-3", "--version"]
        : ["--version"];
      const probe = spawnSync(exec, probeArgs, {
        cwd: this.repoRoot,
        env: process.env,
        timeout: 3000,
        windowsHide: true,
      });
      if (probe.error) {
        return false;
      }
      return probe.status === 0;
    } catch (_) {
      return false;
    }
  }

  _resolvePythonLaunchCommand() {
    const allowVenvLauncher = process.env.PYTHON_WORKER_ALLOW_VENV === "1";

    if (this.pythonExecutable) {
      const looksLikeVenvLauncher =
        /\.venv[\\\/]Scripts[\\\/]python\.exe$/i.test(this.pythonExecutable);
      if (looksLikeVenvLauncher && !allowVenvLauncher) {
        const windowsPy = "C:\\Windows\\py.exe";
        if (fs.existsSync(windowsPy)) {
          return {
            exec: windowsPy,
            args: ["-3", this.pythonWorkerScript],
            label: `${windowsPy} -3 (venv launcher bypass)`,
          };
        }
      }

      return {
        exec: this.pythonExecutable,
        args: [this.pythonWorkerScript],
        label: this.pythonExecutable,
      };
    }

    const windowsPy = "C:\\Windows\\py.exe";
    if (fs.existsSync(windowsPy)) {
      return {
        exec: windowsPy,
        args: ["-3", this.pythonWorkerScript],
        label: `${windowsPy} -3`,
      };
    }

    return {
      exec: "py",
      args: ["-3", this.pythonWorkerScript],
      label: "py -3",
    };
  }

  async _waitForPythonReady() {
    const started = Date.now();
    while (!this.stopping && Date.now() - started < this.readyTimeoutMs) {
      if (!this.child) {
        throw new Error("Python worker exited before readiness");
      }
      try {
        const ok = await this._probePythonPath("/readyz", 1200, true);
        if (ok) {
          return;
        }
      } catch (_) {
        // continue retry loop until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      `Python worker readiness timed out after ${this.readyTimeoutMs}ms`,
    );
  }

  _startMonitor() {
    this.monitorTimer = setInterval(() => {
      if (this.stopping || !this.child) {
        return;
      }

      if (this.impl === "python") {
        this._monitorPythonWorker();
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
          impl: this.impl,
          elapsedMs,
          timeoutMs: this.heartbeatTimeoutMs,
        });
        this._scheduleRestart("heartbeat_timeout");
      }
    }, 1000);
  }

  async _monitorPythonWorker() {
    if (this.stopping || !this.child) {
      return;
    }

    try {
      const sinceStartMs =
        Date.now() - Date.parse(this.startedAt || new Date(0).toISOString());
      if (this.state === "starting" && sinceStartMs < this.readyTimeoutMs) {
        return;
      }

      const healthy = await this._probePythonPath("/healthz", 1200, false);
      if (healthy) {
        const nowIso = new Date().toISOString();
        this.lastHeartbeat = nowIso;
        if (this.state !== "healthy") {
          this.state = "healthy";
        }
        this._writeHeartbeatFile({
          workerPid: this.child.pid,
          receivedAt: nowIso,
          mode: this.mode,
          impl: this.impl,
          healthy: true,
        });
        return;
      }
      this.state = "unhealthy";
      this.log.warn("worker.healthz.unhealthy", {
        pid: this.child.pid,
        impl: this.impl,
      });
      this._scheduleRestart("worker_healthz_unhealthy");
    } catch (err) {
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
        this.log.warn("worker.healthz.timeout", {
          pid: this.child.pid,
          impl: this.impl,
          elapsedMs,
          timeoutMs: this.heartbeatTimeoutMs,
          error: err.message,
        });
        this._scheduleRestart("worker_healthz_timeout");
      }
    }
  }

  _probePythonPath(pathname, timeoutMs, expectReadyBody) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.pyWorkerHost,
          port: this.pyWorkerPort,
          path: pathname,
          method: "GET",
          timeout: timeoutMs,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            if (res.statusCode !== 200) {
              resolve(false);
              return;
            }
            if (!expectReadyBody) {
              resolve(true);
              return;
            }
            try {
              const parsed = JSON.parse(body || "{}");
              resolve(Boolean(parsed.ready));
            } catch (_) {
              resolve(false);
            }
          });
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error("worker probe timeout"));
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.end();
    });
  }

  _scheduleRestart(reason) {
    if (this.stopping || this.restartTimer) {
      return;
    }

    this.restartCount += 1;
    this.state = "restarting";
    this.log.warn("worker.restart.scheduled", {
      reason,
      impl: this.impl,
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
      this._spawnWorker().catch((err) => {
        this.log.error("worker.respawn.error", {
          error: err.message,
          impl: this.impl,
        });
        this._scheduleRestart("worker_respawn_error");
      });
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
