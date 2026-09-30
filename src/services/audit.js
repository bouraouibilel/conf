const fs = require('fs');
const path = require('path');
const config = require('../config');

const logFile = path.join(config.storagePath, 'audit.log');
const memoryLogs = [];
const MAX_MEMORY_LOGS = 200;

function logAction(ip, user, action, details = {}, success = true) {
  const entry = {
    timestamp: new Date().toISOString(),
    ip: ip || 'unknown',
    user: user || 'system',
    action,
    success,
    details
  };

  memoryLogs.unshift(entry);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.pop();
  }

  const logLine = JSON.stringify(entry) + '\n';
  try {
    fs.appendFileSync(logFile, logLine, 'utf8');
  } catch (err) {
    console.error('Audit log write error:', err.message);
  }
}

function getRecentLogs(limit = 50) {
  return memoryLogs.slice(0, limit);
}

module.exports = {
  logAction,
  getRecentLogs
};
