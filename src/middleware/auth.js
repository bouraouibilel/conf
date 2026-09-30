const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticateToken(req, res, next) {
  let token = null;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Accès non autorisé: jeton manquant' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Jeton invalide ou expiré' });
  }
}

function verifyWsToken(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let token = url.searchParams.get('token');

    if (!token && req.headers.cookie) {
      const cookies = Object.fromEntries(
        req.headers.cookie.split(';').map(c => {
          const [k, ...v] = c.trim().split('=');
          return [k, v.join('=')];
        })
      );
      token = cookies.token;
    }

    if (!token) return null;
    return jwt.verify(token, config.jwtSecret);
  } catch (e) {
    return null;
  }
}

module.exports = {
  authenticateToken,
  verifyWsToken
};
