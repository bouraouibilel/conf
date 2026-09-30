// Live Metrics & Dashboard manager
const Dashboard = {
  ws: null,
  pollTimer: null,

  async init() {
    await this.loadStaticInfo();
    await this.loadProcesses();
    this.startMetricsStream();
  },

  async loadStaticInfo() {
    const machineId = Machines.currentMachineId;
    try {
      const res = await Auth.request(`/api/system/info?machineId=${encodeURIComponent(machineId)}`);
      if (!res.ok) return;
      const info = await res.json();

      document.getElementById('info-hostname').textContent = info.hostname || '-';
      document.getElementById('info-distro').textContent = `${info.distro || ''} ${info.release || ''}`.trim() || info.platform;
      document.getElementById('info-cpu').textContent = `${info.cpuModel} (${info.cpuCores} cœurs, ${info.cpuThreads} threads)`;
      document.getElementById('info-arch').textContent = `${info.arch} / ${info.kernel || '-'}`;
    } catch (err) {
      console.error('Failed to load static info:', err);
    }
  },

  startMetricsStream() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    const token = Auth.getToken();
    const machineId = Machines.currentMachineId;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/metrics?token=${encodeURIComponent(token)}&machineId=${encodeURIComponent(machineId)}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'metrics') {
            this.updateMetricsUI(msg.data);
          }
        } catch (e) {}
      };

      this.ws.onerror = () => {
        this.fallbackPolling();
      };
      this.ws.onclose = () => {
        this.fallbackPolling();
      };
    } catch (e) {
      this.fallbackPolling();
    }
  },

  fallbackPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      const machineId = Machines.currentMachineId;
      try {
        const res = await Auth.request(`/api/system/metrics?machineId=${encodeURIComponent(machineId)}`);
        if (res.ok) {
          const data = await res.json();
          this.updateMetricsUI(data);
        }
      } catch (e) {}
    }, 3000);
  },

  updateMetricsUI(data) {
    if (!data) return;

    // CPU
    const cpuVal = data.cpu ? data.cpu.usagePercent : 0;
    document.getElementById('metric-cpu-val').textContent = `${cpuVal}%`;
    const cpuBar = document.getElementById('metric-cpu-bar');
    cpuBar.style.width = `${Math.min(cpuVal, 100)}%`;
    cpuBar.className = 'progress-bar-fill' + (cpuVal > 85 ? ' danger' : cpuVal > 60 ? ' warning' : '');

    // Memory
    const mem = data.memory || { used: 0, total: 1, usagePercent: 0 };
    const usedGb = (mem.used / 1024 / 1024 / 1024).toFixed(1);
    const totalGb = (mem.total / 1024 / 1024 / 1024).toFixed(1);
    document.getElementById('metric-mem-val').textContent = `${mem.usagePercent}%`;
    document.getElementById('metric-mem-sub').textContent = `${usedGb} GB / ${totalGb} GB`;
    const memBar = document.getElementById('metric-mem-bar');
    memBar.style.width = `${Math.min(mem.usagePercent, 100)}%`;
    memBar.className = 'progress-bar-fill' + (mem.usagePercent > 85 ? ' danger' : mem.usagePercent > 70 ? ' warning' : '');

    // Network
    const rxKb = Math.round((data.network?.rxSec || 0) / 1024);
    const txKb = Math.round((data.network?.txSec || 0) / 1024);
    document.getElementById('metric-net-val').textContent = `↓ ${rxKb} KB/s`;
    document.getElementById('metric-net-sub').textContent = `↑ ${txKb} KB/s`;

    // Uptime
    const uptimeSec = data.uptime || 0;
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    document.getElementById('metric-uptime-val').textContent = uptimeSec ? `${days}j ${hours}h ${minutes}m` : 'En ligne';

    // Disks
    const diskContainer = document.getElementById('disks-container');
    if (diskContainer && data.disks && data.disks.length) {
      diskContainer.innerHTML = data.disks.map(d => {
        const usedGb = (d.used / 1024 / 1024 / 1024).toFixed(1);
        const totalGb = (d.size / 1024 / 1024 / 1024).toFixed(1);
        const pct = Math.round(d.use);
        return `
          <div style="margin-bottom: 0.85rem;">
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:0.25rem;">
              <span><strong>${d.mount || d.fs}</strong></span>
              <span style="color:var(--text-secondary);">${usedGb} GB / ${totalGb} GB (${pct}%)</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill ${pct > 90 ? 'danger' : pct > 75 ? 'warning' : ''}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  },

  async loadProcesses() {
    const machineId = Machines.currentMachineId;
    try {
      const res = await Auth.request(`/api/system/processes?machineId=${encodeURIComponent(machineId)}&limit=15`);
      if (!res.ok) return;
      const data = await res.json();
      const tbody = document.getElementById('process-table-body');
      if (!tbody) return;

      tbody.innerHTML = (data.list || []).map(p => `
        <tr>
          <td><code>${p.pid}</code></td>
          <td><strong>${this.escapeHtml(p.name)}</strong></td>
          <td><span style="color: ${p.cpu > 50 ? '#f85149' : 'inherit'}">${p.cpu}%</span></td>
          <td>${p.mem}%</td>
          <td><span style="color:var(--text-secondary);">${p.user || '-'}</span></td>
          <td>
            <button class="btn btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="Dashboard.promptKillProcess(${p.pid}, '${this.escapeHtml(p.name)}')">
              Terminer
            </button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('Failed to load processes:', e);
    }
  },

  // Sensitive process kill prompt
  promptKillProcess(pid, name) {
    const machineId = Machines.currentMachineId;
    App.showSensitiveActionModal(
      `Arrêt forcé de processus : ${name} (PID: ${pid})`,
      `Attention : Forcer l'arrêt du processus ${name} (${pid}) sur la machine active peut entraîner la perte de données non enregistrées.`,
      async (confirmPassword) => {
        const res = await Auth.request('/api/system/processes/kill', {
          method: 'POST',
          body: JSON.stringify({ pid, signal: 'SIGTERM', machineId, confirmPassword })
        });
        const data = await res.json();
        if (res.ok) {
          App.notify('Processus arrêté', data.message, 'success');
          this.loadProcesses();
        } else {
          throw new Error(data.error || 'Impossible d\'arrêter le processus');
        }
      },
      'Confirmer l\'arrêt forcé'
    );
  },

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }
};
