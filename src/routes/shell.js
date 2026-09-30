const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { runExec } = require('../utils/execHelper');
const sshManager = require('../services/sshManager');
const machineService = require('../services/machines');
const audit = require('../services/audit');
const config = require('../config');

// Get useful presets according to platform
router.get('/presets', authenticateToken, (req, res) => {
  const machineId = req.query.machineId || 'local';

  if (machineId === 'local' && config.isWindows) {
    return res.json([
      { name: 'Espace disque', command: 'Get-PSDrive -PSProvider FileSystem' },
      { name: 'Ports en écoute', command: 'netstat -ano | findstr LISTENING' },
      { name: 'Services en cours', command: 'Get-Service | Where-Object {$_.Status -eq "Running"}' },
      { name: 'Configuration réseau', command: 'ipconfig /all' },
      { name: 'Processus gourmands', command: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 10' }
    ]);
  }

  // Linux presets (used for remote Linux machines or local Linux)
  res.json([
    { name: 'Espace disque (df -h)', command: 'df -h' },
    { name: 'Mémoire vive (free -m)', command: 'free -m' },
    { name: 'Ports en écoute (ss -tuln)', command: 'ss -tulnp || netstat -tulnp' },
    { name: 'Adresses IP (ip a)', command: 'ip -brief address show || ifconfig' },
    { name: 'Services en échec (systemctl)', command: 'systemctl --failed' },
    { name: 'Derniers logs noyau (dmesg)', command: 'dmesg -T | tail -n 25' },
    { name: 'Conteneurs Docker', command: 'docker ps -a' },
    { name: 'Uptime & charge (uptime)', command: 'uptime' }
  ]);
});

// Execute shell command (local or remote machine)
router.post('/exec', authenticateToken, async (req, res) => {
  const { command, cwd, timeout, machineId } = req.body;
  const targetId = machineId || 'local';
  const clientIp = req.ip;

  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ error: 'La commande ne peut pas être vide' });
  }

  const cleanCmd = command.trim();
  const timeLimit = timeout ? Math.min(parseInt(timeout, 10), 120000) : 30000;

  audit.logAction(clientIp, req.user.username, 'EXEC_SHELL_COMMAND', { command: cleanCmd, machineId: targetId });

  if (targetId === 'local') {
    try {
      const result = await runExec(cleanCmd, { cwd: cwd || undefined, timeout: timeLimit });
      audit.logAction(clientIp, req.user.username, 'EXEC_SHELL_FINISHED', { 
        command: cleanCmd, 
        exitCode: result.exitCode, 
        durationMs: result.durationMs 
      }, result.exitCode === 0);

      return res.json(result);
    } catch (err) {
      audit.logAction(clientIp, req.user.username, 'EXEC_SHELL_ERROR', { command: cleanCmd, error: err.message }, false);
      return res.status(500).json({ error: err.message });
    }
  }

  // Execute on remote machine via SSH
  const machine = machineService.getById(targetId);
  if (!machine) return res.status(404).json({ error: 'Machine cible introuvable' });

  try {
    const result = await sshManager.execCommand(targetId, cleanCmd, timeLimit);
    audit.logAction(clientIp, req.user.username, 'EXEC_SHELL_FINISHED', { 
      command: cleanCmd, 
      exitCode: result.exitCode, 
      machineId: targetId,
      durationMs: result.durationMs 
    }, result.exitCode === 0);

    res.json(result);
  } catch (err) {
    audit.logAction(clientIp, req.user.username, 'EXEC_SHELL_ERROR', { command: cleanCmd, machineId: targetId, error: err.message }, false);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
