const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');
const audit = require('../services/audit');

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }

  const userMatches = (username || '').trim().toLowerCase() === (config.adminUsername || '').trim().toLowerCase();
  const passMatches = bcrypt.compareSync(password, config.adminPasswordHash);

  if (!userMatches || !passMatches) {
    audit.logAction(clientIp, username, 'AUTH_LOGIN_FAILED', { reason: 'Identifiants invalides' }, false);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  // Create JWT token
  const token = jwt.sign(
    { username: config.adminUsername, role: 'admin' },
    config.jwtSecret,
    { expiresIn: config.sessionTimeout }
  );

  // Set HTTP-only cookie as well for convenience
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false, // can be true when running behind HTTPS
    maxAge: 24 * 60 * 60 * 1000
  });

  audit.logAction(clientIp, username, 'AUTH_LOGIN_SUCCESS');

  res.json({
    success: true,
    token,
    user: {
      username: config.adminUsername,
      role: 'admin'
    }
  });
});

// Current session status
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: req.user,
    serverPlatform: process.platform,
    hostname: require('os').hostname()
  });
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Déconnecté avec succès' });
});

// Change password
router.post('/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const clientIp = req.ip;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit comporter au moins 8 caractères' });
  }

  if (!bcrypt.compareSync(currentPassword, config.adminPasswordHash)) {
    audit.logAction(clientIp, req.user.username, 'PASSWORD_CHANGE_FAILED', { reason: 'Mot de passe actuel incorrect' }, false);
    return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  }

  config.adminPasswordHash = bcrypt.hashSync(newPassword, 10);
  audit.logAction(clientIp, req.user.username, 'PASSWORD_CHANGE_SUCCESS');

  res.json({ success: true, message: 'Mot de passe mis à jour avec succès' });
});

module.exports = router;
