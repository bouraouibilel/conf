// Tunnels & Web Exposure Manager (Cloudflare & AutoSSH)
const Tunnels = {
  tunnels: [],

  async init() {
    await this.loadTunnels();
  },

  async loadTunnels() {
    try {
      const machineId = (typeof Machines !== 'undefined' && Machines.currentMachineId) ? Machines.currentMachineId : 'local';
      const res = await Auth.request(`/api/tunnels?machineId=${encodeURIComponent(machineId)}`);
      if (!res.ok) return;
      this.tunnels = await res.json();
      this.render();
    } catch (e) {
      console.error('Failed to load tunnels:', e);
    }
  },

  render() {
    const container = document.getElementById('tunnels-list-container');
    if (!container) return;

    if (this.tunnels.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 2.5rem; color: var(--text-secondary);">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🌐</div>
          <h3 style="color: var(--text-primary); margin-bottom: 0.5rem;">Aucun tunnel actif détecté</h3>
          <p style="font-size: 0.9rem; max-width: 500px; margin: 0 auto 1.5rem auto;">
            Exposez facilement vos services locaux ou distants sur le web sans ouvrir de ports sur votre box / routeur grâce aux tunnels Cloudflare ou AutoSSH.
          </p>
          <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="Tunnels.showCloudflareModal()">
              ☁️ Créer un tunnel Cloudflare
            </button>
            <button class="btn" onclick="Tunnels.showAutoSshModal()">
              🔀 Créer un tunnel AutoSSH
            </button>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = this.tunnels.map(t => {
      const isCf = t.type === 'cloudflare';
      const isRunning = t.status === 'active' || t.isRunning;
      const statusColor = isRunning ? 'green' : 'red';
      const statusText = isRunning ? 'Actif' : 'Arrêté';
      const targetMachine = Machines.machines.find(m => m.id === t.machineId)?.name || t.machineId;

      return `
        <div class="card" style="border-left: 4px solid ${isCf ? '#f38020' : '#a371f7'};">
          <div class="card-header">
            <div>
              <div style="font-size: 1.05rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span>${isCf ? '☁️ Cloudflare' : '🔀 AutoSSH'}</span>
                <strong>${Dashboard.escapeHtml(t.name)}</strong>
                ${t.isSystemd ? `
                  <span class="system-badge" style="font-size: 0.75rem; background: rgba(163, 113, 247, 0.2); color: var(--purple);">
                    ⚙️ Service Systemd
                  </span>
                ` : ''}
                <span class="system-badge" style="font-size: 0.75rem;">
                  <span class="dot ${statusColor}"></span> ${statusText}
                </span>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.35rem;">
                Machine source : <strong>${Dashboard.escapeHtml(targetMachine)}</strong> &bull;
                Port local : <code>${t.localPort}</code>
                ${!isCf && t.vpsHost ? ` &bull; VPS distant : <code>${Dashboard.escapeHtml(t.vpsHost)}:${t.remotePort}</code>` : ''}
                ${t.serviceName ? ` &bull; Unité : <code>${Dashboard.escapeHtml(t.serviceName)}</code>` : ''}
              </div>
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
              ${isRunning ? `
                <button class="btn btn-warning" onclick="Tunnels.stopTunnel('${t.id}')">🛑 Arrêter</button>
              ` : `
                <button class="btn btn-success" onclick="Tunnels.restartTunnel('${t.id}')">▶️ Démarrer</button>
              `}
              <button class="btn" onclick="Tunnels.showLogs('${t.id}', '${Dashboard.escapeHtml(t.name)}')">📜 Logs</button>
              <button class="btn" onclick="Tunnels.showSystemdModal('${t.id}')">⚙️ Service</button>
              <button class="btn btn-danger" onclick="Tunnels.promptDelete('${t.id}', '${Dashboard.escapeHtml(t.name)}')">🗑️</button>
            </div>
          </div>

          <!-- Public URL Card -->
          <div style="margin-top: 1rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 0.75rem 1rem; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">URL Publique :</span>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; margin-top: 0.2rem;">
                ${t.publicUrl ? `
                  <a href="${t.publicUrl.startsWith('http') ? t.publicUrl : 'http://' + t.publicUrl}" target="_blank" style="color: var(--accent); text-decoration: underline;">
                    ${Dashboard.escapeHtml(t.publicUrl)} ↗
                  </a>
                ` : `
                  <span style="color: var(--text-muted); font-style: italic;">En attente de génération d'URL...</span>
                `}
              </div>
            </div>
            ${t.publicUrl ? `
              <button class="btn" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="Tunnels.copyUrl('${Dashboard.escapeHtml(t.publicUrl)}')">
                📋 Copier l'URL
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  },

  copyUrl(url) {
    navigator.clipboard.writeText(url).then(() => {
      App.notify('Copié !', 'URL publique copiée dans le presse-papiers.', 'success');
    });
  },

  // --- MODALS ---

  showCloudflareModal() {
    this.populateMachineSelect('cf-machine-select');
    const modal = document.getElementById('modal-add-cf');
    if (modal) modal.style.display = 'flex';
  },

  closeCloudflareModal() {
    const modal = document.getElementById('modal-add-cf');
    if (modal) modal.style.display = 'none';
  },

  showAutoSshModal() {
    this.populateMachineSelect('as-machine-select');
    const modal = document.getElementById('modal-add-autossh');
    if (modal) modal.style.display = 'flex';
  },

  closeAutoSshModal() {
    const modal = document.getElementById('modal-add-autossh');
    if (modal) modal.style.display = 'none';
  },

  populateMachineSelect(elementId) {
    const sel = document.getElementById(elementId);
    if (!sel || !Machines.machines) return;
    sel.innerHTML = Machines.machines.map(m => `
      <option value="${m.id}" ${m.id === Machines.currentMachineId ? 'selected' : ''}>
        ${m.isLocal ? '📍 ' : '🌐 '}${m.name} (${m.host})
      </option>
    `).join('');
  },

  // --- SUBMISSIONS ---

  async handleCloudflareSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('cf-name').value.trim();
    const localPort = document.getElementById('cf-port').value.trim();
    const machineId = document.getElementById('cf-machine-select').value;
    const token = document.getElementById('cf-token').value.trim() || null;
    const protocol = document.getElementById('cf-proto').value;

    App.notify('Cloudflare Tunnel', 'Démarrage du tunnel Cloudflare...', 'info');

    try {
      const res = await Auth.request('/api/tunnels/cloudflare', {
        method: 'POST',
        body: JSON.stringify({ name, localPort, machineId, token, protocol })
      });
      const data = await res.json();
      if (res.ok) {
        App.notify('Tunnel créé', 'Tunnel Cloudflare en cours d\'exécution !', 'success');
        this.closeCloudflareModal();
        await this.loadTunnels();
        // Refresh again in 3s to capture trycloudflare url
        setTimeout(() => this.loadTunnels(), 3000);
      } else {
        App.notify('Erreur', data.error, 'danger');
      }
    } catch (err) {
      App.notify('Erreur', err.message, 'danger');
    }
  },

  async handleAutoSshSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('as-name').value.trim();
    const localPort = document.getElementById('as-local-port').value.trim();
    const remotePort = document.getElementById('as-remote-port').value.trim();
    const vpsHost = document.getElementById('as-vps-host').value.trim();
    const vpsPort = document.getElementById('as-vps-port').value.trim() || 22;
    const vpsUser = document.getElementById('as-vps-user').value.trim() || 'root';
    const machineId = document.getElementById('as-machine-select').value;
    const bindAll = document.getElementById('as-bind-all').checked;

    App.notify('AutoSSH', 'Initialisation du tunnel reverse...', 'info');

    try {
      const res = await Auth.request('/api/tunnels/autossh', {
        method: 'POST',
        body: JSON.stringify({ name, localPort, remotePort, vpsHost, vpsPort, vpsUser, machineId, bindAll })
      });
      const data = await res.json();
      if (res.ok) {
        App.notify('Tunnel démarré', 'Le tunnel AutoSSH a été établi avec succès !', 'success');
        this.closeAutoSshModal();
        await this.loadTunnels();
      } else {
        App.notify('Erreur', data.error, 'danger');
      }
    } catch (err) {
      App.notify('Erreur', err.message, 'danger');
    }
  },

  async restartTunnel(id) {
    App.notify('Démarrage', 'Démarrage du tunnel...', 'info');
    try {
      const res = await Auth.request(`/api/tunnels/${id}/restart`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        App.notify('Démarré', data.message || 'Tunnel en cours d\'exécution', 'success');
        await this.loadTunnels();
      } else {
        App.notify('Erreur', data.error, 'danger');
      }
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  async stopTunnel(id) {
    try {
      const res = await Auth.request(`/api/tunnels/${id}/stop`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        App.notify('Arrêté', data.message, 'info');
        await this.loadTunnels();
      } else {
        App.notify('Erreur', data.error, 'danger');
      }
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  async showLogs(id, name) {
    try {
      const res = await Auth.request(`/api/tunnels/${id}/logs`);
      const data = await res.json();
      App.showModal(`Logs du tunnel : ${name}`, `<pre class="console-output" style="max-height: 500px;">${Dashboard.escapeHtml(data.logs || 'Aucun log')}</pre>`, true);
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  promptDelete(id, name) {
    App.showSensitiveActionModal(
      'Supprimer le tunnel',
      `Êtes-vous sûr de vouloir supprimer définitivement la configuration du tunnel "${name}" ?`,
      async (confirmPassword) => {
        const res = await Auth.request(`/api/tunnels/${id}`, {
          method: 'DELETE',
          body: JSON.stringify({ confirmPassword })
        });
        const data = await res.json();
        if (res.ok) {
          App.notify('Supprimé', data.message, 'success');
          await this.loadTunnels();
        } else {
          throw new Error(data.error || 'Erreur lors de la suppression');
        }
      },
      'Supprimer définitivement'
    );
  },

  // --- SYSTEMD AUTOMATION MODAL ---

  async showSystemdModal(tunnelId) {
    try {
      const res = await Auth.request(`/api/tunnels/${tunnelId}/systemd`);
      const data = await res.json();
      const tunnel = this.getById(tunnelId);

      const html = `
        <div style="margin-bottom: 1rem; font-size: 0.9rem; color: var(--text-secondary);">
          Fichier de service Systemd généré automatiquement pour démarrer ce tunnel en arrière-plan et au boot :
        </div>
        <pre class="console-output" style="max-height: 250px; margin-bottom: 1rem;">${Dashboard.escapeHtml(data.content)}</pre>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
          <button class="btn" onclick="navigator.clipboard.writeText('${encodeURIComponent(data.content)}').then(() => App.notify('Copié', 'Contenu du service copié', 'success'))">
            📋 Copier le contenu
          </button>
          <button class="btn btn-primary" onclick="Tunnels.installSystemd('${tunnelId}')">
            🚀 Installer & Activer en service Systemd (1-clic)
          </button>
        </div>
      `;

      App.showModal(`Automatisation Systemd - ${tunnel?.name || tunnelId}`, html, true);
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  installSystemd(tunnelId) {
    App.showSensitiveActionModal(
      'Installation du service Systemd',
      'Cette opération va créer le fichier /etc/systemd/system/ et activer le démarrage automatique au boot de la machine.',
      async (confirmPassword) => {
        const res = await Auth.request(`/api/tunnels/${tunnelId}/install-systemd`, {
          method: 'POST',
          body: JSON.stringify({ confirmPassword })
        });
        const data = await res.json();
        if (res.ok) {
          App.notify('Service actif !', data.message, 'success');
          App.closeModal();
        } else {
          throw new Error(data.error || 'Erreur installation systemd');
        }
      },
      'Confirmer l\'installation Systemd'
    );
  }
};
