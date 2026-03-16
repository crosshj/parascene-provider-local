"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

class GpuProbe {
  constructor({ serviceRoot, log, onFailure }) {
    this.serviceRoot = serviceRoot;
    this.log = log;
    this.onFailure = typeof onFailure === "function" ? onFailure : null;

    this.runtimeDir = path.join(serviceRoot, "runtime");
    this.statePath = path.join(this.runtimeDir, "gpu-state.json");

    this.intervalMs = Number.parseInt(
      process.env.GPU_PROBE_INTERVAL_MS || "30000",
      10,
    );

    this.timer = null;
    this.state = {
      status: "unknown",
      lastProbeAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      gpus: [],
      command:
        "nvidia-smi --query-gpu=uuid,temperature.gpu,memory.used,utilization.gpu --format=csv,noheader,nounits",
      intervalMs: this.intervalMs,
      failureCount: 0,
    };
  }

  start() {
    this._ensureRuntimeDir();
    this._writeState();
    this._runProbe();
    this.timer = setInterval(() => {
      this._runProbe();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus() {
    return this.state;
  }

  async _runProbe() {
    const probeAt = new Date().toISOString();
    try {
      const output = await this._execNvidiaSmi();
      const gpus = this._parseCsv(output);

      this.state = {
        ...this.state,
        status: "healthy",
        lastProbeAt: probeAt,
        lastSuccessAt: probeAt,
        lastError: null,
        gpus,
      };

      this.log.info("gpu.probe.success", {
        gpuCount: gpus.length,
      });
      this._writeState();
    } catch (err) {
      this.state = {
        ...this.state,
        status: "degraded",
        lastProbeAt: probeAt,
        lastFailureAt: probeAt,
        lastError: err.message,
        failureCount: this.state.failureCount + 1,
      };

      this.log.warn("gpu.probe.failure", {
        error: err.message,
        failureCount: this.state.failureCount,
      });
      this._writeState();

      if (this.onFailure) {
        this.onFailure({
          error: err,
          at: probeAt,
          state: this.state,
        });
      }
    }
  }

  _ensureRuntimeDir() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
  }

  _writeState() {
    this._ensureRuntimeDir();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  _execNvidiaSmi() {
    const args = [
      "--query-gpu=uuid,temperature.gpu,memory.used,utilization.gpu",
      "--format=csv,noheader,nounits",
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("nvidia-smi", args, {
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
        reject(new Error(`nvidia-smi error: ${err.message}`));
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`nvidia-smi failed (${code}): ${stderr.trim()}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  _parseCsv(text) {
    if (!text) {
      return [];
    }

    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [uuid, temperature, memoryUsed, utilization] = line
          .split(",")
          .map((part) => part.trim());
        return {
          uuid,
          temperatureGpu: Number.parseFloat(temperature),
          memoryUsedMb: Number.parseFloat(memoryUsed),
          utilizationGpuPercent: Number.parseFloat(utilization),
        };
      });
  }
}

module.exports = {
  GpuProbe,
};
