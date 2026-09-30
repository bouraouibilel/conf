const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { verifySensitiveAction } = require('../middleware/sensitiveAuth');
const machineService = require('../services/machines');
const sshManager = require('../services/sshManager');
const { sendWakeOnLan } = require('../services/wol');
const audit = require('../services/audit');

// List all machines
router.get('/', authenticateToken, (req, res) => {
  const machines = machineService.getAll();
  res.json(machines);
});

// Get machine details
router.get('/:id', authenticateToken, (req, res) => {
  const m = machineService.getById(req.params.id);
  if (!m) return res.status(404).json({ error: 'Machine introuvable' });
  res.json(m);
});

// Add new machine
router.post('/', authenticateToken, (req, res) => {
  const { name, host, port, username, authType, password, privateKey, macAddress, description } = req.body;
  if (!host) {
    return res.status(400).json({ error: 'L\'adresse IP ou nom d\'hôte est requis' });
  }

  const newMachine = machineService.add({
    name: name || host,
    host,
    port: port || 22,
    username: username || 'root',
    authType: authType || 'password',
    password,
    privateKey,
    macAddress,
    description
  });

  audit.logAction(req.ip, req.user.username, 'MACHINE_ADDED', { name: newMachine.name, host: newMachine.host });
  res.json({ success: true, machine: newMachine });
});

// Update machine
router.put('/:id', authenticateToken, (req, res) => {
  if (req.params.id === 'local') {
    return res.status(400).json({ error: 'Impossible de modifier la machine locale' });
  }

  const updated = machineService.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Machine introuvable' });

  audit.logAction(req.ip, req.user.username, 'MACHINE_UPDATED', { id: req.params.id });
  res.json({ success: true, machine: updated });
});

// Delete machine (Sensitive Action: requires password!)
router.delete('/:id', authenticateToken, verifySensitiveAction, (req, res) => {
  if (req.params.id === 'local') {
    return res.status(400).json({ error: 'Impossible de supprimer la machine locale' });
  }

  const ok = machineService.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Machine introuvable' });

  audit.logAction(req.ip, req.user.username, 'MACHINE_DELETED', { id: req.params.id });
  res.json({ success: true, message: 'Machine retirée de l\'inventaire' });
});

// Test connection
router.post('/:id/test', authenticateToken, async (req, res) => {
  const machine = machineService.getById(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Machine introuvable' });

  if (machine.id === 'local') {
    return res.json({ success: true, message: 'Hôte local opérationnel' });
  }

  try {
    const isPortOpen = await machineService.checkPort(machine.host, machine.port || 22, 4000);
    if (!isPortOpen) {
      return res.status(503).json({
        success: false,
        error: `Port ${machine.port || 22} injoignable sur ${machine.host}. Vérifiez l'adresse et le pare-feu.`
      });
    }

    // Try full SSH authentication check
    const execRes = await sshManager.execCommand(machine.id, 'echo "SSH_OK"', 5000);
    if (execRes.exitCode === 0) {
      return res.json({
        success: true,
        message: `Connexion SSH réussie avec succès vers ${machine.host} !`
      });
    } else {
      return res.status(401).json({
        success: false,
        error: `Port SSH ouvert mais échec d'authentification: ${execRes.stderr || 'Identifiants invalides'}`
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Wake-on-LAN
router.post('/:id/wake', authenticateToken, async (req, res) => {
  const machine = machineService.getById(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Machine introuvable' });

  if (!machine.macAddress) {
    return res.status(400).json({ error: 'Adresse MAC requise pour le Wake-on-LAN' });
  }

  try {
    const result = await sendWakeOnLan(machine.macAddress);
    audit.logAction(req.ip, req.user.username, 'WOL_PACKET_SENT', { machine: machine.name, mac: machine.macAddress });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
