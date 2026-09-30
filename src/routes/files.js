const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { verifySensitiveAction } = require('../middleware/sensitiveAuth');
const audit = require('../services/audit');
const config = require('../config');

// Configure multer storage for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const destDir = req.query.path || os.homedir();
    cb(null, path.resolve(destDir));
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// List files in directory
router.get('/list', authenticateToken, async (req, res) => {
  const reqPath = req.query.path ? path.resolve(req.query.path) : (config.isWindows ? 'C:\\' : '/');

  try {
    const stats = await fs.promises.stat(reqPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Le chemin spécifié n\'est pas un répertoire' });
    }

    const entries = await fs.promises.readdir(reqPath, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(reqPath, entry.name);
        try {
          const itemStat = await fs.promises.stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: itemStat.size,
            mtime: itemStat.mtime,
            permissions: (itemStat.mode & 0o777).toString(8)
          };
        } catch (e) {
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: 0,
            error: 'Inaccessible'
          };
        }
      })
    );

    // Sort folders first, then alphabetically
    items.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    });

    res.json({
      currentPath: reqPath,
      parentPath: path.dirname(reqPath),
      items
    });
  } catch (err) {
    res.status(500).json({ error: `Erreur d'accès au répertoire: ${err.message}` });
  }
});

// Read text file (e.g. logs, configs)
router.get('/read', authenticateToken, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Chemin requis' });

  const resolved = path.resolve(filePath);

  try {
    const stat = await fs.promises.stat(resolved);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Ceci est un dossier, impossible de lire comme texte' });
    }

    // Limit to 2 MB to avoid memory exhaustion
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(400).json({ 
        error: `Fichier trop volumineux (${(stat.size / 1024 / 1024).toFixed(2)} MB). Utilisez le téléchargement direct.` 
      });
    }

    const content = await fs.promises.readFile(resolved, 'utf8');
    res.json({
      path: resolved,
      size: stat.size,
      mtime: stat.mtime,
      content
    });
  } catch (err) {
    res.status(500).json({ error: `Impossible de lire le fichier: ${err.message}` });
  }
});

// Download file
router.get('/download', authenticateToken, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send('Chemin manquant');

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return res.status(404).send('Fichier introuvable');
  }

  audit.logAction(req.ip, req.user.username, 'FILE_DOWNLOAD', { file: resolved });
  res.download(resolved);
});

// Upload file
router.post('/upload', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier transmis' });
  }

  audit.logAction(req.ip, req.user.username, 'FILE_UPLOAD', { file: req.file.path, size: req.file.size });
  res.json({
    success: true,
    message: 'Fichier téléversé avec succès',
    filename: req.file.originalname,
    path: req.file.path,
    size: req.file.size
  });
});

// Delete file or folder (Sensitive Action: requires password!)
router.delete('/delete', authenticateToken, verifySensitiveAction, async (req, res) => {
  const targetPath = req.query.path;
  if (!targetPath) return res.status(400).json({ error: 'Chemin requis' });

  const resolved = path.resolve(targetPath);
  audit.logAction(req.ip, req.user.username, 'FILE_DELETE_REQUEST', { path: resolved });

  try {
    const stat = await fs.promises.stat(resolved);
    if (stat.isDirectory()) {
      await fs.promises.rm(resolved, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(resolved);
    }

    audit.logAction(req.ip, req.user.username, 'FILE_DELETE_SUCCESS', { path: resolved });
    res.json({ success: true, message: `Élément supprimé: ${resolved}` });
  } catch (err) {
    audit.logAction(req.ip, req.user.username, 'FILE_DELETE_FAILED', { path: resolved, error: err.message }, false);
    res.status(500).json({ error: `Erreur lors de la suppression: ${err.message}` });
  }
});

module.exports = router;
