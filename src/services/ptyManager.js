const pty = require('node-pty');
const config = require('../config');
const audit = require('./audit');

class PtyManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(id, options = {}) {
    const shell = config.shell;
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const cwd = options.cwd || process.env.HOME || process.env.USERPROFILE || process.cwd();

    // Default environment with UTF-8 support and 256 color terminal
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'en_US.UTF-8'
    };

    let ptyProcess;
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env
      });
    } catch (err) {
      console.error('Failed to spawn PTY:', err);
      throw err;
    }

    const session = {
      id,
      pty: ptyProcess,
      createdAt: Date.now()
    };

    this.sessions.set(id, session);
    return session;
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  write(id, data) {
    const session = this.sessions.get(id);
    if (session && session.pty) {
      session.pty.write(data);
    }
  }

  resize(id, cols, rows) {
    const session = this.sessions.get(id);
    if (session && session.pty && cols && rows) {
      try {
        session.pty.resize(cols, rows);
      } catch (err) {
        console.error('PTY resize error:', err.message);
      }
    }
  }

  closeSession(id) {
    const session = this.sessions.get(id);
    if (session) {
      try {
        if (session.pty) {
          session.pty.kill();
        }
      } catch (err) {
        // ignore already dead process
      }
      this.sessions.delete(id);
    }
  }
}

module.exports = new PtyManager();
