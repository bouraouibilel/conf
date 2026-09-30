const fs = require('fs');
const path = require('path');
const net = require('net');
const config = require('../config');

const machinesFile = path.join(config.storagePath, 'machines.json');

class MachineService {
  constructor() {
    this.machines = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(machinesFile)) {
        const raw = fs.readFileSync(machinesFile, 'utf8');
        this.machines = JSON.parse(raw);
      }
    } catch (e) {
      console.error('Failed to load machines.json:', e.message);
      this.machines = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(machinesFile, JSON.stringify(this.machines, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save machines.json:', e.message);
    }
  }

  getAll() {
    const localHost = {
      id: 'local',
      name: 'Serveur Principal (Local)',
      host: '127.0.0.1',
      port: config.port,
      isLocal: true,
      os: process.platform,
      username: 'système local',
      status: 'online'
    };

    const sanitizedRemote = this.machines.map(m => ({
      id: m.id,
      name: m.name,
      host: m.host,
      port: m.port || 22,
      username: m.username,
      authType: m.authType || 'password',
      hasPassword: !!m.password,
      hasPrivateKey: !!m.privateKey,
      macAddress: m.macAddress || '',
      description: m.description || '',
      isLocal: false,
      lastSeen: m.lastSeen || null
    }));

    return [localHost, ...sanitizedRemote];
  }

  getById(id) {
    if (id === 'local') {
      return {
        id: 'local',
        name: 'Serveur Principal (Local)',
        host: '127.0.0.1',
        isLocal: true,
        os: process.platform
      };
    }
    return this.machines.find(m => m.id === id) || null;
  }

  add(data) {
    const id = `mach_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newMachine = {
      id,
      name: data.name || data.host,
      host: data.host,
      port: parseInt(data.port, 10) || 22,
      username: data.username || 'root',
      authType: data.authType || 'password',
      password: data.password || '',
      privateKey: data.privateKey || '',
      macAddress: data.macAddress || '',
      description: data.description || '',
      createdAt: new Date().toISOString()
    };

    this.machines.push(newMachine);
    this.save();
    return newMachine;
  }

  update(id, data) {
    const index = this.machines.findIndex(m => m.id === id);
    if (index === -1) return null;

    const existing = this.machines[index];
    existing.name = data.name !== undefined ? data.name : existing.name;
    existing.host = data.host !== undefined ? data.host : existing.host;
    existing.port = data.port !== undefined ? parseInt(data.port, 10) : existing.port;
    existing.username = data.username !== undefined ? data.username : existing.username;
    existing.authType = data.authType !== undefined ? data.authType : existing.authType;
    existing.macAddress = data.macAddress !== undefined ? data.macAddress : existing.macAddress;
    existing.description = data.description !== undefined ? data.description : existing.description;

    if (data.password !== undefined && data.password !== '') {
      existing.password = data.password;
    }
    if (data.privateKey !== undefined && data.privateKey !== '') {
      existing.privateKey = data.privateKey;
    }

    this.save();
    return existing;
  }

  delete(id) {
    const index = this.machines.findIndex(m => m.id === id);
    if (index === -1) return false;
    this.machines.splice(index, 1);
    this.save();
    return true;
  }

  // Quick TCP reachability check
  checkPort(host, port, timeout = 3000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }
}

module.exports = new MachineService();
