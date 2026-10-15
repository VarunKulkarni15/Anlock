/* ==========================================================================
   ANLOCK DESKTOP COMPANION & SUPABASE REALTIME BRIDGE
   Windows Service & Pairing Generator for https://anlock.dpdns.org
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const crypto = require('crypto');
const net = require('net');
const WebSocket = require('ws');
const QRCode = require('qrcode');

// Supabase Cloud Relay Configuration
const CONFIG = {
  supabaseUrl: 'https://eudpfmvpgjottroiesoc.supabase.co',
  supabaseAnonKey: 'sb_publishable_aHKIEbX5W5PoZcKcgvRFew_1MhP9l8h',
  realtimeWsUrl: 'wss://eudpfmvpgjottroiesoc.supabase.co/realtime/v1/websocket?apikey=sb_publishable_aHKIEbX5W5PoZcKcgvRFew_1MhP9l8h&vsn=1.0.0',
  webDomain: 'https://anlock.dpdns.org',
  desktopPort: 4820,
  pipeName: '\\\\.\\pipe\\AnlockAuthPipe',
  storageFile: path.join(os.homedir(), '.anlock_devices.json')
};

// State
let state = {
  machineId: getMachineId(),
  hostname: os.hostname(),
  username: os.userInfo().username,
  pairedDevices: loadPairedDevices(),
  currentPairCode: generatePairCode(),
  currentPasswordKey: crypto.randomBytes(32).toString('hex'),
  ws: null,
  wsConnected: false,
  qrDataUrl: '',
  telemetryLogs: []
};

// Generate Machine Identifier
function getMachineId() {
  const raw = os.hostname() + '-' + os.platform() + '-' + os.arch() + '-' + os.userInfo().username;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

function generatePairCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function loadPairedDevices() {
  try {
    if (fs.existsSync(CONFIG.storageFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.storageFile, 'utf8'));
    }
  } catch (e) {
    console.error('Failed reading device storage', e.message);
  }
  return [];
}

function savePairedDevices(devices) {
  try {
    fs.writeFileSync(CONFIG.storageFile, JSON.stringify(devices, null, 2), 'utf8');
    state.pairedDevices = devices;
  } catch (e) {
    console.error('Failed saving device storage', e.message);
  }
}

// Generate the Pairing URL & QR Code targeting https://anlock.dpdns.org
async function generatePairingQR() {
  const pairPayload = {
    deviceId: state.machineId,
    deviceName: state.hostname,
    userName: state.username,
    passwordKey: state.currentPasswordKey,
    pairCode: state.currentPairCode,
    supabaseUrl: CONFIG.supabaseUrl
  };

  const pairUrl = `${CONFIG.webDomain}/#pair=${encodeURIComponent(JSON.stringify(pairPayload))}`;
  try {
    state.qrDataUrl = await QRCode.toDataURL(pairUrl, {
      margin: 1,
      width: 260,
      color: {
        dark: '#111827',
        light: '#FFFFFF'
      }
    });
    addLog(`Pairing QR generated for ${state.hostname} (Code: ${state.currentPairCode})`);
  } catch (err) {
    console.error('QR generation error', err);
  }
}

// Log telemetry
function addLog(msg) {
  const time = new Date().toTimeString().split(' ')[0];
  const entry = `[${time}] ${msg}`;
  state.telemetryLogs.unshift(entry);
  if (state.telemetryLogs.length > 50) state.telemetryLogs.pop();
  console.log(entry);
}

// ==========================================================================
// 1. SUPABASE REALTIME CLOUD WEBSOCKET CLIENT
// ==========================================================================
function connectSupabase() {
  addLog('Connecting to Supabase Realtime Relay...');
  state.ws = new WebSocket(CONFIG.realtimeWsUrl);

  state.ws.on('open', () => {
    state.wsConnected = true;
    addLog('Connected to Supabase Cloud Relay (200 OK)');

    // Join the machine's private channel
    const joinMsg = {
      topic: `realtime:anlock_${state.machineId}`,
      event: 'phx_join',
      payload: { config: { broadcast: { self: false } } },
      ref: 'pc_join_' + Date.now()
    };
    state.ws.send(JSON.stringify(joinMsg));
    addLog(`Subscribed to private channel: anlock_${state.machineId}`);

    // Heartbeat every 25 seconds
    setInterval(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
          topic: 'phoenix',
          event: 'heartbeat',
          payload: {},
          ref: Date.now().toString()
        }));
      }
    }, 25000);
  });

  state.ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleInboundRealtime(msg);
    } catch (e) {
      console.error('Packet parse error', e);
    }
  });

  state.ws.on('close', () => {
    state.wsConnected = false;
    addLog('Supabase connection lost. Reconnecting in 4s...');
    setTimeout(connectSupabase, 4000);
  });

  state.ws.on('error', (err) => {
    addLog(`Supabase WebSocket error: ${err.message}`);
  });
}

function handleInboundRealtime(msg) {
  if (msg.event === 'broadcast' && msg.payload && msg.payload.event) {
    const eventName = msg.payload.event;
    const payload = msg.payload.payload || {};

    addLog(`Received broadcast from mobile: ${eventName}`);

    if (eventName === 'remote_lock') {
      executeLockWorkStation();
    } else if (eventName === 'test_ping') {
      broadcastRealtime('test_pong', { status: 'ONLINE', hostname: state.hostname });
      addLog('Replied to phone ping request.');
    } else if (eventName === 'unlock_response') {
      addLog(`Biometric Unlock Response received! Status=${payload.status}`);
      // Notify Named Pipe IPC for Windows Credential Provider
      notifyCredentialProviderUnlock(payload);
    }
  }
}

function broadcastRealtime(eventName, data) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  const packet = {
    topic: `realtime:anlock_${state.machineId}`,
    event: 'broadcast',
    payload: {
      type: 'broadcast',
      event: eventName,
      payload: {
        ...data,
        machineId: state.machineId,
        hostname: state.hostname,
        timestamp: Date.now()
      }
    },
    ref: 'pc_msg_' + Date.now()
  };
  state.ws.send(JSON.stringify(packet));
}

// Remote Lock Trigger (LockWorkStation)
function executeLockWorkStation() {
  addLog('Executing Windows LockWorkStation()...');
  exec('rundll32.exe user32.dll,LockWorkStation', (err) => {
    if (err) {
      addLog(`Lock command error: ${err.message}`);
    } else {
      addLog('PC Locked successfully via remote mobile command.');
      broadcastRealtime('remote_lock_ack', { status: 'LOCKED' });
    }
  });
}

// ==========================================================================
// 2. WINDOWS NAMED PIPE IPC (For AnlockCredentialProvider.dll)
// ==========================================================================
let activePipeConnections = [];

function startNamedPipeServer() {
  try {
    const server = net.createServer((stream) => {
      addLog('Windows Logon Credential Provider connected via Named Pipe!');
      activePipeConnections.push(stream);

      // When Windows lock screen appears, trigger mobile unlock prompt!
      broadcastRealtime('unlock_prompt', {
        program: 'Windows Logon / Lock Screen',
        user: state.username,
        device: state.hostname,
        nonce: crypto.randomBytes(16).toString('hex')
      });
      addLog('Sent unlock prompt notification to phone.');

      stream.on('data', (data) => {
        addLog(`Named Pipe data received: ${data.toString()}`);
      });

      stream.on('end', () => {
        activePipeConnections = activePipeConnections.filter(c => c !== stream);
      });
    });

    server.listen(CONFIG.pipeName, () => {
      addLog(`Windows Named Pipe IPC Server listening at ${CONFIG.pipeName}`);
    });

    server.on('error', (err) => {
      addLog(`Named Pipe error (may require Admin for pipe creation): ${err.message}`);
    });
  } catch (e) {
    console.error('Pipe server start failed', e);
  }
}

function notifyCredentialProviderUnlock(payload) {
  const jsonPayload = JSON.stringify(payload) + '\n';
  activePipeConnections.forEach(conn => {
    try {
      conn.write(jsonPayload);
      addLog('Forwarded unlock authorization to Windows Logon UI!');
    } catch (e) {
      console.error('Failed writing to pipe', e);
    }
  });
}

// ==========================================================================
// 3. LOCAL DESKTOP GUI & REST SERVER (Matching Iconly Style)
// ==========================================================================
const htmlInterface = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Anlock Desktop — Windows Companion</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/cal-sans@5.0.0/index.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-page: #EFF1F5;
      --bg-card: #FFFFFF;
      --text-main: #111827;
      --text-muted: #6B7280;
      --accent: #2563EB;
      --accent-gradient: linear-gradient(180deg, #3B82F6 0%, #1D4ED8 100%);
      --accent-light: #EFF6FF;
      --font-heading: 'Cal Sans', sans-serif;
      --font-body: 'Inter', sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-page);
      color: var(--text-main);
      font-family: var(--font-body);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 30px;
    }
    .desktop-card {
      background: var(--bg-card);
      width: 100%;
      max-width: 520px;
      border-radius: 28px;
      padding: 32px;
      box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.08);
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand-title {
      font-family: var(--font-heading);
      font-size: 1.4rem;
      font-weight: 700;
    }
    .status-badge {
      font-size: 0.75rem;
      font-weight: 600;
      color: #059669;
      background: #ECFDF5;
      border: 1px solid #A7F3D0;
      padding: 4px 10px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #059669; }
    .qr-zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 16px;
      padding: 24px;
      background: #F8F9FA;
      border-radius: 20px;
      border: 1px solid rgba(0, 0, 0, 0.04);
    }
    .qr-image {
      width: 220px;
      height: 220px;
      border-radius: 14px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
    }
    .qr-instructions {
      font-size: 0.88rem;
      color: var(--text-muted);
      max-width: 340px;
    }
    .code-chip {
      font-family: 'JetBrains Mono', monospace;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
      background: var(--accent-light);
      padding: 6px 14px;
      border-radius: 12px;
      letter-spacing: 0.1em;
    }
    .action-btn {
      width: 100%;
      padding: 14px;
      border-radius: 16px;
      background: var(--accent-gradient);
      color: #FFFFFF;
      border: none;
      font-family: var(--font-heading);
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 24px -4px rgba(37, 99, 235, 0.35);
      transition: transform 0.15s ease;
    }
    .action-btn:hover { transform: translateY(-2px); }
    .secondary-btn {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      color: var(--text-main);
      box-shadow: none;
    }
    .secondary-btn:hover { background: #F9FAFB; }
    .btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .telemetry-box {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      background: #111827;
      color: #38BDF8;
      border-radius: 14px;
      padding: 12px 14px;
      max-height: 120px;
      overflow-y: auto;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="desktop-card">
    <div class="header-row">
      <h1 class="brand-title">Anlock Desktop</h1>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span id="txtStatus">Supabase Active</span>
      </div>
    </div>

    <div class="qr-zone">
      <img src="{{QR_DATA_URL}}" class="qr-image" alt="Pairing QR Code">
      <p class="qr-instructions">
        Open <strong>https://anlock.dpdns.org</strong> on your phone and scan this code to link your PC.
      </p>
      <div class="code-chip">CODE: {{PAIR_CODE}}</div>
    </div>

    <div class="btn-row">
      <button class="action-btn" onclick="testLock()">Lock PC Now</button>
      <button class="action-btn secondary-btn" onclick="testPrompt()">Test Phone Prompt</button>
    </div>

    <div class="telemetry-box" id="telemetryStream">
      {{LOGS}}
    </div>
  </div>

  <script>
    function testLock() {
      fetch('/api/lock', { method: 'POST' }).then(() => alert('PC Locked!'));
    }
    function testPrompt() {
      fetch('/api/prompt', { method: 'POST' }).then(() => alert('Unlock prompt dispatched to phone!'));
    }
    // Auto refresh logs
    setInterval(() => {
      fetch('/api/status').then(r => r.json()).then(data => {
        document.getElementById('telemetryStream').innerHTML = data.logs.join('<br>');
      });
    }, 2500);
  </script>
</body>
</html>`;

function startHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      let page = htmlInterface
        .replace('{{QR_DATA_URL}}', state.qrDataUrl)
        .replace('{{PAIR_CODE}}', state.currentPairCode)
        .replace('{{LOGS}}', state.telemetryLogs.join('<br>'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page);
    } else if (req.method === 'GET' && req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        connected: state.wsConnected,
        hostname: state.hostname,
        logs: state.telemetryLogs
      }));
    } else if (req.method === 'POST' && req.url === '/api/lock') {
      executeLockWorkStation();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === 'POST' && req.url === '/api/prompt') {
      broadcastRealtime('unlock_prompt', {
        program: 'Anlock Desktop Test',
        user: state.username,
        device: state.hostname,
        nonce: crypto.randomBytes(16).toString('hex')
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(CONFIG.desktopPort, () => {
    addLog(`Anlock Desktop Companion running at http://localhost:${CONFIG.desktopPort}`);
  });
}

// Initialize System
async function main() {
  console.log('Starting Anlock Desktop Companion...');
  await generatePairingQR();
  connectSupabase();
  startNamedPipeServer();
  startHttpServer();
}

main();
