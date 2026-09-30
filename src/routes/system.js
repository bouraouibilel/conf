const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { verifySensitiveAction } = require('../middleware/sensitiveAuth');
const metricsService = require('../services/metrics');
const sshManager = require('../services/sshManager');
const machineService = require('../services/machines');
const audit = require('../services/audit');
const { runExec, getRebootCommand, getShutdownCommand, getCancelShutdownCommand } = require('../utils/execHelper');
const config = require('../config');

// Get static system specs
router.get('/info', authenticateToken, async (req, res) => {
  const machineId = req.query.machineId || 'local';

  if (machineId === 'local') {
    try {
      const info = await metricsService.getStaticSystemInfo();
      return res.json(info);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const machine = machineService.getById(machineId);
  if (!machine) return res.status(404).json({ error: 'Machine introuvable' });

  try {
    const resOs = await sshManager.execCommand(machineId, 'uname -m; cat /etc/os-release 2>/dev/null; nproc 2>/dev/null', 5000);
    res.json({
      hostname: machine.name || machine.host,
      platform: 'linux',
      distro: machine.name,
      release: machine.host,
      arch: resOs.stdout.split('\n')[0] || 'x86_64',
      cpuModel: `Hôte SSH distant (${machine.host})`,
      cpuCores: parseInt(resOs.stdout.split('\n').pop(), 10) || 1,
      cpuThreads: parseInt(resOs.stdout.split('\n').pop(), 10) || 1
    });
  } catch (err) {
    res.json({
      hostname: machine.name,
      platform: 'linux',
      distro: 'Linux distant',
      release: machine.host,
      arch: 'x86_64',
      cpuModel: 'Distant',
      cpuCores: 1,
      cpuThreads: 1
    });
  }
});

// Get live CPU, RAM, Disk, Network metrics
router.get('/metrics', authenticateToken, async (req, res) => {
  const machineId = req.query.machineId || 'local';

  if (machineId === 'local') {
    try {
      const live = await metricsService.getLiveMetrics();
      return res.json(live);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const live = await sshManager.getRemoteMetrics(machineId);
    res.json(live);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get running processes
router.get('/processes', authenticateToken, async (req, res) => {
  const machineId = req.query.machineId || 'local';
  const limit = parseInt(req.query.limit, 10) || 30;

  if (machineId === 'local') {
    try {
      const processes = await metricsService.getProcessList(limit);
      return res.json(processes);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const resPs = await sshManager.execCommand(
      machineId,
      `ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n ${limit + 1}`,
      6000
    );

    const lines = resPs.stdout.split('\n').filter(Boolean);
    const list = lines.slice(1).map(l => {
      const parts = l.trim().split(/\s+/);
      return {
        pid: parseInt(parts[0], 10),
        user: parts[1],
        cpu: parseFloat(parts[2]) || 0,
        mem: parseFloat(parts[3]) || 0,
        name: parts.slice(4).join(' ')
      };
    });

    res.json({ all: list.length, running: list.length, list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kill a process (Sensitive Action: requires password verification!)
router.post('/processes/kill', authenticateToken, verifySensitiveAction, async (req, res) => {
  const { pid, signal, machineId } = req.body;
  const targetId = machineId || 'local';
  const clientIp = req.ip;

  if (!pid) {
    return res.status(400).json({ error: 'PID requis' });
  }

  const sig = signal || 'SIGTERM';
  audit.logAction(clientIp, req.user.username, 'KILL_PROCESS_REQUEST', { pid, signal: sig, machineId: targetId });

  if (targetId === 'local') {
    const killCmd = config.isWindows 
      ? `taskkill /F /PID ${parseInt(pid, 10)}`
      : `kill -s ${sig} ${parseInt(pid, 10)}`;

    const result = await runExec(killCmd);
    if (result.exitCode === 0) {
      audit.logAction(clientIp, req.user.username, 'KILL_PROCESS_SUCCESS', { pid });
      return res.json({ success: true, message: `Processus ${pid} terminé avec succès.` });
    } else {
      return res.status(500).json({ error: `Impossible de terminer le processus: ${result.stderr || result.error}` });
    }
  }

  // Remote kill via SSH
  const remoteCmd = `sudo kill -s ${sig} ${parseInt(pid, 10)} || kill -s ${sig} ${parseInt(pid, 10)}`;
  const result = await sshManager.execCommand(targetId, remoteCmd);
  if (result.exitCode === 0) {
    audit.logAction(clientIp, req.user.username, 'KILL_PROCESS_SUCCESS', { pid, machineId: targetId });
    res.json({ success: true, message: `Processus distant ${pid} terminé.` });
  } else {
    res.status(500).json({ error: `Erreur: ${result.stderr || 'Échec de la commande'}` });
  }
});

// Trigger Reboot (Sensitive Action: requires password verification!)
router.post('/reboot', authenticateToken, verifySensitiveAction, async (req, res) => {
  const { machineId } = req.body;
  const targetId = machineId || 'local';
  const clientIp = req.ip;

  audit.logAction(clientIp, req.user.username, 'SYSTEM_REBOOT_TRIGGERED', { machineId: targetId });

  if (targetId === 'local') {
    const rebootCmd = getRebootCommand();
    res.json({
      success: true,
      message: 'Commande de redémarrage envoyée au système local. La machine va redémarrer sous peu.',
      command: rebootCmd
    });

    setTimeout(async () => {
      try {
        await runExec(rebootCmd);
      } catch (e) {
        console.error('Reboot execution error:', e.message);
      }
    }, 1000);
    return;
  }

  // Remote reboot via SSH
  const machine = machineService.getById(targetId);
  const targetName = machine ? machine.name : targetId;
  const remoteRebootCmd = 'sudo systemctl reboot || sudo reboot || sudo shutdown -r now';

  res.json({
    success: true,
    message: `Commande de redémarrage envoyée avec succès à la machine distante "${targetName}".`,
    command: remoteRebootCmd
  });

  setTimeout(async () => {
    try {
      await sshManager.execCommand(targetId, remoteRebootCmd, 10000);
    } catch (e) {
      console.error('Remote reboot error:', e.message);
    }
  }, 1000);
});

// Trigger Shutdown (Sensitive Action: requires password verification!)
router.post('/shutdown', authenticateToken, verifySensitiveAction, async (req, res) => {
  const { machineId } = req.body;
  const targetId = machineId || 'local';
  const clientIp = req.ip;

  audit.logAction(clientIp, req.user.username, 'SYSTEM_SHUTDOWN_TRIGGERED', { machineId: targetId });

  if (targetId === 'local') {
    const shutdownCmd = getShutdownCommand();
    res.json({
      success: true,
      message: 'Commande d\'arrêt envoyée au système local. La machine va s\'éteindre sous peu.',
      command: shutdownCmd
    });

    setTimeout(async () => {
      try {
        await runExec(shutdownCmd);
      } catch (e) {
        console.error('Shutdown execution error:', e.message);
      }
    }, 1000);
    return;
  }

  // Remote shutdown via SSH
  const machine = machineService.getById(targetId);
  const targetName = machine ? machine.name : targetId;
  const remoteShutdownCmd = 'sudo systemctl poweroff || sudo poweroff || sudo shutdown -h now';

  res.json({
    success: true,
    message: `Commande d'arrêt envoyée avec succès à la machine distante "${targetName}".`,
    command: remoteShutdownCmd
  });

  setTimeout(async () => {
    try {
      await sshManager.execCommand(targetId, remoteShutdownCmd, 10000);
    } catch (e) {
      console.error('Remote shutdown error:', e.message);
    }
  }, 1000);
});

// Cancel Shutdown (if scheduled/delayed)
router.post('/cancel-shutdown', authenticateToken, async (req, res) => {
  const { machineId } = req.body;
  const targetId = machineId || 'local';
  const clientIp = req.ip;

  audit.logAction(clientIp, req.user.username, 'CANCEL_SHUTDOWN', { machineId: targetId });

  if (targetId === 'local') {
    const cancelCmd = getCancelShutdownCommand();
    const result = await runExec(cancelCmd);
    if (result.exitCode === 0) {
      return res.json({ success: true, message: 'Arrêt programmé annulé avec succès.' });
    } else {
      return res.status(500).json({ error: result.stderr || 'Impossible d\'annuler l\'arrêt' });
    }
  }

  const resSsh = await sshManager.execCommand(targetId, 'sudo shutdown -c');
  if (resSsh.exitCode === 0) {
    res.json({ success: true, message: 'Arrêt programmé annulé sur la machine distante.' });
  } else {
    res.status(500).json({ error: resSsh.stderr || 'Impossible d\'annuler l\'arrêt à distance' });
  }
});

// Get Audit logs
router.get('/audit', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json(audit.getRecentLogs(limit));
});

module.exports = router;
