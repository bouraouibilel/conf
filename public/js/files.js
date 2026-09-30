// File Explorer & Log Viewer
const FileExplorer = {
  currentPath: '',
  parentPath: '',

  async init() {
    await this.loadDirectory('');
  },

  async loadDirectory(targetPath) {
    try {
      const url = targetPath ? `/api/files/list?path=${encodeURIComponent(targetPath)}` : '/api/files/list';
      const res = await Auth.request(url);
      if (!res.ok) {
        const err = await res.json();
        App.notify('Erreur', err.error || 'Impossible d\'accéder au répertoire', 'danger');
        return;
      }

      const data = await res.json();
      this.currentPath = data.currentPath;
      this.parentPath = data.parentPath;

      document.getElementById('files-current-path').textContent = this.currentPath;
      const tbody = document.getElementById('files-table-body');
      if (!tbody) return;

      tbody.innerHTML = data.items.map(item => {
        const isDir = item.isDirectory;
        const icon = isDir ? '📁' : '📄';
        const sizeFormatted = isDir ? '-' : this.formatBytes(item.size);
        const escapedPath = Dashboard.escapeHtml(item.path).replace(/\\/g, '\\\\');

        return `
          <tr>
            <td>
              <span style="cursor: pointer; font-weight: ${isDir ? '600' : 'normal'}; color: ${isDir ? 'var(--accent)' : 'inherit'};" 
                    onclick="${isDir ? `FileExplorer.loadDirectory('${escapedPath}')` : `FileExplorer.viewFile('${escapedPath}')`}">
                ${icon} ${Dashboard.escapeHtml(item.name)}
              </span>
            </td>
            <td>${sizeFormatted}</td>
            <td><code style="font-size:0.75rem;">${item.permissions || '-'}</code></td>
            <td><span style="font-size:0.8rem; color:var(--text-muted);">${new Date(item.mtime).toLocaleDateString()}</span></td>
            <td>
              <div style="display:flex; gap:0.3rem;">
                ${!isDir ? `
                  <button class="btn" style="padding:0.2rem 0.4rem; font-size:0.75rem;" onclick="FileExplorer.viewFile('${escapedPath}')">Voir</button>
                  <button class="btn" style="padding:0.2rem 0.4rem; font-size:0.75rem;" onclick="FileExplorer.downloadFile('${escapedPath}')">Télécharger</button>
                ` : `
                  <button class="btn" style="padding:0.2rem 0.4rem; font-size:0.75rem;" onclick="FileExplorer.loadDirectory('${escapedPath}')">Ouvrir</button>
                `}
                <button class="btn btn-danger" style="padding:0.2rem 0.4rem; font-size:0.75rem;" onclick="FileExplorer.deleteItem('${escapedPath}', '${Dashboard.escapeHtml(item.name)}')">Suppr</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  navigateUp() {
    if (this.parentPath && this.parentPath !== this.currentPath) {
      this.loadDirectory(this.parentPath);
    }
  },

  async viewFile(path) {
    try {
      const res = await Auth.request(`/api/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const err = await res.json();
        App.notify('Erreur', err.error || 'Lecture impossible', 'danger');
        return;
      }
      const data = await res.json();
      App.showModal(
        `Visualisation : ${path}`,
        `<pre class="console-output" style="max-height: 550px;">${Dashboard.escapeHtml(data.content)}</pre>`,
        true
      );
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    }
  },

  downloadFile(path) {
    const token = Auth.getToken();
    window.open(`/api/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`, '_blank');
  },

  async uploadFile(inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await Auth.request(`/api/files/upload?path=${encodeURIComponent(this.currentPath)}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        App.notify('Succès', 'Fichier téléversé avec succès', 'success');
        this.loadDirectory(this.currentPath);
      } else {
        App.notify('Erreur', data.error, 'danger');
      }
    } catch (e) {
      App.notify('Erreur', e.message, 'danger');
    } finally {
      inputElement.value = '';
    }
  },

  deleteItem(path, name) {
    App.showSensitiveActionModal(
      'Suppression de fichier',
      `Êtes-vous sûr de vouloir supprimer définitivement "${name}" ?`,
      async (confirmPassword) => {
        const res = await Auth.request(`/api/files/delete?path=${encodeURIComponent(path)}`, {
          method: 'DELETE',
          body: JSON.stringify({ confirmPassword })
        });
        const data = await res.json();
        if (res.ok) {
          App.notify('Supprimé', data.message, 'success');
          this.loadDirectory(this.currentPath);
        } else {
          throw new Error(data.error || 'Erreur lors de la suppression');
        }
      },
      'Supprimer définitivement'
    );
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
};
