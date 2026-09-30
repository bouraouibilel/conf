// System Actions: Reboot, Shutdown, Services, and Command Execution
const Actions = {
  presets: [],

  async init() {
    await this.loadPresets();
    await this.loadServices();
    await this.loadAuditLogs();
  },

  // --- REBOOT & SHUTDOWN WITH SENSITIVE PASSWORD VERIFICATION ---

  promptReboot() {
    const machineId = Machines.currentMachineId;
    const m = Machines.machines.find(x => x.id === machineId) || { name: 'Machine active' };

    App.showSensitiveActionModal(
      'Redémarrer la machine',
      `Attention : Vous demandez le redémarrage immédiat de "${m.name}". Toutes les connexions et processus actifs seront interrompus.`,
      async (confirmPassword) => {
        const res = await Auth.request('/api/system/reboot', {
          method: 'POST',
          body: JSON.stringify({ machineId, confirmPassword })
        });
        const data = await res.json();
        if (res.ok) {
          App.notify('Redémarrage déclenché', data.message, 'warning');
        } else {
          throw new Error(data.error || 'Erreur lors de la commande de redémarrage');
        }
      },
      'Confirmer le redémarrage'
    );
  },

  promptShutdown() {
    const machineId = Machines.currentMachineId;
    const m = Machines.machines.find(x => x.id === machineId) || { name: 'Machine active' };

    App.showSensitiveActionModal(
      'Arrêter la machine (Shutdown critique)',
      `Avertissement critique : Vous allez éteindre complètement la machine "${m.name}". Aucun redémarrage à distance ne sera possible sans accès physique ou Wake-on-LAN !`,
      async (confirmPassword) => {
        const res = await Auth.request('/api/system/shutdown', {
          method: 'POST',
          body: JSON.stringify({ machineId, confirmPassword })
        });
        const data = await res.json();
        if (res.ok) {
          App.notify('Arrêt en cours', data.message, 'danger');
        } else {
          throw new Error(data.error || 'Erreur lors de la commande d\'arrêt');
        }
      },
      'Confirmer l\'arrêt définitif'
    );
  },

  async cancelShutdown() {
    const machineId = Machines.currentMachineId;
    try {
      const res = await Auth.request('/api/system/cancel-shutdown', {
        method: 'POST',
        body: JSON.stringify({ machineId })
      });
      const data = await res.json();
      if (res.ok) {
        App.notify('Succès', data.message, 'success');
      } else {
        App.notify('Erreur', data.error, 'danger');
      }
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  // --- SERVICES MANAGEMENT ---

  async loadServices(search = null) {
    const machineId = Machines.currentMachineId;
    try {
      let url = `/api/services?machineId=${encodeURIComponent(machineId)}`;
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }
      const res = await Auth.request(url);
      if (!res.ok) return;
      const data = await res.json();
      const container = document.getElementById('services-list');
      if (!container) return;

      if (!data.services || data.services.length === 0) {
        container.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 1.5rem; text-align: center; color: var(--text-secondary);">
            Aucun service correspondant trouvé pour "${Dashboard.escapeHtml(search || '')}".
          </div>
        `;
        return;
      }

      container.innerHTML = data.services.map(s => {
        const isRunning = s.status === 'running' || s.status === 'active';
        const isStopped = s.status === 'stopped' || s.status === 'inactive';
        const isFailed = s.status === 'failed';
        const statusColor = isRunning ? 'green' : isFailed ? 'red' : 'yellow';

        return `
          <div class="card" style="padding: 1rem; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                <span class="dot ${statusColor}"></span>
                ${s.name}
              </div>
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.2rem;">
                Statut: <strong>${s.status}</strong>
              </div>
            </div>
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn" title="Statut" onclick="Actions.serviceAction('status', '${s.name}')">Info</button>
              ${isRunning 
                ? `<button class="btn btn-warning" onclick="Actions.promptServiceAction('restart', '${s.name}')">Redémarrer</button>
                   <button class="btn btn-danger" onclick="Actions.promptServiceAction('stop', '${s.name}')">Arrêter</button>`
                : `<button class="btn btn-success" onclick="Actions.serviceAction('start', '${s.name}')">Démarrer</button>`
              }
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('Failed to load services:', e);
    }
  },

  // Sensitive service action prompt (stop/restart require password)
  promptServiceAction(action, serviceName) {
    const actionLabel = action === 'restart' ? 'redémarrer' : 'arrêter';
    App.showSensitiveActionModal(
      `Service système : ${action.toUpperCase()} ${serviceName}`,
      `Êtes-vous certain de vouloir ${actionLabel} le service critique "${serviceName}" sur la machine active ?`,
      async (confirmPassword) => {
        await this.serviceAction(action, serviceName, confirmPassword);
      },
      `Confirmer ${actionLabel}`
    );
  },

  async serviceAction(action, serviceName, confirmPassword = null) {
    const machineId = Machines.currentMachineId;
    try {
      const res = await Auth.request('/api/services/action', {
        method: 'POST',
        body: JSON.stringify({ action, serviceName, machineId, confirmPassword })
      });
      const data = await res.json();
      if (res.ok) {
        if (action === 'status') {
          App.showModal(`Détail service : ${serviceName}`, `<pre class="console-output">${Dashboard.escapeHtml(data.stdout || data.stderr || 'Aucune sortie')}</pre>`);
        } else {
          App.notify(`Service ${serviceName}`, data.message, data.success ? 'success' : 'danger');
          setTimeout(() => this.loadServices(), 1200);
        }
      } else {
        throw new Error(data.error || 'Erreur service');
      }
    } catch (e) {
      if (confirmPassword) throw e;
      App.notify('Erreur', e.message, 'danger');
    }
  },

  async queryCustomService() {
    const input = document.getElementById('custom-service-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
      return this.loadServices();
    }
    this.loadServices(name);
  },

  // --- COMMAND RUNNER ---

  async loadPresets() {
    const machineId = Machines.currentMachineId;
    try {
      const res = await Auth.request(`/api/shell/presets?machineId=${encodeURIComponent(machineId)}`);
      if (!res.ok) return;
      this.presets = await res.json();
      const container = document.getElementById('command-presets');
      if (!container) return;

      container.innerHTML = this.presets.map(p => `
        <button class="pill-btn" onclick="Actions.selectPreset('${Dashboard.escapeHtml(p.command)}')">
          ${p.name}
        </button>
      `).join('');
    } catch (e) {
      console.error('Failed to load command presets:', e);
    }
  },

  selectPreset(command) {
    const input = document.getElementById('command-input');
    if (input) {
      input.value = command;
      input.focus();
    }
  },

  async runCommand() {
    const input = document.getElementById('command-input');
    const output = document.getElementById('command-output');
    const command = input.value.trim();
    const machineId = Machines.currentMachineId;
    if (!command) return;

    output.textContent = `[Exécution en cours sur la machine active : ${command} ...]\n`;

    try {
      const res = await Auth.request('/api/shell/exec', {
        method: 'POST',
        body: JSON.stringify({ command, machineId })
      });
      const data = await res.json();

      let text = `[Machine cible] : ${machineId}\n`;
      text += `[Commande] : ${data.command}\n`;
      text += `[Code de retour] : ${data.exitCode} (${data.exitCode === 0 ? 'SUCCÈS' : 'ÉCHEC'})\n`;
      text += `[Durée] : ${data.durationMs} ms\n\n`;
      if (data.stdout) {
        text += `--- SORTIE STANDARD (STDOUT) ---\n${data.stdout}\n\n`;
      }
      if (data.stderr) {
        text += `--- ERREURS (STDERR) ---\n${data.stderr}\n\n`;
      }
      output.textContent = text;
    } catch (e) {
      output.textContent = `[Erreur lors de l'appel]: ${e.message}\n`;
    }
  },

  // --- AUDIT LOGS ---

  async loadAuditLogs() {
    try {
      const res = await Auth.request('/api/system/audit?limit=30');
      if (!res.ok) return;
      const logs = await res.json();
      const tbody = document.getElementById('audit-table-body');
      if (!tbody) return;

      tbody.innerHTML = logs.map(l => `
        <tr>
          <td><span style="font-size:0.8rem; color:var(--text-muted);">${new Date(l.timestamp).toLocaleTimeString()}</span></td>
          <td><code>${Dashboard.escapeHtml(l.ip)}</code></td>
          <td><strong>${Dashboard.escapeHtml(l.user)}</strong></td>
          <td><code>${Dashboard.escapeHtml(l.action)}</code></td>
          <td><span class="dot ${l.success ? 'green' : 'red'}"></span> ${l.success ? 'Succès' : 'Refus/Échec'}</td>
          <td style="font-size: 0.8rem; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${Dashboard.escapeHtml(JSON.stringify(l.details))}
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('Failed to load audit logs:', e);
    }
  }
};
