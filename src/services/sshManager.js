const { Client } = require('ssh2');
const machineService = require('./machines');

class SshManager {
  constructor() {
    this.activeShellSessions = new Map();
  }

  // Connect helper
  createClient(machine) {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      const config = {
        host: machine.host,
        port: machine.port || 22,
        username: machine.username || 'root',
        readyTimeout: 10000
      };

      if (machine.authType === 'key' && machine.privateKey) {
        config.privateKey = machine.privateKey;
      } else if (machine.password) {
        config.password = machine.password;
      }

      conn.on('ready', () => resolve(conn));
      conn.on('error', (err) => reject(err));
      conn.connect(config);
    });
  }

  // Execute a single command on remote machine
  async execCommand(machineId, command, timeout = 30000) {
    const machine = machineService.getById(machineId);
    if (!machine) {
      throw new Error(`Machine ${machineId} introuvable`);
    }

    const startTime = Date.now();
    let conn;

    try {
      conn = await this.createClient(machine);
    } catch (err) {
      return {
        command,
        stdout: '',
        stderr: `Échec de connexion SSH à ${machine.host}:${machine.port || 22} - ${err.message}`,
        exitCode: 1,
        durationMs: Date.now() - startTime
      };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timer = null;

      timer = setTimeout(() => {
        try { conn.end(); } catch (e) {}
        resolve({
          command,
          stdout,
          stderr: stderr + '\n[Délai d\'attente dépassé (timeout)]',
          exitCode: 124,
          durationMs: Date.now() - startTime
        });
      }, timeout);

      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          return resolve({
            command,
            stdout: '',
            stderr: err.message,
            exitCode: 1,
            durationMs: Date.now() - startTime
          });
        }

        stream.on('close', (code, signal) => {
          clearTimeout(timer);
          conn.end();
          resolve({
            command,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code !== undefined ? code : 0,
            durationMs: Date.now() - startTime
          });
        });

        stream.on('data', (data) => {
          stdout += data.toString('utf8');
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString('utf8');
        });
      });
    });
  }

  // Create an interactive SSH shell session for xterm.js
  async createShellSession(sessionId, machineId, options = {}) {
    const machine = machineService.getById(machineId);
    if (!machine) {
      throw new Error(`Machine ${machineId} introuvable`);
    }

    const conn = await this.createClient(machine);
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    return new Promise((resolve, reject) => {
      conn.shell({
        term: 'xterm-256color',
        cols,
        rows
      }, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        const session = {
          sessionId,
          machineId,
          conn,
          stream
        };

        this.activeShellSessions.set(sessionId, session);
        resolve(session);
      });
    });
  }

  writeShell(sessionId, data) {
    const session = this.activeShellSessions.get(sessionId);
    if (session && session.stream) {
      session.stream.write(data);
    }
  }

  resizeShell(sessionId, cols, rows) {
    const session = this.activeShellSessions.get(sessionId);
    if (session && session.stream && session.stream.setWindow) {
      session.stream.setWindow(rows, cols, 0, 0);
    }
  }

  closeShell(sessionId) {
    const session = this.activeShellSessions.get(sessionId);
    if (session) {
      try {
        if (session.stream) session.stream.end();
        if (session.conn) session.conn.end();
      } catch (e) {}
      this.activeShellSessions.delete(sessionId);
    }
  }

  // Collect remote metrics via lightweight bash commands
  async getRemoteMetrics(machineId) {
    const script = `
      echo "---START---"
      uptime
      echo "---MEM---"
      free -b || free -m
      echo "---DF---"
      df -kP
      echo "---LOAD---"
      cat /proc/loadavg 2>/dev/null || uptime
      echo "---OS---"
      cat /etc/os-release 2>/dev/null || uname -a
    `;

    const res = await this.execCommand(machineId, script, 8000);
    if (res.exitCode !== 0) {
      throw new Error(`Échec de récupération métriques: ${res.stderr || 'Hôte injoignable'}`);
    }

    return this.parseRemoteOutput(res.stdout);
  }

  parseRemoteOutput(output) {
    const sections = {};
    const lines = output.split('\n');
    let currentSection = 'header';

    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('---') && trimmed.endsWith('---')) {
        currentSection = trimmed.replace(/---/g, '').toLowerCase();
        sections[currentSection] = [];
      } else if (sections[currentSection]) {
        sections[currentSection].push(line);
      }
    });

    // Parse load / CPU
    let cpuPercent = 0;
    if (sections.load && sections.load[0]) {
      const loadParts = sections.load[0].trim().split(/\s+/);
      const oneMinLoad = parseFloat(loadParts[0]) || 0;
      cpuPercent = Math.min(Math.round(oneMinLoad * 25 * 10) / 10, 100);
    }

    // Parse Memory
    let totalMem = 0;
    let usedMem = 0;
    let memPercent = 0;
    if (sections.mem) {
      sections.mem.forEach(mLine => {
        if (mLine.startsWith('Mem:')) {
          const parts = mLine.trim().split(/\s+/);
          totalMem = parseInt(parts[1], 10) || 1;
          const available = parseInt(parts[6], 10) || parseInt(parts[3], 10) || 0;
          usedMem = totalMem - available;
          memPercent = Math.round((usedMem / totalMem) * 1000) / 10;
        }
      });
    }

    // Parse Disk
    const disks = [];
    if (sections.df) {
      sections.df.slice(1).forEach(dLine => {
        const parts = dLine.trim().split(/\s+/);
        if (parts.length >= 6 && parts[0].startsWith('/dev/')) {
          const sizeKb = parseInt(parts[1], 10) || 0;
          const usedKb = parseInt(parts[2], 10) || 0;
          const usePct = parseInt((parts[4] || '0').replace('%', ''), 10) || 0;
          disks.push({
            fs: parts[0],
            size: sizeKb * 1024,
            used: usedKb * 1024,
            use: usePct,
            mount: parts[5]
          });
        }
      });
    }

    // Parse OS
    let distro = 'Linux';
    if (sections.os) {
      sections.os.forEach(oLine => {
        if (oLine.startsWith('PRETTY_NAME=')) {
          distro = oLine.split('=')[1].replace(/"/g, '');
        }
      });
    }

    return {
      timestamp: Date.now(),
      distro,
      cpu: { usagePercent: cpuPercent },
      memory: { total: totalMem, used: usedMem, usagePercent: memPercent },
      disks,
      network: { rxSec: 0, txSec: 0 },
      uptime: 0
    };
  }
}

module.exports = new SshManager();
