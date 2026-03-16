"use strict";

function parseMode(argv) {
  const modeFlagIndex = argv.findIndex((arg) => arg === "--mode");
  if (modeFlagIndex >= 0 && argv[modeFlagIndex + 1]) {
    return argv[modeFlagIndex + 1];
  }
  return "normal";
}

function parseModeSeconds(mode, prefix) {
  if (!mode.startsWith(prefix)) {
    return null;
  }
  const value = Number.parseInt(mode.slice(prefix.length), 10);
  if (Number.isNaN(value) || value < 0) {
    return null;
  }
  return value;
}

function sendHeartbeat() {
  if (typeof process.send === "function") {
    process.send({
      type: "heartbeat",
      at: new Date().toISOString(),
      pid: process.pid,
    });
  }
}

function main() {
  const mode = parseMode(process.argv.slice(2));
  let heartbeatTimer = setInterval(sendHeartbeat, 3000);
  sendHeartbeat();

  const crashAfterSec = parseModeSeconds(mode, "crash-after=");
  if (crashAfterSec != null) {
    setTimeout(() => {
      process.exit(1);
    }, crashAfterSec * 1000);
  }

  const stopHeartbeatAfterSec = parseModeSeconds(mode, "stop-heartbeat-after=");
  if (stopHeartbeatAfterSec != null) {
    setTimeout(() => {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }, stopHeartbeatAfterSec * 1000);
  }

  const hangAfterSec = parseModeSeconds(mode, "hang-after=");
  if (hangAfterSec != null) {
    setTimeout(() => {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;

      // Block forever to simulate an unresponsive process.
      const blocker = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(blocker, 0, 0);
    }, hangAfterSec * 1000);
  }

  const shutdown = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
