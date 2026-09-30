const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const cookieParser = require('cookie-parser');
const config = require('./src/config');
const { verifyWsToken } = require('./src/middleware/auth');
const ptyManager = require('./src/services/ptyManager');
const sshManager = require('./src/services/sshManager');
const metricsService = require('./src/services/metrics');
const audit = require('./src/services/audit');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static vendor files for xterm.js
app.use('/vendor/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm/lib')));
app.use('/vendor/xterm-css', express.static(path.join(__dirname, 'node_modules/@xterm/xterm/css')));
app.use('/vendor/xterm-addon-fit', express.static(path.join(__dirname, 'node_modules/@xterm/addon-fit/lib')));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/machines', require('./src/routes/machines'));
app.use('/api/system', require('./src/routes/system'));
app.use('/api/shell', require('./src/routes/shell'));
app.use('/api/services', require('./src/routes/services'));
app.use('/api/files', require('./src/routes/files'));
app.use('/api/tunnels', require('./src/routes/tunnels'));

// Fallback to index.html for SPA (Express 5 compatible)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/vendor')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket Server for Terminal & Metrics
const wssTerminal = new WebSocketServer({ noServer: true });
const wssMetrics = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Authenticate WebSocket connection
  const user = verifyWsToken(request);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  request.user = user;
  request.machineId = url.searchParams.get('machineId') || 'local';

  if (pathname === '/ws/terminal') {
    wssTerminal.handleUpgrade(request, socket, head, (ws) => {
      wssTerminal.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/metrics') {
    wssMetrics.handleUpgrade(request, socket, head, (ws) => {
      wssMetrics.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle Terminal WebSocket (Local PTY or Remote SSH)
wssTerminal.on('connection', async (ws, req) => {
  const sessionId = `term_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const clientIp = req.socket.remoteAddress;
  const machineId = req.machineId || 'local';

  audit.logAction(clientIp, req.user.username, 'TERMINAL_SESSION_OPENED', { sessionId, machineId });

  if (machineId !== 'local') {
    // Remote SSH terminal session
    try {
      const session = await sshManager.createShellSession(sessionId, machineId, { cols: 80, rows: 24 });

      session.stream.on('data', (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: data.toString('utf8') }));
        }
      });

      session.stream.on('close', (code) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', exitCode: code || 0 }));
          ws.close();
        }
        sshManager.closeShell(sessionId);
      });

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed.type === 'input') {
            sshManager.writeShell(sessionId, parsed.data);
          } else if (parsed.type === 'resize') {
            sshManager.resizeShell(sessionId, parsed.cols, parsed.rows);
          }
        } catch (err) {
          sshManager.writeShell(sessionId, message.toString());
        }
      });

      ws.on('close', () => {
        audit.logAction(clientIp, req.user.username, 'TERMINAL_SESSION_CLOSED', { sessionId, machineId });
        sshManager.closeShell(sessionId);
      });

      ws.on('error', (err) => {
        console.error(`Remote SSH terminal error [${sessionId}]:`, err.message);
        sshManager.closeShell(sessionId);
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: `Erreur SSH: ${err.message}` }));
      ws.close();
    }
    return;
  }

  // Local PTY session
  try {
    const session = ptyManager.createSession(sessionId, { cols: 80, rows: 24 });

    session.pty.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    session.pty.onExit(({ exitCode, signal }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
        ws.close();
      }
      ptyManager.closeSession(sessionId);
    });

    ws.on('message', (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'input') {
          ptyManager.write(sessionId, parsed.data);
        } else if (parsed.type === 'resize') {
          ptyManager.resize(sessionId, parsed.cols, parsed.rows);
        }
      } catch (err) {
        ptyManager.write(sessionId, message.toString());
      }
    });

    ws.on('close', () => {
      audit.logAction(clientIp, req.user.username, 'TERMINAL_SESSION_CLOSED', { sessionId, machineId });
      ptyManager.closeSession(sessionId);
    });

    ws.on('error', (err) => {
      console.error(`Terminal WS error [${sessionId}]:`, err.message);
      ptyManager.closeSession(sessionId);
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: `Erreur démarrage PTY: ${err.message}` }));
    ws.close();
  }
});

// Handle Live Metrics WebSocket (Local or Remote)
wssMetrics.on('connection', (ws, req) => {
  const machineId = req.machineId || 'local';

  const interval = setInterval(async () => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      let data;
      if (machineId === 'local') {
        data = await metricsService.getLiveMetrics();
      } else {
        data = await sshManager.getRemoteMetrics(machineId);
      }
      ws.send(JSON.stringify({ type: 'metrics', data, machineId }));
    } catch (e) {
      // ignore transient metric errors
    }
  }, 2500);

  ws.on('close', () => clearInterval(interval));
  ws.on('error', () => clearInterval(interval));
});

// Start Server
server.listen(config.port, config.host, () => {
  const osInfo = require('os');
  console.log('\n============================================================');
  console.log('       SERVEUR D\'ADMINISTRATION DISTANTE (WEB ADMIN)       ');
  console.log('============================================================');
  console.log(` Statut     : EN LIGNE`);
  console.log(` Système    : ${osInfo.type()} (${osInfo.platform()} - ${osInfo.arch()})`);
  console.log(` Shell      : ${config.shell}`);
  console.log(` Ecoute sur : http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(` Identifiant: ${config.adminUsername}`);
  if (config.generatedPassword) {
    console.log(` Mot de passe temporaire généré : ${config.generatedPassword}`);
  } else {
    console.log(` Mot de passe : Configuré via .env`);
  }
  console.log('============================================================\n');
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
