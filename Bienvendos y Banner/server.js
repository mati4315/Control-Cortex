const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const socketIo = require('socket.io');
const multer = require('multer');
const { OBSWebSocket } = require('obs-websocket-js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 9344;
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit for video/audio
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/banner', express.static(path.join(__dirname, 'banner')));

// Default Settings
const defaultSettings = {
  badgeText: "🔴 EN VIVO PRONTO",
  headerText: "STREAM COMENZANDO",
  titleText: "Empezamos Pronto",
  subtitleText: "Prepara tu café, ya casi empezamos...",
  countdownTime: 300, // 5 minutes in seconds
  primaryColor: "#00f0ff", // Neon Cyan
  secondaryColor: "#bd00ff", // Neon Violet
  glowColor: "#00f0ff",
  backgroundColor: "#080710",
  fontFamily: "Orbitron",
  socials: [
    { id: "twitch", platform: "twitch", handle: "/tucanaltwitch", visible: true },
    { id: "youtube", platform: "youtube", handle: "/tucanal", visible: true },
    { id: "twitter", platform: "twitter", handle: "@tuusuario", visible: true }
  ],
  backgroundType: "particles", // particles, video, image, gradient
  backgroundUrl: "",
  logoUrl: "",
  logoVisible: true,
  musicEnabled: false,
  musicUrl: "",
  musicVolume: 0.5,
  particlesColor: "#00f0ff",
  particlesCount: 120,
  particlesSpeed: 1.5,
  particlesGlow: true,
  animationPreset: "neon-glow",
  // Alert Integration Settings
  alertsEnabled: true,
  alertFollower: "Matias4315",
  alertSubscriber: "JuanStreamer",
  alertDonation: "$10.00 de Pedro",
  alertCustom: "¡Usa el código STREAM en la tienda!",
  transitionState: "visible",
  // OBS Integration Settings
  obsHost: "127.0.0.1",
  obsPort: 4455,
  obsPassword: "",
  obsScene: "Main Scene",
  obsAutoTransition: false
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSettings(candidate = {}) {
  const merged = { ...defaultSettings, ...candidate };

  const countdownTime = Number.parseInt(merged.countdownTime, 10);
  const particlesCount = Number.parseInt(merged.particlesCount, 10);
  const particlesSpeed = Number.parseFloat(merged.particlesSpeed);
  const musicVolume = Number.parseFloat(merged.musicVolume);
  const obsPort = Number.parseInt(merged.obsPort, 10);

  merged.countdownTime = Number.isFinite(countdownTime) ? clamp(countdownTime, 1, 24 * 60 * 60) : defaultSettings.countdownTime;
  merged.particlesCount = Number.isFinite(particlesCount) ? clamp(particlesCount, 20, 250) : defaultSettings.particlesCount;
  merged.particlesSpeed = Number.isFinite(particlesSpeed) ? clamp(particlesSpeed, 0.2, 5) : defaultSettings.particlesSpeed;
  merged.musicVolume = Number.isFinite(musicVolume) ? clamp(musicVolume, 0, 1) : defaultSettings.musicVolume;
  merged.obsPort = Number.isFinite(obsPort) ? clamp(obsPort, 1, 65535) : defaultSettings.obsPort;
  merged.logoVisible = merged.logoVisible !== false;
  merged.musicEnabled = merged.musicEnabled === true;
  merged.particlesGlow = merged.particlesGlow !== false;
  merged.obsAutoTransition = merged.obsAutoTransition === true;
  merged.socials = Array.isArray(merged.socials)
    ? merged.socials.map((social, index) => ({
        id: social && social.id ? String(social.id) : `${(social && social.platform) || 'custom'}-${index}`,
        platform: social && social.platform ? String(social.platform) : 'custom',
        handle: social && typeof social.handle === 'string' ? social.handle : '',
        visible: social ? social.visible !== false : true
      }))
    : defaultSettings.socials.map((social) => ({ ...social }));

  return merged;
}

// Load settings
let settings = { ...defaultSettings };
if (fs.existsSync(SETTINGS_FILE)) {
  try {
    const rawData = fs.readFileSync(SETTINGS_FILE);
    settings = normalizeSettings(JSON.parse(rawData));
  } catch (err) {
    console.error('Error loading settings, using defaults:', err);
    settings = { ...defaultSettings };
  }
} else {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

let saveSettingsChain = Promise.resolve();

// Save settings helper
function saveSettings() {
  const snapshot = JSON.stringify(settings, null, 2);
  saveSettingsChain = saveSettingsChain
    .catch(() => {})
    .then(() => fsp.writeFile(SETTINGS_FILE, snapshot));
  return saveSettingsChain.catch((err) => {
    console.error('Error saving settings to file:', err);
    throw err;
  });
}

function updateSettings(nextSettings = {}) {
  settings = normalizeSettings({ ...settings, ...nextSettings });
  return saveSettings();
}

function emitSettingsUpdated() {
  io.emit('settingsUpdated', settings);
}

function emitTimerState(action, value = timerState.secondsRemaining) {
  io.emit('timerCommand', {
    action,
    value,
    totalDuration: timerState.totalDuration
  });
}

// Timer State (Server-side tracking)
let timerState = {
  secondsRemaining: settings.countdownTime || 300,
  totalDuration: settings.countdownTime || 300,
  isRunning: false,
  lastUpdated: Date.now()
};

let serverTimerInterval = null;

// OBS WebSocket Client
const obs = new OBSWebSocket();
let obsConnected = false;
let obsConnecting = false;

// Register listeners for OBS events
obs.on('ConnectionClosed', () => {
  console.log('[-] OBS WebSocket connection closed');
  obsConnected = false;
  io.emit('obsStatus', { connected: false });
});

obs.on('ConnectionError', (err) => {
  console.error('[-] OBS WebSocket connection error:', err);
  obsConnected = false;
  io.emit('obsStatus', { connected: false, error: err.message || String(err) });
});

async function connectToOBS(force = false) {
  if (obsConnecting) return;
  if (obsConnected && !force) return;

  const host = settings.obsHost || '127.0.0.1';
  const port = settings.obsPort || 4455;
  const password = settings.obsPassword || '';

  obsConnecting = true;
  obsConnected = false;
  io.emit('obsStatus', { connected: false, connecting: true });

  try {
    try {
      await obs.disconnect();
    } catch (e) {
      // ignore
    }

    const url = `ws://${host}:${port}`;
    console.log(`[OBS] Connecting to OBS WebSocket at ${url}...`);
    await obs.connect(url, password || undefined);
    obsConnected = true;
    console.log('[OBS] Successfully connected to OBS WebSocket!');
    io.emit('obsStatus', { connected: true });
  } catch (err) {
    console.error('[OBS] Failed to connect to OBS WebSocket:', err.message || err);
    obsConnected = false;
    io.emit('obsStatus', { connected: false, error: err.message || String(err) });
  } finally {
    obsConnecting = false;
  }
}

async function triggerOBSTransition(senderSocket = null) {
  if (!obsConnected) {
    console.error('[OBS] Cannot transition: Not connected to OBS');
    const result = { success: false, error: 'No conectado a OBS WebSocket. Verifica la configuración.' };
    if (senderSocket) {
      senderSocket.emit('obsTransitionResult', result);
    } else {
      io.emit('obsTransitionResult', result);
    }
    return;
  }

  const sceneName = settings.obsScene || 'Main Scene';
  console.log(`[OBS] Switching current program scene to "${sceneName}"...`);
  try {
    await obs.call('SetCurrentProgramScene', { sceneName: sceneName });
    const result = { success: true, sceneName };
    if (senderSocket) {
      senderSocket.emit('obsTransitionResult', result);
    } else {
      io.emit('obsTransitionResult', result);
    }
    console.log(`[OBS] Scene transition to "${sceneName}" completed successfully.`);
  } catch (err) {
    console.error('[OBS] Failed to set current program scene:', err.message || err);
    const result = { success: false, error: err.message || String(err) };
    if (senderSocket) {
      senderSocket.emit('obsTransitionResult', result);
    } else {
      io.emit('obsTransitionResult', result);
    }
  }
}

function syncTimerFromNow() {
  if (!timerState.isRunning) {
    return timerState.secondsRemaining;
  }

  const now = Date.now();
  const elapsed = Math.floor((now - timerState.lastUpdated) / 1000);
  if (elapsed > 0) {
    timerState.secondsRemaining = Math.max(0, timerState.secondsRemaining - elapsed);
    timerState.lastUpdated = now;
  }

  return timerState.secondsRemaining;
}

function startServerTimer() {
  if (serverTimerInterval) clearInterval(serverTimerInterval);
  
  serverTimerInterval = setInterval(() => {
    if (!timerState.isRunning) {
      clearInterval(serverTimerInterval);
      serverTimerInterval = null;
      return;
    }
    
    const now = Date.now();
    const elapsed = Math.floor((now - timerState.lastUpdated) / 1000);
    
    if (elapsed >= 1) {
      timerState.secondsRemaining = Math.max(0, timerState.secondsRemaining - elapsed);
      timerState.lastUpdated = now;
      
      if (timerState.secondsRemaining <= 0) {
        timerState.isRunning = false;
        clearInterval(serverTimerInterval);
        serverTimerInterval = null;
        
        console.log('[Timer] Countdown finished on server!');
        
        if (settings.obsAutoTransition) {
          console.log('[Timer] Auto-transition is enabled. Switching OBS scene.');
          triggerOBSTransition();
        }
        
        emitTimerState('sync', 0);
      } else {
        emitTimerState('sync', timerState.secondsRemaining);
      }
    }
  }, 1000);
}

function handleUploadedAsset(req, res, fieldName, settingsKey, extraUpdates = {}) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const assetUrl = `/uploads/${req.file.filename}`;
  updateSettings({
    [settingsKey]: assetUrl,
    ...extraUpdates
  })
    .then(() => {
      emitSettingsUpdated();
      res.json({ success: true, url: assetUrl });
    })
    .catch((err) => {
      console.error(`Error saving uploaded ${fieldName}:`, err);
      res.status(500).json({ error: 'Failed to save uploaded file' });
    });
}

// Router paths
app.get('/overlay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

app.get('/starting-soon', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/banner', (req, res) => {
  res.sendFile(path.join(__dirname, 'banner', 'index.html'));
});

app.get('/banner/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'banner', 'dashboard.html'));
});

// APIs for uploading files
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  handleUploadedAsset(req, res, 'logo', 'logoUrl');
});

app.post('/api/upload-bg-video', upload.single('bgVideo'), (req, res) => {
  handleUploadedAsset(req, res, 'bgVideo', 'backgroundUrl', { backgroundType: 'video' });
});

app.post('/api/upload-bg-image', upload.single('bgImage'), (req, res) => {
  handleUploadedAsset(req, res, 'bgImage', 'backgroundUrl', { backgroundType: 'image' });
});

app.post('/api/upload-bg-music', upload.single('bgMusic'), (req, res) => {
  handleUploadedAsset(req, res, 'bgMusic', 'musicUrl', { musicEnabled: true });
});

app.get('/api/settings', (req, res) => {
  res.json(settings);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current settings to newly connected client
  socket.emit('initSettings', settings);

  // Send current OBS connection status to newly connected client
  socket.emit('obsStatus', { connected: obsConnected, connecting: obsConnecting });

  // Send current timer state to newly connected client immediately
  const currentRemaining = syncTimerFromNow();
  socket.emit('timerCommand', {
    action: timerState.isRunning ? 'start' : 'sync',
    value: currentRemaining,
    totalDuration: timerState.totalDuration
  });

  // Handle configuration updates from admin dashboard
  socket.on('updateSettings', (newSettings) => {
    const previousSettings = settings;
    const obsSettingsChanged = 
      (newSettings.obsHost !== undefined && newSettings.obsHost !== previousSettings.obsHost) ||
      (newSettings.obsPort !== undefined && newSettings.obsPort !== previousSettings.obsPort) ||
      (newSettings.obsPassword !== undefined && newSettings.obsPassword !== previousSettings.obsPassword);

    updateSettings(newSettings).then(() => {
      emitSettingsUpdated();
    });
    
    // If the countdown time changed, update the timer state if it's not running
    if (newSettings.countdownTime !== undefined && !timerState.isRunning) {
      const countdownTime = settings.countdownTime || defaultSettings.countdownTime;
      timerState.secondsRemaining = countdownTime;
      timerState.totalDuration = countdownTime;
      timerState.lastUpdated = Date.now();
    }

    // If OBS connection settings changed, reconnect
    if (obsSettingsChanged) {
      connectToOBS(true).catch(err => console.error('OBS settings change reconnection failed:', err));
    }
  });

  // Handle countdown commands
  socket.on('controlTimer', (command) => {
    const now = Date.now();
    
    // Calculate actual remaining time if it was running before updating state
    if (timerState.isRunning) {
      syncTimerFromNow();
    }
    
    switch (command.action) {
      case 'start':
        timerState.isRunning = true;
        if (command.value !== undefined) {
          timerState.secondsRemaining = command.value;
        }
        if (command.totalDuration !== undefined) {
          timerState.totalDuration = command.totalDuration;
        } else if (!timerState.totalDuration || timerState.totalDuration <= 0) {
          timerState.totalDuration = settings.countdownTime || 300;
        }
        timerState.lastUpdated = now;
        startServerTimer();
        break;
      case 'pause':
        timerState.isRunning = false;
        timerState.lastUpdated = now;
        if (serverTimerInterval) {
          clearInterval(serverTimerInterval);
          serverTimerInterval = null;
        }
        break;
      case 'reset':
        timerState.isRunning = false;
        timerState.secondsRemaining = settings.countdownTime || defaultSettings.countdownTime;
        timerState.totalDuration = settings.countdownTime || defaultSettings.countdownTime;
        timerState.lastUpdated = now;
        if (serverTimerInterval) {
          clearInterval(serverTimerInterval);
          serverTimerInterval = null;
        }
        break;
      case 'sync':
        if (command.value !== undefined) {
          timerState.secondsRemaining = command.value;
        }
        if (command.totalDuration !== undefined) {
          timerState.totalDuration = command.totalDuration;
        }
        timerState.lastUpdated = now;
        break;
    }
    
    // Broadcast updated timer state to all clients
    emitTimerState(command.action, timerState.secondsRemaining);
  });

  // Test OBS Connection manually from admin panel
  socket.on('testObsConnection', async () => {
    console.log('[OBS] Manual connection test requested.');
    await connectToOBS(true);
    socket.emit('obsTestResult', { connected: obsConnected });
  });

  // Trigger manual OBS scene switch
  socket.on('triggerObsTransition', async () => {
    console.log('[OBS] Manual transition requested.');
    await triggerOBSTransition(socket);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`OBS Starting Soon Overlay running locally!`);
  console.log(`OVERLAY URL: http://localhost:${PORT}/starting-soon`);
  console.log(`ADMIN DASHBOARD: http://localhost:${PORT}/admin`);
  console.log(`====================================================`);

  // Connect to OBS WebSocket on startup
  setTimeout(() => {
    connectToOBS().catch(err => console.error('Startup OBS connection failed:', err));
  }, 1000);
});
