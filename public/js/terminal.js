// Terminal manager with xterm.js
const TerminalManager = {
  term: null,
  fitAddon: null,
  ws: null,
  isInitialized: false,

  init() {
    const container = document.getElementById('terminal-container');
    if (!container || this.isInitialized) return;

    // Verify Terminal is loaded
    if (typeof Terminal === 'undefined') {
      container.innerHTML = '<div style="padding: 1rem; color: #f85149;">Erreur: Le composant xterm.js n\'a pas pu être chargé.</div>';
      return;
    }

    const fitAddonClass = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;

    this.term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88, 166, 255, 0.3)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc'
      }
    });

    if (fitAddonClass) {
      this.fitAddon = new fitAddonClass();
      this.term.loadAddon(this.fitAddon);
    }

    this.term.open(container);

    if (this.fitAddon) {
      setTimeout(() => this.fitAddon.fit(), 50);
    }

    // Connect WebSocket
    this.connectWs();

    // Handle user keyboard input
    this.term.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Window resize handler
    window.addEventListener('resize', () => this.handleResize());

    // Fit when tab becomes visible
    document.addEventListener('tab-changed', (e) => {
      if (e.detail === 'terminal' && this.fitAddon) {
        setTimeout(() => {
          this.fitAddon.fit();
          this.handleResize();
        }, 100);
      }
    });

    this.isInitialized = true;
  },

  connectWs() {
    const token = Auth.getToken();
    const machineId = (typeof Machines !== 'undefined' && Machines.currentMachineId) ? Machines.currentMachineId : 'local';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?token=${encodeURIComponent(token)}&machineId=${encodeURIComponent(machineId)}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.term.writeln('\x1b[32m[Session terminal connecté]\x1b[0m\r\n');
      this.handleResize();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          this.term.write(msg.data);
        } else if (msg.type === 'exit') {
          this.term.writeln(`\r\n\x1b[33m[Processus terminé avec code: ${msg.exitCode}]\x1b[0m\r\n`);
        } else if (msg.type === 'error') {
          this.term.writeln(`\r\n\x1b[31m[Erreur: ${msg.message}]\x1b[0m\r\n`);
        }
      } catch (err) {
        this.term.write(event.data);
      }
    };

    this.ws.onclose = () => {
      this.term.writeln('\r\n\x1b[31m[Session terminal déconnectée]\x1b[0m\r\n');
    };

    this.ws.onerror = (err) => {
      this.term.writeln('\r\n\x1b[31m[Erreur de connexion WebSocket]\x1b[0m\r\n');
    };
  },

  handleResize() {
    if (this.fitAddon) {
      this.fitAddon.fit();
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.term) {
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols: this.term.cols,
        rows: this.term.rows
      }));
    }
  },

  reconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
    if (this.term) {
      this.term.clear();
    }
    this.connectWs();
  },

  clear() {
    if (this.term) {
      this.term.clear();
    }
  }
};
