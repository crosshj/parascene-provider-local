'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Structured JSON logger. Writes one JSON object per line to logs/service.log.
 * Creates the logs directory under serviceRoot if it does not exist.
 */
function createLogger(serviceRoot) {
  const logsDir = path.join(serviceRoot, 'logs');
  const logPath = path.join(logsDir, 'service.log');

  function ensureLogsDir() {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create logs dir:', err.message);
    }
  }

  function write(level, event, data = {}) {
    ensureLogsDir();
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      data,
    }) + '\n';
    try {
      fs.appendFileSync(logPath, line);
    } catch (err) {
      console.error('Log write failed:', err.message);
    }
  }

  return {
    info(event, data) {
      write('info', event, data);
    },
    warn(event, data) {
      write('warn', event, data);
    },
    error(event, data) {
      write('error', event, data);
    },
  };
}

module.exports = {
  createLogger,
};
