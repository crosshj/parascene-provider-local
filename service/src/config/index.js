'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Resolve paths relative to the service directory.
 * When run as "node service/src/supervisor/index.js" from repo root,
 * __dirname in supervisor is service/src/supervisor, so service root is ../..
 */
function getServiceRoot(fromDirname) {
  return path.resolve(fromDirname, '..', '..');
}

/**
 * Load configuration. Expects serviceRoot to be the service/ directory.
 * Reads version from repo root package.json.
 */
function loadConfig(serviceRoot) {
  const repoRoot = path.join(serviceRoot, '..');
  const pkgPath = path.join(repoRoot, 'package.json');
  let version = '0.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    version = pkg.version || version;
  } catch (_) {
    // use default
  }
  const port = parseInt(process.env.SERVICE_PORT || '3090', 10);
  return {
    version,
    port,
    serviceRoot,
    repoRoot,
  };
}

module.exports = {
  getServiceRoot,
  loadConfig,
};
