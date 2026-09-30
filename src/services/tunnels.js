const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const machineService = require('./machines');
const sshManager = require('./sshManager');
const audit = require('./audit');

const tunnelsFile = path.join(config.storagePath, 'tunnels.json');

class TunnelService {
  constructor() {
    this.tunnels = [];
    this.activeProcesses = new Map(); // id -> { process, logs: [], publicUrl: null }
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(tunnelsFile)) {
        const raw = fs.readFileSync(tunnelsFile, 'utf8');
        this.tunnels = JSON.parse(raw);
      }
    } catch (e) {
      console.error('Failed to load tunnels.json:', e.message);
      this.tunnels = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(tunnelsFile, JSON.stringify(this.tunnels, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save tunnels.json:', e.message);
    }
  }

  async getAll(machineId = null) {
    const list = this.tunnels.map(t => {
      const active = this.activeProcesses.get(t.id);
      return {
        ...t,
        isRunning: !!active || t.status === 'active',
        publicUrl: active?.publicUrl || t.publicUrl || null,
        pid: active?.process?.pid || null
      };
    });

    // Auto-discover systemd tunnels on the requested machine(s)
    let systemdTunnels = [];
    try {
      const targetMachines = machineId 
        ? [machineId] 
        : machineService.getAll().map(m => m.id);

      for (const mId of targetMachines) {
        const discovered = await this.discoverSystemdTunnels(mId);
        systemdTunnels.push(...discovered);
      }
    } catch (err) {
      console.error('Systemd tunnel auto-discovery error:', err.message);
    }

    return [...list, ...systemdTunnels];
  }

  // Auto-discover any autossh or cloudflared services already running or installed in systemd
  async discoverSystemdTunnels(machineId = 'local') {
    if (machineId === 'local' && process.platform !== 'linux') {
      return [];
    }

    // Query systemctl for any unit matching autossh, cloudflared, or tunnel
    const scanCmd = 'systemctl list-units --type=service --all --no-legend --no-pager "*autossh*" "*cloudflared*" "*tunnel*" 2>/dev/null || systemctl list-unit-files --type=service --no-legend --no-pager "*autossh*" "*cloudflared*" "*tunnel*" 2>/dev/null';

    let output = '';
    try {
      if (machineId === 'local') {
        const { runExec } = require('../utils/execHelper');
        const res = await runExec(scanCmd, { timeout: 4000 });
        output = res.stdout;
      } else {
        const res = await sshManager.execCommand(machineId, scanCmd, 5000);
        output = res.stdout;
      }
    } catch (e) {
      return [];
    }

    const lines = output.split('\n').filter(Boolean);
    const discovered = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const serviceName = parts[0];
      if (!serviceName || !serviceName.includes('.service')) continue;

      const isRunning = line.includes('running') || line.includes(' active ');
      const isFailed = line.includes('failed');
      const isAutoSsh = serviceName.toLowerCase().includes('autossh');
      const isCf = serviceName.toLowerCase().includes('cloudflared') || serviceName.toLowerCase().includes('cloudflare');

      // Fetch ExecStart to parse ports and host
      let execStart = '';
      try {
        const showCmd = `systemctl show ${serviceName} --property=ExecStart --value 2>/dev/null`;
        const resShow = machineId === 'local' 
          ? await require('../utils/execHelper').runExec(showCmd, { timeout: 2500 })
          : await sshManager.execCommand(machineId, showCmd, 2500);
        execStart = resShow.stdout || '';
      } catch (e) {}

      // Extract ports and host for AutoSSH
      let localPort = 'Inconnu';
      let remotePort = 'Inconnu';
      let vpsHost = '';
      let publicUrl = null;

      if (isAutoSsh) {
        // 1. Check template unit instance pattern (e.g. autossh@11434:192.168.1.29:11434)
        const instMatch = serviceName.match(/autossh@([0-9]+):([^:]+):([0-9]+)/);
        if (instMatch) {
          remotePort = instMatch[1];
          localPort = `${instMatch[2]}:${instMatch[3]}`;
        }

        // 2. Check ExecStart for -R and host
        const rMatch = execStart.match(/-R\s+(?:[0-9.]+:)?([0-9]+):([a-zA-Z0-9_.-]+):([0-9]+)/);
        if (rMatch) {
          remotePort = rMatch[1];
          localPort = `${rMatch[2]}:${rMatch[3]}`;
        }
        const hostMatch = execStart.match(/([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)/);
        if (hostMatch) {
          vpsHost = hostMatch[2];
        }

        if (vpsHost && remotePort !== 'Inconnu') {
          publicUrl = `${vpsHost}:${remotePort}`;
        } else if (remotePort !== 'Inconnu') {
          publicUrl = `:${remotePort}`;
        }
      } else if (isCf) {
        const urlMatch = execStart.match(/--url\s+([a-zA-Z0-9:/._-]+)/);
        if (urlMatch) {
          localPort = urlMatch[1];
        }
      }

      discovered.push({
        id: `sysd_${machineId}_${serviceName}`,
        name: serviceName.replace('.service', ''),
        serviceName,
        type: isAutoSsh ? 'autossh' : isCf ? 'cloudflare' : 'tunnel',
        isSystemd: true,
        machineId,
        status: isRunning ? 'active' : isFailed ? 'failed' : 'stopped',
        localPort,
        remotePort,
        vpsHost,
        publicUrl,
        execStart
      });
    }

    return discovered;
  }

  getById(id) {
    if (id.startsWith('sysd_')) {
      const parts = id.split('_');
      const machineId = parts[1];
      const serviceName = parts.slice(2).join('_');
      return {
        id,
        name: serviceName.replace('.service', ''),
        serviceName,
        isSystemd: true,
        machineId
      };
    }
    return this.tunnels.find(t => t.id === id) || null;
  }

  // --- CLOUDFLARE TUNNEL ---

  async startCloudflare(options) {
    const { name, localPort, machineId = 'local', token = null, protocol = 'http' } = options;
    const tunnelId = `cf_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const tunnelEntry = {
      id: tunnelId,
      name: name || `Cloudflare :${localPort}`,
      type: 'cloudflare',
      localPort: parseInt(localPort, 10),
      machineId,
      token: token || null,
      protocol: protocol || 'http',
      createdAt: new Date().toISOString(),
      publicUrl: null,
      status: 'starting'
    };

    if (machineId === 'local') {
      const args = token 
        ? ['tunnel', 'run', '--token', token]
        : ['tunnel', '--url', `${protocol}://127.0.0.1:${localPort}`];

      const session = { process: null, logs: [] };
      this.activeProcesses.set(tunnelId, session);

      let proc;
      try {
        proc = spawn('cloudflared', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        throw new Error(`Impossible de lancer cloudflared: ${err.message}.`);
      }

      proc.on('error', (err) => {
        tunnelEntry.status = 'error';
        tunnelEntry.lastError = err.message;
        session.logs.push(`[Erreur]: ${err.message}\n`);
        this.activeProcesses.delete(tunnelId);
        this.save();
      });

      session.process = proc;
      const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

      const handleOutput = (data) => {
        const text = data.toString('utf8');
        session.logs.push(text);
        if (session.logs.length > 200) session.logs.shift();

        const match = text.match(urlRegex);
        if (match && !session.publicUrl) {
          session.publicUrl = match[0];
          tunnelEntry.publicUrl = match[0];
          tunnelEntry.status = 'active';
          this.save();
        }
      };

      proc.stdout.on('data', handleOutput);
      proc.stderr.on('data', handleOutput);

      proc.on('close', () => {
        tunnelEntry.status = 'stopped';
        this.activeProcesses.delete(tunnelId);
        this.save();
      });

    } else {
      const machine = machineService.getById(machineId);
      if (!machine) throw new Error('Machine distante introuvable');

      const remoteCmd = token
        ? `nohup cloudflared tunnel run --token ${token} > /tmp/cf_${tunnelId}.log 2>&1 & echo $!`
        : `nohup cloudflared tunnel --url ${protocol}://127.0.0.1:${localPort} > /tmp/cf_${tunnelId}.log 2>&1 & echo $!`;

      const res = await sshManager.execCommand(machineId, remoteCmd, 6000);
      if (res.exitCode !== 0) {
        throw new Error(`Échec démarrage cloudflared sur ${machine.name}: ${res.stderr}`);
      }

      tunnelEntry.status = 'active';
      tunnelEntry.remotePid = res.stdout.trim();
      tunnelEntry.logFile = `/tmp/cf_${tunnelId}.log`;
    }

    this.tunnels.push(tunnelEntry);
    this.save();
    return tunnelEntry;
  }

  // --- AUTOSSH REVERSE TUNNEL ---

  async startAutoSsh(options) {
    const {
      name,
      localPort,
      remotePort,
      vpsHost,
      vpsPort = 22,
      vpsUser = 'root',
      machineId = 'local',
      bindAll = true
    } = options;

    const tunnelId = `as_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const bindAddr = bindAll ? '0.0.0.0:' : '';

    const tunnelEntry = {
      id: tunnelId,
      name: name || `AutoSSH :${localPort} -> ${vpsHost}:${remotePort}`,
      type: 'autossh',
      localPort: parseInt(localPort, 10),
      remotePort: parseInt(remotePort, 10),
      vpsHost,
      vpsPort: parseInt(vpsPort, 10),
      vpsUser,
      bindAll: !!bindAll,
      machineId,
      publicUrl: `${vpsHost}:${remotePort}`,
      createdAt: new Date().toISOString(),
      status: 'active'
    };

    const sshArgs = [
      '-M', '0',
      '-N',
      '-o', 'ServerAliveInterval 30',
      '-o', 'ServerAliveCountMax 3',
      '-o', 'ExitOnForwardFailure yes',
      '-o', 'StrictHostKeyChecking=no',
      '-R', `${bindAddr}${remotePort}:127.0.0.1:${localPort}`,
      `${vpsUser}@${vpsHost}`,
      '-p', `${vpsPort}`
    ];

    if (machineId === 'local') {
      const session = { process: null, logs: [] };
      this.activeProcesses.set(tunnelId, session);

      let proc = spawn('autossh', sshArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.on('error', (err) => {
        session.logs.push(`[Erreur système]: ${err.message}\n`);
        if (err.code === 'ENOENT') {
          try {
            const fallbackProc = spawn('ssh', sshArgs.slice(2), { stdio: ['ignore', 'pipe', 'pipe'] });
            session.process = fallbackProc;

            fallbackProc.on('error', (sshErr) => {
              session.logs.push(`[Erreur ssh]: ${sshErr.message}\n`);
              tunnelEntry.status = 'error';
              tunnelEntry.lastError = 'Ni autossh ni ssh ne sont disponibles sur cette machine locale.';
              this.activeProcesses.delete(tunnelId);
              this.save();
            });

            fallbackProc.stdout.on('data', d => session.logs.push(d.toString('utf8')));
            fallbackProc.stderr.on('data', d => session.logs.push(d.toString('utf8')));
            fallbackProc.on('close', () => {
              tunnelEntry.status = 'stopped';
              this.activeProcesses.delete(tunnelId);
              this.save();
            });
            return;
          } catch (fallbackErr) {
            // ignore
          }
        }

        tunnelEntry.status = 'error';
        tunnelEntry.lastError = err.message;
        this.activeProcesses.delete(tunnelId);
        this.save();
      });

      session.process = proc;
      proc.stdout.on('data', d => session.logs.push(d.toString('utf8')));
      proc.stderr.on('data', d => session.logs.push(d.toString('utf8')));

      proc.on('close', () => {
        tunnelEntry.status = 'stopped';
        this.activeProcesses.delete(tunnelId);
        this.save();
      });
    } else {
      const remoteCmd = `nohup autossh ${sshArgs.join(' ')} > /tmp/autossh_${tunnelId}.log 2>&1 & echo $!`;
      const res = await sshManager.execCommand(machineId, remoteCmd, 6000);
      if (res.exitCode !== 0) {
        throw new Error(`Échec lancement autossh distant: ${res.stderr}`);
      }
      tunnelEntry.remotePid = res.stdout.trim();
    }

    this.tunnels.push(tunnelEntry);
    this.save();
    return tunnelEntry;
  }

  // --- RESTART / START TUNNEL ---

  async restart(tunnelId) {
    if (tunnelId.startsWith('sysd_')) {
      const tunnel = this.getById(tunnelId);
      const cmd = `sudo systemctl restart ${tunnel.serviceName}`;
      if (tunnel.machineId === 'local') {
        const { runExec } = require('../utils/execHelper');
        return await runExec(cmd);
      } else {
        return await sshManager.execCommand(tunnel.machineId, cmd);
      }
    }
  }

  // --- STOP TUNNEL ---

  async stop(tunnelId) {
    if (tunnelId.startsWith('sysd_')) {
      const tunnel = this.getById(tunnelId);
      const cmd = `sudo systemctl stop ${tunnel.serviceName}`;
      let res;
      if (tunnel.machineId === 'local') {
        const { runExec } = require('../utils/execHelper');
        res = await runExec(cmd);
      } else {
        res = await sshManager.execCommand(tunnel.machineId, cmd);
      }
      return { success: res.exitCode === 0, message: `Service ${tunnel.serviceName} arrêté.` };
    }

    const tunnel = this.getById(tunnelId);
    if (!tunnel) throw new Error('Tunnel introuvable');

    const active = this.activeProcesses.get(tunnelId);
    if (active && active.process) {
      try {
        active.process.kill();
      } catch (e) {}
      this.activeProcesses.delete(tunnelId);
    }

    if (tunnel.machineId !== 'local' && tunnel.remotePid) {
      await sshManager.execCommand(tunnel.machineId, `sudo kill -9 ${tunnel.remotePid} || kill -9 ${tunnel.remotePid}`, 4000);
    }

    tunnel.status = 'stopped';
    this.save();
    return { success: true, message: `Tunnel ${tunnel.name} arrêté.` };
  }

  // --- DELETE TUNNEL ---

  async delete(tunnelId) {
    if (tunnelId.startsWith('sysd_')) {
      // Disabling and deleting systemd unit
      const tunnel = this.getById(tunnelId);
      const cmd = `sudo systemctl disable --now ${tunnel.serviceName} && sudo rm -f /etc/systemd/system/${tunnel.serviceName} && sudo systemctl daemon-reload`;
      if (tunnel.machineId === 'local') {
        const { runExec } = require('../utils/execHelper');
        await runExec(cmd);
      } else {
        await sshManager.execCommand(tunnel.machineId, cmd);
      }
      return true;
    }

    await this.stop(tunnelId).catch(() => {});
    const index = this.tunnels.findIndex(t => t.id === tunnelId);
    if (index !== -1) {
      this.tunnels.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  // --- GET LOGS ---

  async getLogs(tunnelId) {
    if (tunnelId.startsWith('sysd_')) {
      const tunnel = this.getById(tunnelId);
      const cmd = `journalctl -u ${tunnel.serviceName} -n 100 --no-pager`;
      let res;
      if (tunnel.machineId === 'local') {
        const { runExec } = require('../utils/execHelper');
        res = await runExec(cmd, { timeout: 5000 });
      } else {
        res = await sshManager.execCommand(tunnel.machineId, cmd, 5000);
      }
      return res.stdout || res.stderr || 'Aucun log disponible pour ce service.';
    }

    const tunnel = this.getById(tunnelId);
    if (!tunnel) throw new Error('Tunnel introuvable');

    const active = this.activeProcesses.get(tunnelId);
    if (active) {
      return active.logs.join('');
    }

    if (tunnel.machineId !== 'local' && tunnel.logFile) {
      const res = await sshManager.execCommand(tunnel.machineId, `tail -n 100 ${tunnel.logFile}`, 4000);
      return res.stdout || 'Aucun log disponible';
    }

    return 'Le tunnel est arrêté ou aucun log n\'est disponible.';
  }

  // --- GENERATE SYSTEMD SERVICE TEMPLATE ---

  async generateSystemdService(tunnelId) {
    if (tunnelId.startsWith('sysd_')) {
      const tunnel = this.getById(tunnelId);
      const cmd = `systemctl cat ${tunnel.serviceName}`;
      let res;
      if (tunnel.machineId === 'local') {
        const { runExec } = require('../utils/execHelper');
        res = await runExec(cmd, { timeout: 3000 });
      } else {
        res = await sshManager.execCommand(tunnel.machineId, cmd, 3000);
      }
      return res.stdout || `# Service ${tunnel.serviceName}\n(Contenu non disponible)`;
    }

    const t = this.getById(tunnelId);
    if (!t) throw new Error('Tunnel introuvable');

    if (t.type === 'cloudflare') {
      if (t.token) {
        return `[Unit]
Description=Cloudflare Tunnel - ${t.name}
After=network.target

[Service]
Type=notify
ExecStart=/usr/bin/cloudflared tunnel run --token ${t.token}
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target`;
      } else {
        return `[Unit]
Description=Cloudflare Quick Tunnel - ${t.name}
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --url ${t.protocol || 'http'}://127.0.0.1:${t.localPort}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;
      }
    } else {
      const bind = t.bindAll ? '0.0.0.0:' : '';
      return `[Unit]
Description=AutoSSH Reverse Tunnel - ${t.name}
After=network.target

[Service]
Type=simple
User=root
Environment="AUTOSSH_GATETIME=0"
ExecStart=/usr/bin/autossh -M 0 -N -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" -o "ExitOnForwardFailure yes" -o "StrictHostKeyChecking=no" -R ${bind}${t.remotePort}:127.0.0.1:${t.localPort} ${t.vpsUser}@${t.vpsHost} -p ${t.vpsPort}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;
    }
  }
}

module.exports = new TunnelService();
