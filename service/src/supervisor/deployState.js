"use strict";

const fs = require("fs");
const path = require("path");

const FILENAME = "deploy-state.json";

function getDeployStatePath(dataRoot) {
  return path.join(dataRoot || "", "runtime", FILENAME);
}

function readDeployState(dataRoot) {
  const filePath = getDeployStatePath(dataRoot);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (_) {
    // ignore
  }
  return null;
}

function writeDeployState(dataRoot, state) {
  const runtimeDir = path.dirname(getDeployStatePath(dataRoot));
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    getDeployStatePath(dataRoot),
    JSON.stringify(
      {
        ...state,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

module.exports = {
  getDeployStatePath,
  readDeployState,
  writeDeployState,
};
