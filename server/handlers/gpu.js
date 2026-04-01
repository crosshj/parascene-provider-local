"use strict";

const { spawn } = require("child_process");

const { sendJson } = require("../lib/http.js");

const GPU_QUERY_CMD =
  "nvidia-smi --query-gpu=uuid,temperature.gpu,memory.used,utilization.gpu --format=csv,noheader,nounits";

function execNvidiaSmi() {
  const args = [
    "--query-gpu=uuid,temperature.gpu,memory.used,utilization.gpu",
    "--format=csv,noheader,nounits",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("nvidia-smi", args, {
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

function parseGpuCsv(text) {
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

/**
 * Run nvidia-smi and return a GPU state object. Never rejects: on failure
 * returns state with status "degraded" and lastError set.
 *
 * @returns {Promise<object>} State: { status, lastProbeAt, lastSuccessAt, lastFailureAt, lastError, failureCount, gpus, command }
 */
async function getGpuState() {
  const startedAt = new Date().toISOString();
  const base = {
    lastProbeAt: startedAt,
    command: GPU_QUERY_CMD,
  };

  try {
    const output = await execNvidiaSmi();
    const gpus = parseGpuCsv(output);
    return {
      ...base,
      status: "healthy",
      lastSuccessAt: startedAt,
      lastFailureAt: null,
      lastError: null,
      failureCount: 0,
      gpus,
    };
  } catch (err) {
    return {
      ...base,
      status: "degraded",
      lastSuccessAt: null,
      lastFailureAt: startedAt,
      lastError: err.message,
      failureCount: 1,
      gpus: [],
    };
  }
}

function handleGpu(_req, res, _ctx) {
  getGpuState().then((state) => {
    if (state.status === "degraded") {
      console.warn("[server] gpu.probe.error", state.lastError);
    }
    sendJson(res, state.status === "healthy" ? 200 : 500, state);
  });
}

module.exports = {
  getGpuState,
  handleGpu,
};
