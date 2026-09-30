// Network Machines Manager
const Machines = {
  currentMachineId: 'local',
  machines: [],

  async init() {
    await this.loadMachines();
    this.setupSelector();
  },

  async loadMachines() {
    try {
      const res = await Auth.request('/api/machines');
      if (!res.ok) return;
      this.machines = await res.json();
      this.renderMachinesTable();
      this.updateGlobalSelector();
    } catch (e) {
      console.error('Failed to load machines:', e);
    }
  },

  updateGlobalSelector() {
    const select = document.getElementById('global-machine-select');
    if (!select) return;

    select.innerHTML = this.machines.map(m => `
      <option value="${m.id}" ${m.id === this.currentMachineId ? 'selected' : ''}>
        ${m.isLocal ? '📍 ' : '🌐 '}${m.name} (${m.host})
      </option>
    `).join('');
  },

  setupSelector() {
    const select = document.getElementById('global-machine-select');
    if (!select) return;

    select.addEventListener('change', (e) => {
      this.selectMachine(e.target.value);
    });
  },

  selectMachine(id) {
    this.currentMachineId = id;
    const m = this.machines.find(x => x.id === id) || { name: 'Machine inconnue', host: id };

    App.notify('Machine active changée', `Contexte basculé sur : ${m.name} (${m.host})`, 'info');

    // Update UI badge
    const badge = document.getElementById('badge-platform');
    if (badge) {
      badge.innerHTML = `<span class="dot green"></span> ${m.name} (${m.host})`;
    }

    // Refresh active tab context
    const currentTab = App.activeTab;
    if (currentTab === 'overview') {
      Dashboard.init();
    } else if (currentTab === 'terminal') {
      TerminalManager.reconnect();
    } else if (currentTab === 'commands') {
      Actions.loadPresets();
    } else if (currentTab === 'actions') {
      Actions.loadServices();
    }

    this.updateGlobalSelector();
  },

  renderMachinesTable() {
    const container = document.getElementById('machines-list-container');
    if (!container) return;

    container.innerHTML = this.machines.map(m => {
      const isCurrent = m.id === this.currentMachineId;

      return `
        <div class="card" style="border-left: 4px solid ${isCurrent ? 'var(--accent)' : 'var(--border-color)'};">
          <div class="card-header">
            <div>
              <div style="font-size: 1.05rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                ${m.isLocal ? '📍' : '🌐'} ${Dashboard.escapeHtml(m.name)}
                ${isCurrent ? '<span class="system-badge" style="font-size:0.75rem;">Active</span>' : ''}
              </div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
                <code>${Dashboard.escapeHtml(m.username)}@${Dashboard.escapeHtml(m.host)}:${m.port}</code>
                ${m.macAddress ? ` &bull; MAC: <code>${Dashboard.escapeHtml(m.macAddress)}</code>` : ''}
              </div>
            </div>
            <div>
              ${!isCurrent ? `
                <button class="btn btn-primary" onclick="Machines.selectMachine('${m.id}')">
                  Sélectionner
                </button>
              ` : `
                <button class="btn" disabled style="opacity: 0.7;">En cours</button>
              `}
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem;">
            ${!m.isLocal ? `
              <button class="btn" onclick="Machines.testConnection('${m.id}')">
                🔌 Tester la connexion SSH
              </button>
              ${m.macAddress ? `
                <button class="btn" onclick="Machines.wakeOnLan('${m.id}')">
                  ⚡ Wake-on-LAN
                </button>
              ` : ''}
              <button class="btn btn-danger" onclick="Machines.promptDelete('${m.id}', '${Dashboard.escapeHtml(m.name)}')">
                🗑️ Supprimer
              </button>
            ` : `
              <span style="font-size: 0.8rem; color: var(--text-muted); align-self: center;">
                Machine hôte hébergeant le serveur d'administration
              </span>
            `}
          </div>
        </div>
      `;
    }).join('');
  },

  showAddModal() {
    const modal = document.getElementById('modal-add-machine');
    if (modal) modal.style.display = 'flex';
  },

  closeAddModal() {
    const modal = document.getElementById('modal-add-machine');
    if (modal) modal.style.display = 'none';
  },

  async handleAddSubmit(event) {
    event.preventDefault();
    const name = document.getElementById('add-machine-name').value.trim();
    const host = document.getElementById('add-machine-host').value.trim();
    const port = document.getElementById('add-machine-port').value.trim() || 22;
    const username = document.getElementById('add-machine-user').value.trim() || 'root';
    const authType = document.getElementById('add-machine-authtype').value;
    const password = document.getElementById('add-machine-pass').value;
    const privateKey = document.getElementById('add-machine-key').value;
    const macAddress = document.getElementById('add-machine-mac').value.trim();

    try {
      const res = await Auth.request('/api/machines', {
        method: 'POST',
        body: JSON.stringify({ name, host, port, username, authType, password, privateKey, macAddress })
      });
      const data = await res.json();
      if (res.ok) {
        App.notify('Machine ajoutée', `La machine ${name} a été enregistrée avec succès`, 'success');
        this.closeAddModal();
        await this.loadMachines();
      } else {
        App.notify('Erreur', data.error, 'danger');
      }
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  async testConnection(id) {
    App.notify('Test SSH', 'Tentative de connexion en cours...', 'info');
    try {
      const res = await Auth.request(`/api/machines/${id}/test`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        App.notify('Connexion réussie', data.message, 'success');
      } else {
        App.notify('Échec de connexion', data.error || 'Impossible de joindre la machine', 'danger');
      }
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  async wakeOnLan(id) {
    try {
      const res = await Auth.request(`/api/machines/${id}/wake`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        App.notify('Wake-on-LAN', data.message, 'success');
      } else {
        App.notify('Erreur Wake-on-LAN', data.error, 'danger');
      }
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  promptDelete(id, name) {
    App.showSensitiveActionModal(
      'Supprimer une machine du réseau',
      `Attention : Vous vous apprêtez à supprimer la machine "${name}" de l'inventaire.`,
      async (confirmPassword) => {
        const res = await Auth.request(`/api/machines/${id}`, {
          method: 'DELETE',
          body: JSON.stringify({ confirmPassword })
        });
        const data = await res.json();
        if (res.ok) {
          App.notify('Machine supprimée', data.message, 'success');
          if (this.currentMachineId === id) {
            this.selectMachine('local');
          }
          await this.loadMachines();
        } else {
          throw new Error(data.error || 'Erreur lors de la suppression');
        }
      },
      'Supprimer définitivement'
    );
  }
};
