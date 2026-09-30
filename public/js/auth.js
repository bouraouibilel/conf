// Authentication & API helper
const Auth = {
  getToken() {
    return localStorage.getItem('admin_token') || '';
  },

  setToken(token) {
    localStorage.setItem('admin_token', token);
  },

  clearToken() {
    localStorage.removeItem('admin_token');
  },

  async request(url, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, { ...options, headers });
      if (response.status === 401 || response.status === 403) {
        this.clearToken();
        App.showLoginModal();
        throw new Error('Session expirée ou non autorisée');
      }
      return response;
    } catch (err) {
      throw err;
    }
  },

  async checkAuth() {
    const token = this.getToken();
    if (!token) return false;

    try {
      const res = await this.request('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        return data;
      }
      return false;
    } catch (e) {
      return false;
    }
  },

  async login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Échec de connexion');
    }

    this.setToken(data.token);
    return data;
  },

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // ignore
    }
    this.clearToken();
    location.reload();
  }
};
