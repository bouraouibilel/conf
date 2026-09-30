const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { verifySensitiveAction } = require('../middleware/sensitiveAuth');
const { runExec, getServiceCommand } = require('../utils/execHelper');
const sshManager = require('../services/sshManager');
const machineService = require('../services/machines');
const audit = require('../services/audit');
const config = require('../config');

const DEFAULT_LINUX_SERVICES = [
  'ssh', 'sshd', 'nginx', 'apache2', 'docker', 
  'cron', 'mysql', 'mariadb', 'postgresql', 'redis-server', 
  'ufw', 'fail2ban'
];

// Get status of services (including autossh/tunnel auto-discovery & pattern search)
router.get('/', authenticateToken, async (req, res) => {
  const machineId = req.query.machineId || 'local';
  const customQuery = req.query.names;
  const searchPattern = req.query.search ? req.query.search.trim().replace(/[^a-zA-Z0-9_\-*@.]/g, '') : null;

  let servicesToQuery = [];

  if (searchPattern) {
    if (machineId === 'local' && config.isWindows) {
      const winRes = await runExec(`powershell -Command "Get-Service -Name *${searchPattern}* | Select-Object -ExpandProperty Name"`);
      servicesToQuery = winRes.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      const scanCmd = `systemctl list-units --type=service --all --no-legend --no-pager "*${searchPattern}*" | awk '{print $1}'`;
      const scanRes = machineId === 'local' 
        ? await runExec(scanCmd, { timeout: 4000 }) 
        : await sshManager.execCommand(machineId, scanCmd, 5000);
      servicesToQuery = scanRes.stdout.split('\n').map(s => s.trim().replace('.service', '')).filter(Boolean);
    }
  } else if (customQuery) {
    servicesToQuery = customQuery.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    // Default list
    servicesToQuery = machineId === 'local' && config.isWindows 
      ? ['wuauserv', 'LanmanServer', 'Spooler', 'Winmgmt'] 
      : [...DEFAULT_LINUX_SERVICES];

    // Automatically discover any existing autossh or cloudflared services in systemd
    if (machineId !== 'local' || !config.isWindows) {
      try {
        const scanTunnelsCmd = `systemctl list-units --type=service --all --no-legend --no-pager "*autossh*" "*cloudflared*" "*tunnel*" 2>/dev/null | awk '{print $1}'`;
        const resTunnels = machineId === 'local'
          ? await runExec(scanTunnelsCmd, { timeout: 3000 })
          : await sshManager.execCommand(machineId, scanTunnelsCmd, 4000);
        const discovered = resTunnels.stdout.split('\n').map(s => s.trim().replace('.service', '')).filter(Boolean);
        if (discovered.length > 0) {
          servicesToQuery = [...new Set([...discovered, ...servicesToQuery])];
        }
      } catch (e) {}
    }
  }

  const results = [];

  for (const s of servicesToQuery) {
    try {
      let resExec;
      if (machineId === 'local') {
        const cmd = getServiceCommand('status', s);
        resExec = await runExec(cmd, { timeout: 4000 });
      } else {
        const cmd = `sudo systemctl status ${s} || systemctl status ${s}`;
        resExec = await sshManager.execCommand(machineId, cmd, 4000);
      }

      let status = 'unknown';
      if (machineId === 'local' && config.isWindows) {
        if (resExec.stdout.includes('RUNNING')) status = 'running';
        else if (resExec.stdout.includes('STOPPED')) status = 'stopped';
        else if (resExec.exitCode !== 0) status = 'not-found';
      } else {
        if (resExec.stdout.includes('Active: active (running)')) status = 'running';
        else if (resExec.stdout.includes('Active: inactive (dead)')) status = 'stopped';
        else if (resExec.stdout.includes('Active: failed')) status = 'failed';
        else if (resExec.exitCode === 0) status = 'active';
        else if (resExec.exitCode === 4 || resExec.stderr.includes('not found') || resExec.stdout.includes('could not be found')) status = 'not-found';
        else status = 'inactive';
      }

      results.push({
        name: s,
        status,
        output: resExec.stdout || resExec.stderr
      });
    } catch (e) {
      results.push({ name: s, status: 'error', error: e.message });
    }
  }

  res.json({
    machineId,
    services: results
  });
});

// Perform action on service: start, stop, restart, reload, status
// Note: If action is 'stop' or 'restart', password verification is required!
router.post('/action', authenticateToken, (req, res, next) => {
  const { action } = req.body;
  if (action === 'stop' || action === 'restart') {
    return verifySensitiveAction(req, res, next);
  }
  next();
}, async (req, res) => {
  const { action, serviceName, machineId } = req.body;
  const targetId = machineId || 'local';
  const clientIp = req.ip;

  if (!action || !serviceName) {
    return res.status(400).json({ error: 'Action et nom de service requis' });
  }

  try {
    let result;
    if (targetId === 'local') {
      const cmd = getServiceCommand(action, serviceName);
      audit.logAction(clientIp, req.user.username, 'SERVICE_ACTION_REQUEST', { action, serviceName, machineId: targetId });
      result = await runExec(cmd, { timeout: 15000 });
    } else {
      const safeName = serviceName.replace(/[^a-zA-Z0-9_\-@.]/g, '');
      const remoteCmd = `sudo systemctl ${action} ${safeName}`;
      audit.logAction(clientIp, req.user.username, 'SERVICE_ACTION_REQUEST', { action, serviceName, machineId: targetId });
      result = await sshManager.execCommand(targetId, remoteCmd, 15000);
    }

    const success = result.exitCode === 0;
    audit.logAction(clientIp, req.user.username, 'SERVICE_ACTION_DONE', {
      action,
      serviceName,
      machineId: targetId,
      exitCode: result.exitCode
    }, success);

    res.json({
      success,
      action,
      serviceName,
      machineId: targetId,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      message: success 
        ? `Action '${action}' effectuée sur le service '${serviceName}'` 
        : `Échec de l'action '${action}' sur '${serviceName}'`
    });
  } catch (err) {
    audit.logAction(clientIp, req.user.username, 'SERVICE_ACTION_ERROR', { action, serviceName, machineId: targetId, error: err.message }, false);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
