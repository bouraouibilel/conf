const { exec } = require('child_process');
const config = require('../config');

function runExec(command, options = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const maxBuffer = options.maxBuffer || 1024 * 1024 * 5; // 5 MB buffer
    const timeout = options.timeout || 30000; // 30s timeout

    exec(command, { maxBuffer, timeout, ...options }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      resolve({
        command,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        exitCode: error ? (error.code || 1) : 0,
        error: error ? error.message : null,
        durationMs
      });
    });
  });
}

function getRebootCommand() {
  if (config.isWindows) {
    return 'shutdown /r /t 5 /c "Redemarrage distant demande via Web Admin"';
  }
  // Linux: Try systemctl reboot or shutdown -r
  return 'sudo systemctl reboot || sudo reboot || sudo shutdown -r now';
}

function getShutdownCommand() {
  if (config.isWindows) {
    return 'shutdown /s /t 5 /c "Arret distant demande via Web Admin"';
  }
  // Linux: Try systemctl poweroff or shutdown -h
  return 'sudo systemctl poweroff || sudo poweroff || sudo shutdown -h now';
}

function getCancelShutdownCommand() {
  if (config.isWindows) {
    return 'shutdown /a';
  }
  return 'sudo shutdown -c';
}

function getServiceCommand(action, serviceName) {
  // sanitize service name: only allow alphanumeric, dash, dot, underscore, at sign
  const safeName = serviceName.replace(/[^a-zA-Z0-9_\-@.]/g, '');
  if (!safeName) throw new Error('Nom de service invalide');

  const validActions = ['status', 'start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!validActions.includes(action)) {
    throw new Error('Action de service invalide');
  }

  if (config.isWindows) {
    if (action === 'status') return `sc query "${safeName}"`;
    if (action === 'start') return `net start "${safeName}"`;
    if (action === 'stop') return `net stop "${safeName}"`;
    if (action === 'restart') return `net stop "${safeName}" & net start "${safeName}"`;
    return `sc query "${safeName}"`;
  }

  // Linux (systemd)
  return `sudo systemctl ${action} ${safeName}`;
}

module.exports = {
  runExec,
  getRebootCommand,
  getShutdownCommand,
  getCancelShutdownCommand,
  getServiceCommand
};
