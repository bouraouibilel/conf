// Main Application Controller
const App = {
  activeTab: 'overview',
  eventsInitialized: false,
  isAppStarted: false,

  async init() {
    this.setupEventListeners();
    this.setupNavigation();

    // Check authentication
    const userSession = await Auth.checkAuth();
    if (!userSession) {
      this.showLoginModal();
      return;
    }

    // Hide login modal if visible
    const modal = document.getElementById('modal-login');
    if (modal) modal.style.display = 'none';

    await this.startApp();
  },

  async startApp() {
    if (this.isAppStarted) return;
    this.isAppStarted = true;

    // Initialize modules
    await Machines.init();
    await Dashboard.init();
    await Actions.init();
    await FileExplorer.init();
    await Tunnels.init();

    // Default to Overview tab
    this.switchTab('overview');
  },

  setupNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.onclick = () => {
        const targetTab = tab.getAttribute('data-tab');
        this.switchTab(targetTab);
      };
    });
  },

  switchTab(tabName) {
    this.activeTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    // Update tab panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabName}`);
    });

    // Notify listeners
    document.dispatchEvent(new CustomEvent('tab-changed', { detail: tabName }));

    // Trigger tab-specific actions
    if (tabName === 'terminal') {
      TerminalManager.init();
    } else if (tabName === 'actions') {
      Actions.loadServices();
    } else if (tabName === 'audit') {
      Actions.loadAuditLogs();
    } else if (tabName === 'overview') {
      Dashboard.loadProcesses();
    } else if (tabName === 'machines') {
      Machines.loadMachines();
    } else if (tabName === 'tunnels') {
      Tunnels.loadTunnels();
    }
  },

  setupEventListeners() {
    if (this.eventsInitialized) return;
    this.eventsInitialized = true;

    // Command input enter key
    const cmdInput = document.getElementById('command-input');
    if (cmdInput) {
      cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          Actions.runCommand();
        }
      });
    }

    // Login form submit
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    // Add Machine form submit
    const addMachineForm = document.getElementById('add-machine-form');
    if (addMachineForm) {
      addMachineForm.addEventListener('submit', (e) => Machines.handleAddSubmit(e));
    }

    // Add Cloudflare tunnel form submit
    const cfForm = document.getElementById('form-add-cf');
    if (cfForm) {
      cfForm.addEventListener('submit', (e) => Tunnels.handleCloudflareSubmit(e));
    }

    // Add AutoSSH tunnel form submit
    const asForm = document.getElementById('form-add-autossh');
    if (asForm) {
      asForm.addEventListener('submit', (e) => Tunnels.handleAutoSshSubmit(e));
    }
  },

  // Dedicated Login Handler
  async handleLogin(event) {
    if (event) {
      event.preventDefault();
    }

    const userEl = document.getElementById('login-username');
    const passEl = document.getElementById('login-password');
    const errEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    const username = userEl ? userEl.value.trim() : '';
    const password = passEl ? passEl.value : '';

    if (!username || !password) {
      if (errEl) errEl.textContent = 'Veuillez saisir votre identifiant et votre mot de passe.';
      return;
    }

    if (errEl) errEl.textContent = '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Connexion en cours...';
    }

    try {
      await Auth.login(username, password);
      const modal = document.getElementById('modal-login');
      if (modal) modal.style.display = 'none';
      if (passEl) passEl.value = '';

      this.notify('Connexion réussie', `Bienvenue ${username} !`, 'success');
      await this.startApp();
    } catch (err) {
      if (errEl) errEl.textContent = err.message || 'Identifiants incorrects.';
      if (passEl) {
        passEl.value = '';
        passEl.focus();
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Se connecter';
      }
    }
  },

  // Notification Toast
  notify(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '9999';
    toast.style.color = '#fff';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
    toast.style.fontSize = '0.9rem';
    toast.style.display = 'flex';
    toast.style.flexDirection = 'column';
    toast.style.gap = '4px';

    if (type === 'danger') toast.style.backgroundColor = '#da3633';
    else if (type === 'success') toast.style.backgroundColor = '#238636';
    else if (type === 'warning') toast.style.backgroundColor = '#d29922';
    else toast.style.backgroundColor = '#1f6feb';

    toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s ease';
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  },

  // Sensitive Action Modal with Password Verification
  showSensitiveActionModal(title, description, onConfirm, actionBtnText = 'Confirmer avec mon mot de passe') {
    const modal = document.getElementById('sensitive-action-modal');
    const titleEl = document.getElementById('sensitive-modal-title');
    const descEl = document.getElementById('sensitive-modal-desc');
    const passInput = document.getElementById('sensitive-modal-password');
    const errEl = document.getElementById('sensitive-modal-error');
    const submitBtn = document.getElementById('sensitive-modal-submit-btn');

    titleEl.textContent = title;
    descEl.textContent = description;
    passInput.value = '';
    errEl.textContent = '';
    submitBtn.textContent = actionBtnText;

    submitBtn.onclick = async () => {
      const pass = passInput.value;
      if (!pass) {
        errEl.textContent = 'Veuillez saisir votre mot de passe pour continuer.';
        return;
      }

      errEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Validation...';

      try {
        await onConfirm(pass);
        modal.style.display = 'none';
      } catch (err) {
        errEl.textContent = err.message || 'Échec de l\'action';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = actionBtnText;
      }
    };

    modal.style.display = 'flex';
    setTimeout(() => passInput.focus(), 50);
  },

  closeSensitiveActionModal() {
    const modal = document.getElementById('sensitive-action-modal');
    if (modal) modal.style.display = 'none';
  },

  // Modal helpers
  showLoginModal() {
    const modal = document.getElementById('modal-login');
    if (modal) {
      modal.style.display = 'flex';
      const passEl = document.getElementById('login-password');
      if (passEl) setTimeout(() => passEl.focus(), 50);
    }
  },

  showModal(title, contentHtml, isWide = false) {
    const modal = document.getElementById('generic-modal');
    const titleEl = document.getElementById('generic-modal-title');
    const bodyEl = document.getElementById('generic-modal-body');
    const cardEl = modal.querySelector('.modal-card');

    titleEl.textContent = title;
    bodyEl.innerHTML = contentHtml;

    if (isWide) cardEl.classList.add('wide');
    else cardEl.classList.remove('wide');

    modal.style.display = 'flex';
  },

  closeModal() {
    const modal = document.getElementById('generic-modal');
    if (modal) modal.style.display = 'none';
  }
};

window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
