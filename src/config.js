const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Load environment variables from .env if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

// Generate default credentials if none provided
const DEFAULT_PORT = process.env.PORT || 4000;
const DEFAULT_HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Admin credentials
let adminUsername = process.env.ADMIN_USER || 'admin';
let adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

// If a plaintext password was specified in .env, hash it
if (!adminPasswordHash && process.env.ADMIN_PASSWORD) {
  adminPasswordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
}

// If neither is specified, generate a random temporary password and print to console
let generatedPassword = null;
if (!adminPasswordHash) {
  const tempPass = crypto.randomBytes(6).toString('hex'); // 12 characters
  adminPasswordHash = bcrypt.hashSync(tempPass, 10);
  generatedPassword = tempPass;
}

const config = {
  port: parseInt(DEFAULT_PORT, 10),
  host: DEFAULT_HOST,
  jwtSecret: JWT_SECRET,
  adminUsername,
  adminPasswordHash,
  generatedPassword,
  sessionTimeout: process.env.SESSION_TIMEOUT || '24h',
  shell: process.platform === 'win32' 
    ? (process.env.COMSPEC || 'powershell.exe')
    : (process.env.SHELL || '/bin/bash'),
  isLinux: process.platform === 'linux',
  isWindows: process.platform === 'win32',
  allowFileExplorer: process.env.ALLOW_FILE_EXPLORER !== 'false',
  storagePath: path.join(__dirname, '..', 'data')
};

// Ensure data folder exists
if (!fs.existsSync(config.storagePath)) {
  fs.mkdirSync(config.storagePath, { recursive: true });
}

module.exports = config;
