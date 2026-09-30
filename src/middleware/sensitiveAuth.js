const bcrypt = require('bcryptjs');
const config = require('../config');
const audit = require('../services/audit');

function verifySensitiveAction(req, res, next) {
  const confirmPassword = req.body?.confirmPassword || req.query?.confirmPassword || req.headers['x-confirm-password'];
  const clientIp = req.ip || req.connection.remoteAddress;
  const username = req.user?.username || config.adminUsername;

  if (!confirmPassword) {
    audit.logAction(clientIp, username, 'SENSITIVE_AUTH_MISSING_PASSWORD', { path: req.originalUrl }, false);
    return res.status(403).json({
      error: 'Mot de passe requis pour confirmer cette action sensible.'
    });
  }

  const isValid = bcrypt.compareSync(confirmPassword, config.adminPasswordHash);
  if (!isValid) {
    audit.logAction(clientIp, username, 'SENSITIVE_AUTH_FAILED', { path: req.originalUrl }, false);
    return res.status(403).json({
      error: 'Mot de passe administrateur incorrect. Action sensible refusée.'
    });
  }

  audit.logAction(clientIp, username, 'SENSITIVE_AUTH_SUCCESS', { path: req.originalUrl });
  next();
}

module.exports = {
  verifySensitiveAction
};
