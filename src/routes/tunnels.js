const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { verifySensitiveAction } = require('../middleware/sensitiveAuth');
const tunnelService = require('../services/tunnels');
const sshManager = require('../services/sshManager');
const audit = require('../services/audit');

// List tunnels (including auto-discovered systemd tunnels)
router.get('/', authenticateToken, async (req, res) => {
  const machineId = req.query.machineId || null;
  const list = await tunnelService.getAll(machineId);
  res.json(list);
});

// Start Cloudflare Tunnel
router.post('/cloudflare', authenticateToken, async (req, res) => {
  const { name, localPort, machineId, token, protocol } = req.body;
  if (!localPort) {
    return res.status(400).json({ error: 'Port local requis' });
  }

  try {
    const entry = await tunnelService.startCloudflare({
      name,
      localPort,
      machineId: machineId || 'local',
      token,
      protocol
    });

    audit.logAction(req.ip, req.user.username, 'CLOUDFLARE_TUNNEL_STARTED', {
      tunnelId: entry.id,
      localPort,
      machineId: entry.machineId
    });

    res.json({ success: true, tunnel: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start AutoSSH Reverse Tunnel
router.post('/autossh', authenticateToken, async (req, res) => {
  const { name, localPort, remotePort, vpsHost, vpsPort, vpsUser, machineId, bindAll } = req.body;

  if (!localPort || !remotePort || !vpsHost) {
    return res.status(400).json({ error: 'Port local, port distant VPS et hôte VPS requis' });
  }

  try {
    const entry = await tunnelService.startAutoSsh({
      name,
      localPort,
      remotePort,
      vpsHost,
      vpsPort: vpsPort || 22,
      vpsUser: vpsUser || 'root',
      machineId: machineId || 'local',
      bindAll: bindAll !== false
    });

    audit.logAction(req.ip, req.user.username, 'AUTOSSH_TUNNEL_STARTED', {
      tunnelId: entry.id,
      localPort,
      remotePort,
      vpsHost,
      machineId: entry.machineId
    });

    res.json({ success: true, tunnel: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop Tunnel
router.post('/:id/stop', authenticateToken, async (req, res) => {
  try {
    const result = await tunnelService.stop(req.params.id);
    audit.logAction(req.ip, req.user.username, 'TUNNEL_STOPPED', { tunnelId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Tunnel (Sensitive action: requires password)
router.delete('/:id', authenticateToken, verifySensitiveAction, async (req, res) => {
  try {
    const ok = await tunnelService.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Tunnel introuvable' });

    audit.logAction(req.ip, req.user.username, 'TUNNEL_DELETED', { tunnelId: req.params.id });
    res.json({ success: true, message: 'Tunnel supprimé avec succès' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Tunnel Logs
router.get('/:id/logs', authenticateToken, async (req, res) => {
  try {
    const logs = await tunnelService.getLogs(req.params.id);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restart Tunnel (or systemd service)
router.post('/:id/restart', authenticateToken, async (req, res) => {
  try {
    const result = await tunnelService.restart(req.params.id);
    res.json({ success: true, message: 'Tunnel redémarré', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Generated or Current Systemd Service
router.get('/:id/systemd', authenticateToken, async (req, res) => {
  try {
    const serviceContent = await tunnelService.generateSystemdService(req.params.id);
    res.json({ content: serviceContent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Install Systemd Service automatically on remote Linux machine
router.post('/:id/install-systemd', authenticateToken, verifySensitiveAction, async (req, res) => {
  const tunnel = tunnelService.getById(req.params.id);
  if (!tunnel) return res.status(404).json({ error: 'Tunnel introuvable' });

  if (tunnel.machineId === 'local' && process.platform !== 'linux') {
    return res.status(400).json({ error: 'Systemd n\'est disponible que sur les environnements Linux' });
  }

  const serviceName = `tunnel-${tunnel.type}-${tunnel.id}.service`;
  const serviceContent = tunnelService.generateSystemdService(req.params.id);

  try {
    if (tunnel.machineId === 'local') {
      const fs = require('fs');
      fs.writeFileSync(`/etc/systemd/system/${serviceName}`, serviceContent, 'utf8');
      const { runExec } = require('../utils/execHelper');
      await runExec(`sudo systemctl daemon-reload && sudo systemctl enable --now ${serviceName}`);
    } else {
      // Remote install via SSH
      const b64 = Buffer.from(serviceContent).toString('base64');
      const cmd = `echo "${b64}" | base64 -d | sudo tee /etc/systemd/system/${serviceName} > /dev/null && sudo systemctl daemon-reload && sudo systemctl enable --now ${serviceName}`;
      const execRes = await sshManager.execCommand(tunnel.machineId, cmd, 8000);
      if (execRes.exitCode !== 0) {
        throw new Error(`Échec de configuration systemd: ${execRes.stderr}`);
      }
    }

    audit.logAction(req.ip, req.user.username, 'TUNNEL_SYSTEMD_INSTALLED', { tunnelId: tunnel.id, serviceName });
    res.json({
      success: true,
      serviceName,
      message: `Service systemd "${serviceName}" installé et démarré avec succès au boot !`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
