const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pm2 = require('pm2');
const os = require('os');
const { OBSWebSocket } = require('obs-websocket-js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
let latestSpotifyOverlay = null;
let latestRuloBotMessage = null;
const ruloChatItems = [];

// Carga de .env local (sin dependencias): KEY=VALUE, ignora comentarios y lineas vacias.
function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    let loaded = 0;
    for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = value;
      loaded += 1;
    }
    return loaded;
  } catch (error) {
    console.warn('[Cortex] No se pudo leer .env:', error.message);
    return 0;
  }
}
const ENV_VARS_LOADED = loadEnvFile(path.join(__dirname, '.env'));

// OBS WebSocket Config (PC del OBS). Las credenciales viven en Control Cortex/backend/.env.
const OBS_CONFIG = {
  url: process.env.OBS_WS_URL || 'ws://192.168.4.45:4455',
  password: process.env.OBS_WS_PASSWORD || ''
};
if (!OBS_CONFIG.password) {
  console.warn('[Cortex] Falta OBS_WS_PASSWORD en .env: el control de OBS no va a poder conectarse.');
}

// CPU Usage calculation helper functions
let lastCpuInfo = getCpuTimes();

function getCpuTimes() {
  const cpus = os.cpus();
  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;

  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }

  const total = user + nice + sys + idle + irq;
  return { idle, total };
}

function getCpuUsagePercentage() {
  const current = getCpuTimes();
  const idleDiff = current.idle - lastCpuInfo.idle;
  const totalDiff = current.total - lastCpuInfo.total;
  
  lastCpuInfo = current;

  if (totalDiff === 0) return 0;
  return Math.round(100 - (100 * idleDiff / totalDiff));
}

const PORT = process.env.PORT || 4000;

// Rulo centralizado: una sola URL base, un solo session id y un solo limite de historial.
const RULO_SESSION_ID = process.env.RULO_SESSION_ID || 'XJ9hQ2JDHH';
const RULO_HISTORY_LIMIT = 200;
const RULO_HISTORY_BROADCAST_LIMIT = 50;
const RULO_MOODS = ['idle', 'thinking', 'success', 'warning', 'error', 'speaking'];

function detectLanBaseUrl(port) {
  if (process.env.CORTEX_BASE_URL) return String(process.env.CORTEX_BASE_URL).replace(/\/+$/, '');
  let fallback = '';
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const entry of interfaces[name] || []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        if (/^169\.254\./.test(entry.address)) continue;
        if (/^192\.168\.4\./.test(entry.address)) return `http://${entry.address}:${port}`;
        if (!fallback) fallback = `http://${entry.address}:${port}`;
      }
    }
  } catch (error) {
    console.warn('[Cortex] No se pudo detectar la IP LAN:', error.message);
  }
  return fallback || `http://127.0.0.1:${port}`;
}

const CORTEX_BASE_URL = detectLanBaseUrl(PORT);
const SERVICES_JSON_PATH = path.join(__dirname, 'services.json');
const SPOTIFY_DEVICE_TARGET_PATH = path.join(__dirname, 'spotify-device-target.json');
const SPOTIFY_PLAYBACK_OFFSET_PATH = path.join(__dirname, 'spotify-playback-offset.json');
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const RULO_CONFIG_PATH = path.join(WORKSPACE_ROOT, 'Rulo', 'rulo-config.json');
const RULO_HISTORY_PATH = path.join(WORKSPACE_ROOT, 'Rulo', 'rulo-chat-history.json');
const DEFAULT_RULO_CONFIG = {
  botName: 'Rulo',
  accent: '#9fd50b',
  avatarLetter: 'A',
  visibleMs: 12000,
  maxWidth: 760,
  fontSize: 1.35,
  panelOpacity: 0.94,
  showRequester: true,
  showMascot: false,
  // Tema del overlay para OBS: 'dark' (por defecto) o 'light'.
  overlayTheme: 'dark',
  animation: 'slide'
};
let ruloConfig = { ...DEFAULT_RULO_CONFIG };
try {
  if (fs.existsSync(RULO_CONFIG_PATH)) {
    ruloConfig = { ...DEFAULT_RULO_CONFIG, ...JSON.parse(fs.readFileSync(RULO_CONFIG_PATH, 'utf8')) };
  }
} catch (error) {
  console.warn('[Rulo] No se pudo leer la configuracion:', error.message);
}

// Historial de Rulo: sobrevive a los reinicios del backend.
try {
  if (fs.existsSync(RULO_HISTORY_PATH)) {
    const savedHistory = JSON.parse(fs.readFileSync(RULO_HISTORY_PATH, 'utf8'));
    if (Array.isArray(savedHistory)) {
      savedHistory.slice(-RULO_HISTORY_LIMIT).forEach(item => {
        if (item && item.id && item.comment) ruloChatItems.push(item);
      });
      console.log(`[Rulo] Historial restaurado: ${ruloChatItems.length} comentarios.`);
    }
  }
} catch (error) {
  console.warn('[Rulo] No se pudo leer el historial:', error.message);
}

let ruloHistorySaveTimer = null;
function saveRuloHistory() {
  clearTimeout(ruloHistorySaveTimer);
  ruloHistorySaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(RULO_HISTORY_PATH), { recursive: true });
      fs.writeFileSync(RULO_HISTORY_PATH, JSON.stringify(ruloChatItems.slice(-RULO_HISTORY_LIMIT), null, 2), 'utf8');
    } catch (error) {
      console.warn('[Rulo] No se pudo guardar el historial:', error.message);
    }
  }, 400);
}

function ruloPublicHistory() {
  return ruloChatItems.slice(-RULO_HISTORY_BROADCAST_LIMIT);
}

// --- Ajustes de Spotify: fuente unica de verdad ---
// Viven en Rulo/Spotify/spotify-settings.json y los consume el modulo
// spotify-auto-music.js de SocialStream Ninja (via /api/spotify-client-state).
const SPOTIFY_DIR = path.join(WORKSPACE_ROOT, 'Rulo', 'Spotify');
const SPOTIFY_SETTINGS_PATH = path.join(SPOTIFY_DIR, 'spotify-settings.json');
const SPOTIFY_REQUEST_LOG_PATH = path.join(SPOTIFY_DIR, 'spotify-request-log.json');
const SPOTIFY_DEVICES_PATH = path.join(SPOTIFY_DIR, 'spotify-devices.json');
const SPOTIFY_ALIASES_PATH = path.join(SPOTIFY_DIR, 'spotify-aliases.json');
const SPOTIFY_REQUEST_LOG_LIMIT = 50;
const SPOTIFY_COMMAND_TTL_MS = 120000;
const DEFAULT_SPOTIFY_SETTINGS = {
  enabled: true,             // pedidos de musica por chat
  testMode: false,           // modo prueba: ignora las esperas
  cooldownSeconds: 40,       // espera global entre pedidos
  userCooldownSeconds: 120,  // espera por usuario
  minTextLength: 8,          // largo minimo del comentario para analizarlo
  requireCommand: false,     // solo !playnow / !tema / !musica
  personalize: true,         // "Listo Mati, ya se esta reproduciendo..."
  announce: true,            // avisos del bot en el overlay de Rulo
  autoContinue: true,        // encolar temas similares para no cortar
  skipEnabled: false,        // arrancar en el segundo N y cortar el final
  skipSeconds: 10,
  pollSeconds: 4,            // cada cuanto consulta la extension los comandos del dashboard
  deviceTargetName: ''       // vacio = dispositivo automatico
};

function clampSpotifyNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeSpotifySettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (key, fallback) => (source[key] === undefined ? fallback : source[key]);
  return {
    enabled: pick('enabled', true) !== false,
    testMode: pick('testMode', false) === true,
    cooldownSeconds: clampSpotifyNumber(pick('cooldownSeconds', 40), 40, 0, 3600),
    userCooldownSeconds: clampSpotifyNumber(pick('userCooldownSeconds', 120), 120, 0, 7200),
    minTextLength: clampSpotifyNumber(pick('minTextLength', 8), 8, 3, 120),
    requireCommand: pick('requireCommand', false) === true,
    personalize: pick('personalize', true) !== false,
    announce: pick('announce', true) !== false,
    autoContinue: pick('autoContinue', true) !== false,
    skipEnabled: pick('skipEnabled', false) === true,
    skipSeconds: clampSpotifyNumber(pick('skipSeconds', 10), 10, 1, 120),
    pollSeconds: clampSpotifyNumber(pick('pollSeconds', 4), 4, 1, 15),
    deviceTargetName: String(pick('deviceTargetName', '') || '').trim().slice(0, 120)
  };
}

// Los dos archivos viejos siguen existiendo por compatibilidad: se leen una vez
// para migrar y despues se mantienen como espejo de solo escritura.
function readLegacySpotifySettings() {
  const legacy = {};
  try {
    if (fs.existsSync(SPOTIFY_DEVICE_TARGET_PATH)) {
      const savedTarget = JSON.parse(fs.readFileSync(SPOTIFY_DEVICE_TARGET_PATH, 'utf8'));
      legacy.deviceTargetName = String(savedTarget?.deviceName || '').trim();
    }
  } catch (error) {
    console.warn('[Spotify] No se pudo leer el destino guardado:', error.message);
  }
  try {
    if (fs.existsSync(SPOTIFY_PLAYBACK_OFFSET_PATH)) {
      const savedOffset = JSON.parse(fs.readFileSync(SPOTIFY_PLAYBACK_OFFSET_PATH, 'utf8'));
      legacy.skipEnabled = savedOffset?.enabled === true;
      const savedSeconds = Number(savedOffset?.seconds);
      if (Number.isFinite(savedSeconds) && savedSeconds > 0) legacy.skipSeconds = Math.min(120, Math.round(savedSeconds));
    }
  } catch (error) {
    console.warn('[Spotify] No se pudo leer el ajuste de salto:', error.message);
  }
  return legacy;
}

let spotifySettings = { ...DEFAULT_SPOTIFY_SETTINGS };
let spotifyDeviceTargetName = '';
let spotifyPlaybackOffsetEnabled = false;
let spotifyPlaybackOffsetSeconds = 10;
// Estado del cliente (extension SocialStream Ninja) y cola de comandos del dashboard.
let spotifyClientStatus = { lastSeenAt: 0, version: '', hasToken: false };
let spotifyDevicesSnapshot = { devices: [], activeName: '', updatedAt: 0 };
const spotifyCommandQueue = [];
const spotifyRequestLog = [];
// Correcciones de escritura aprendidas: "laberiso" -> "la beriso".
let spotifyAliases = {};
let spotifyRequestLogSaveTimer = null;

function writeSpotifySettingsFile() {
  fs.mkdirSync(SPOTIFY_DIR, { recursive: true });
  fs.writeFileSync(SPOTIFY_SETTINGS_PATH, JSON.stringify(spotifySettings, null, 2), 'utf8');
}

function mirrorLegacySpotifySettings() {
  try {
    fs.writeFileSync(SPOTIFY_DEVICE_TARGET_PATH, JSON.stringify({ deviceName: spotifySettings.deviceTargetName }, null, 2), 'utf8');
    fs.writeFileSync(
      SPOTIFY_PLAYBACK_OFFSET_PATH,
      JSON.stringify({ enabled: spotifySettings.skipEnabled, seconds: spotifySettings.skipSeconds }, null, 2),
      'utf8'
    );
  } catch (error) {
    console.warn('[Spotify] No se pudieron espejar los ajustes viejos:', error.message);
  }
}

function applySpotifySettings() {
  spotifyDeviceTargetName = spotifySettings.deviceTargetName;
  spotifyPlaybackOffsetEnabled = spotifySettings.skipEnabled;
  spotifyPlaybackOffsetSeconds = spotifySettings.skipSeconds;
}

function saveSpotifySettings(nextSettings) {
  spotifySettings = normalizeSpotifySettings(nextSettings);
  applySpotifySettings();
  writeSpotifySettingsFile();
  mirrorLegacySpotifySettings();
  broadcast({ type: 'spotify_settings', settings: spotifySettings });
  // La extension tambien recibe los ajustes al instante por su WebSocket.
  pushToSpotifyClients({ type: 'spotify_settings', settings: spotifySettings });
  return spotifySettings;
}

function saveSpotifyRequestLog() {
  clearTimeout(spotifyRequestLogSaveTimer);
  spotifyRequestLogSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(SPOTIFY_DIR, { recursive: true });
      fs.writeFileSync(SPOTIFY_REQUEST_LOG_PATH, JSON.stringify(spotifyRequestLog.slice(-SPOTIFY_REQUEST_LOG_LIMIT), null, 2), 'utf8');
    } catch (error) {
      console.warn('[Spotify] No se pudo guardar el registro de pedidos:', error.message);
    }
  }, 400);
}

// Correcciones de escritura aprendidas ("laberiso" -> "la beriso"): las carga
// el modulo de la extension y las aprende solo cuando una variante funciona.
function saveSpotifyAliases() {
  try {
    fs.mkdirSync(SPOTIFY_DIR, { recursive: true });
    fs.writeFileSync(SPOTIFY_ALIASES_PATH, JSON.stringify(spotifyAliases, null, 2), 'utf8');
  } catch (error) {
    console.warn('[Spotify] No se pudieron guardar las correcciones:', error.message);
  }
}

function learnSpotifyAlias(from, to, meta) {
  const key = String(from || '').trim().toLowerCase().slice(0, 60);
  const value = String(to || '').trim().toLowerCase().slice(0, 60);
  if (!key || !value || key === value) return null;
  spotifyAliases[key] = value;
  const keys = Object.keys(spotifyAliases);
  if (keys.length > 200) delete spotifyAliases[keys[0]];
  saveSpotifyAliases();
  pushToSpotifyClients({ type: 'spotify_aliases', aliases: spotifyAliases });
  console.log(`[Spotify] Correccion aprendida: "${key}" -> "${value}"`);
  return {
    from: key,
    to: value,
    artist: String(meta?.artist || '').slice(0, 120),
    track: String(meta?.track || '').slice(0, 120)
  };
}

function queueSpotifyCommand(command) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...command
  };
  spotifyCommandQueue.push(entry);
  while (spotifyCommandQueue.length > 20) spotifyCommandQueue.shift();
  // Empuje instantaneo si la extension esta conectada por WebSocket.
  pushToSpotifyClients({ type: 'spotify_command', command: entry, settings: spotifySettings });
  return entry;
}

function dequeueSpotifyCommand() {
  const now = Date.now();
  while (spotifyCommandQueue.length && now - spotifyCommandQueue[0].createdAt > SPOTIFY_COMMAND_TTL_MS) {
    spotifyCommandQueue.shift();
  }
  return spotifyCommandQueue.shift() || null;
}

function spotifySettingsPublic() {
  return {
    ...spotifySettings,
    // La espera efectiva: en modo prueba el modulo no aplica ninguna.
    effectiveCooldownSeconds: spotifySettings.testMode ? 0 : spotifySettings.cooldownSeconds,
    effectiveUserCooldownSeconds: spotifySettings.testMode ? 0 : spotifySettings.userCooldownSeconds
  };
}

try {
  if (fs.existsSync(SPOTIFY_SETTINGS_PATH)) {
    spotifySettings = normalizeSpotifySettings(JSON.parse(fs.readFileSync(SPOTIFY_SETTINGS_PATH, 'utf8')));
  } else {
    spotifySettings = normalizeSpotifySettings(readLegacySpotifySettings());
    writeSpotifySettingsFile();
    console.log('[Spotify] Ajustes creados en Rulo/Spotify/spotify-settings.json');
  }
} catch (error) {
  console.warn('[Spotify] No se pudieron leer los ajustes:', error.message);
  spotifySettings = { ...DEFAULT_SPOTIFY_SETTINGS };
}
applySpotifySettings();
mirrorLegacySpotifySettings();

try {
  if (fs.existsSync(SPOTIFY_REQUEST_LOG_PATH)) {
    const savedLog = JSON.parse(fs.readFileSync(SPOTIFY_REQUEST_LOG_PATH, 'utf8'));
    if (Array.isArray(savedLog)) savedLog.slice(-SPOTIFY_REQUEST_LOG_LIMIT).forEach(entry => {
      if (entry && entry.timestamp) spotifyRequestLog.push(entry);
    });
  }
} catch (error) {
  console.warn('[Spotify] No se pudo leer el registro de pedidos:', error.message);
}

try {
  if (fs.existsSync(SPOTIFY_DEVICES_PATH)) {
    const savedDevices = JSON.parse(fs.readFileSync(SPOTIFY_DEVICES_PATH, 'utf8'));
    if (savedDevices && Array.isArray(savedDevices.devices)) {
      spotifyDevicesSnapshot = {
        devices: savedDevices.devices,
        activeName: String(savedDevices.activeName || ''),
        updatedAt: Number(savedDevices.updatedAt) || 0
      };
    }
  }
} catch (error) {
  console.warn('[Spotify] No se pudo leer la lista de dispositivos:', error.message);
}

try {
  if (fs.existsSync(SPOTIFY_ALIASES_PATH)) {
    const savedAliases = JSON.parse(fs.readFileSync(SPOTIFY_ALIASES_PATH, 'utf8'));
    if (savedAliases && typeof savedAliases === 'object' && !Array.isArray(savedAliases)) {
      Object.keys(savedAliases).slice(0, 200).forEach(key => {
        const cleanKey = String(key || '').trim().toLowerCase().slice(0, 60);
        const cleanValue = String(savedAliases[key] || '').trim().slice(0, 60);
        if (cleanKey && cleanValue) spotifyAliases[cleanKey] = cleanValue;
      });
      console.log(`[Spotify] Correcciones de escritura cargadas: ${Object.keys(spotifyAliases).length}.`);
    }
  }
} catch (error) {
  console.warn('[Spotify] No se pudieron leer las correcciones:', error.message);
}


app.use(cors());
app.use(express.json());

app.get('/spotify-lyrics-overlay.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.get('/rulo-bot-overlay.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(WORKSPACE_ROOT, 'Rulo', 'rulo-bot-overlay.html'), error => {
    if (error) next(error);
  });
});

app.get('/rulo-dashboard.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(WORKSPACE_ROOT, 'Rulo', 'rulo-dashboard.html'), error => {
    if (error) next(error);
  });
});

app.get('/rulo-chat-historial.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(WORKSPACE_ROOT, 'Rulo', 'rulo-chat-historial.html'), error => {
    if (error) next(error);
  });
});

app.get('/rulo-chat-dock.html', (req, res) => {
  res.redirect(302, '/rulo-chat-historial.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
});

app.get('/rulo-mascota.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(WORKSPACE_ROOT, 'Rulo', 'rulo-mascota.html'), error => {
    if (error) next(error);
  });
});

// Dashboard de Spotify (pedidos de musica, esperas, dispositivo y pruebas).
app.get('/rulo-spotify.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(WORKSPACE_ROOT, 'Rulo', 'Spotify', 'spotify-dashboard.html'), error => {
    if (error) next(error);
  });
});

// Assets de la mascota (Rulo/assets).
app.use('/rulo-assets', express.static(path.join(WORKSPACE_ROOT, 'Rulo', 'assets')));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/api/spotify-device-target', (req, res) => {
  res.json({ deviceName: spotifyDeviceTargetName });
});

// Compatibilidad: el panel viejo sigue guardando por aca, pero el valor real
// vive en Rulo/Spotify/spotify-settings.json.
app.post('/api/spotify-device-target', (req, res) => {
  const deviceName = String(req.body?.deviceName || '').trim().slice(0, 120);
  try {
    const settings = saveSpotifySettings({ ...spotifySettings, deviceTargetName: deviceName });
    res.json({ ok: true, deviceName: settings.deviceTargetName });
  } catch (error) {
    console.error('[Spotify] No se pudo guardar el destino:', error);
    res.status(500).json({ ok: false, error: 'No se pudo guardar el destino de Spotify.' });
  }
});

app.get('/api/spotify-playback-offset', (req, res) => {
  res.json({ enabled: spotifyPlaybackOffsetEnabled, seconds: spotifyPlaybackOffsetSeconds });
});

app.post('/api/spotify-playback-offset', (req, res) => {
  const enabled = req.body?.enabled === true;
  const requestedSeconds = Number(req.body?.seconds);
  const seconds = Number.isFinite(requestedSeconds) && requestedSeconds > 0
    ? Math.min(120, Math.round(requestedSeconds))
    : 10;
  try {
    saveSpotifySettings({ ...spotifySettings, skipEnabled: enabled, skipSeconds: seconds });
    res.json({ ok: true, enabled, seconds });
  } catch (error) {
    console.error('[Spotify] No se pudo guardar el ajuste de salto:', error);
    res.status(500).json({ ok: false, error: 'No se pudo guardar el ajuste de salto.' });
  }
});

// --- Dashboard de Spotify (Rulo/Spotify) ---

app.get('/api/spotify-settings', (req, res) => {
  res.json({ ok: true, settings: spotifySettingsPublic(), defaults: DEFAULT_SPOTIFY_SETTINGS });
});

app.post('/api/spotify-settings', (req, res) => {
  const patch = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
  try {
    const settings = saveSpotifySettings({ ...spotifySettings, ...patch });
    console.log('[Spotify] Ajustes guardados desde el dashboard.');
    res.json({ ok: true, settings: spotifySettingsPublic() });
  } catch (error) {
    console.error('[Spotify] No se pudieron guardar los ajustes:', error);
    res.status(500).json({ ok: false, error: 'No se pudieron guardar los ajustes de Spotify.' });
  }
});

app.post('/api/spotify-settings-reset', (req, res) => {
  try {
    const keepDevice = req.body?.keepDeviceTarget !== false;
    const settings = saveSpotifySettings({
      ...DEFAULT_SPOTIFY_SETTINGS,
      deviceTargetName: keepDevice ? spotifySettings.deviceTargetName : ''
    });
    console.log('[Spotify] Ajustes restaurados a los valores por defecto.');
    res.json({ ok: true, settings: spotifySettingsPublic() });
  } catch (error) {
    console.error('[Spotify] No se pudieron restaurar los ajustes:', error);
    res.status(500).json({ ok: false, error: 'No se pudieron restaurar los ajustes de Spotify.' });
  }
});

// Poll del modulo spotify-auto-music.js: entrega los ajustes y, si hay,
// los comandos disparados desde el dashboard (probar pedido / transporte).
// Se entregan en lote: si el streamer toco tres botones seguidos, no espera
// una consulta por cada uno.
app.get('/api/spotify-client-state', (req, res) => {
  spotifyClientStatus = {
    lastSeenAt: Date.now(),
    version: String(req.query?.version || '').slice(0, 20),
    hasToken: req.query?.token === '1'
  };
  const commands = [];
  let next = dequeueSpotifyCommand();
  while (next && commands.length < 10) {
    commands.push(next);
    next = dequeueSpotifyCommand();
  }
  res.json({
    ok: true,
    settings: spotifySettings,
    aliases: spotifyAliases,
    command: commands[0] || null,
    commands,
    sessionId: RULO_SESSION_ID,
    serverTime: Date.now()
  });
});

// --- Correcciones de escritura ("laberiso" -> "la beriso") ---
app.get('/api/spotify-aliases', (req, res) => {
  res.json({ success: true, aliases: spotifyAliases, total: Object.keys(spotifyAliases).length });
});

app.post('/api/spotify-aliases', (req, res) => {
  const entry = learnSpotifyAlias(req.body?.from, req.body?.to, {
    artist: req.body?.artist,
    track: req.body?.track
  });
  if (!entry) return res.status(400).json({ success: false, error: 'Se necesitan "from" y "to" distintos.' });
  res.json({ success: true, entry, aliases: spotifyAliases });
});

app.post('/api/spotify-aliases-delete', (req, res) => {
  const key = String(req.body?.from || '').trim().toLowerCase();
  if (!key || !(key in spotifyAliases)) {
    return res.status(404).json({ success: false, error: 'No existe esa correccion.' });
  }
  delete spotifyAliases[key];
  saveSpotifyAliases();
  pushToSpotifyClients({ type: 'spotify_aliases', aliases: spotifyAliases });
  res.json({ success: true, aliases: spotifyAliases });
});

app.post('/api/spotify-aliases-clear', (req, res) => {
  spotifyAliases = {};
  saveSpotifyAliases();
  pushToSpotifyClients({ type: 'spotify_aliases', aliases: spotifyAliases });
  res.json({ success: true, aliases: spotifyAliases });
});

app.post('/api/spotify-test-request', (req, res) => {
  const query = String(req.body?.query || '').trim().slice(0, 200);
  if (query.length < 2) return res.status(400).json({ ok: false, error: 'Escribi un tema o artista para probar.' });
  // searchOnly: busca y muestra el resultado sin tocar la reproduccion.
  const searchOnly = req.body?.searchOnly === true;
  const command = queueSpotifyCommand({
    type: searchOnly ? 'search' : 'play',
    query,
    requester: String(req.body?.requester || 'Dashboard').trim().slice(0, 80) || 'Dashboard',
    via: 'dashboard'
  });
  console.log(`[Spotify] ${searchOnly ? 'Busqueda' : 'Prueba manual'} encolada: "${query}"`);
  res.json({ ok: true, command });
});

app.post('/api/spotify-transport', (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase();
  if (!['pause', 'resume', 'next', 'previous', 'devices'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'Accion de transporte invalida.' });
  }
  const command = queueSpotifyCommand({ type: action, via: 'dashboard' });
  res.json({ ok: true, command });
});

app.post('/api/spotify-request-log', (req, res) => {
  const body = req.body || {};
  const track = body.track && typeof body.track === 'object'
    ? {
        name: String(body.track.name || '').slice(0, 200),
        artist: String(body.track.artist || '').slice(0, 200),
        uri: String(body.track.uri || '').slice(0, 200)
      }
    : null;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: String(body.source || 'chat').slice(0, 20),
    requester: String(body.requester || '').slice(0, 80),
    query: String(body.query || '').slice(0, 200),
    ok: body.ok === true,
    message: String(body.message || '').slice(0, 300),
    track,
    timestamp: Date.now()
  };
  spotifyRequestLog.push(entry);
  while (spotifyRequestLog.length > SPOTIFY_REQUEST_LOG_LIMIT) spotifyRequestLog.shift();
  saveSpotifyRequestLog();
  broadcast({ type: 'spotify_request', entry });
  res.json({ success: true, entry });
});

app.post('/api/spotify-request-log-clear', (req, res) => {
  spotifyRequestLog.length = 0;
  clearTimeout(spotifyRequestLogSaveTimer);
  try {
    fs.writeFileSync(SPOTIFY_REQUEST_LOG_PATH, JSON.stringify([], null, 2), 'utf8');
  } catch (error) {
    console.warn('[Spotify] No se pudo vaciar el registro:', error.message);
  }
  broadcast({ type: 'spotify_request_cleared' });
  res.json({ success: true });
});

app.post('/api/spotify-devices-report', (req, res) => {
  const body = req.body || {};
  const devices = Array.isArray(body.devices)
    ? body.devices.slice(0, 25).map(device => ({
        name: String(device?.name || 'Sin nombre').slice(0, 120),
        type: String(device?.type || '').slice(0, 40),
        isActive: device?.isActive === true || device?.is_active === true,
        isRestricted: device?.isRestricted === true || device?.is_restricted === true,
        volumePercent: Number.isFinite(Number(device?.volumePercent ?? device?.volume_percent))
          ? Math.round(Number(device.volumePercent ?? device.volume_percent))
          : null
      }))
    : [];
  spotifyDevicesSnapshot = {
    devices,
    activeName: String(body.activeName || (devices.find(device => device.isActive)?.name) || '').slice(0, 120),
    updatedAt: Date.now()
  };
  try {
    fs.mkdirSync(SPOTIFY_DIR, { recursive: true });
    fs.writeFileSync(SPOTIFY_DEVICES_PATH, JSON.stringify(spotifyDevicesSnapshot, null, 2), 'utf8');
  } catch (error) {
    console.warn('[Spotify] No se pudo guardar la lista de dispositivos:', error.message);
  }
  broadcast({ type: 'spotify_devices', snapshot: spotifyDevicesSnapshot });
  res.json({ success: true });
});

app.get('/api/spotify-devices', (req, res) => {
  res.json({ success: true, ...spotifyDevicesSnapshot });
});

// Una sola llamada para el dashboard: ajustes, estado del cliente y registro.
app.get('/api/spotify-status', (req, res) => {
  const now = Date.now();
  const sinceClient = spotifyClientStatus.lastSeenAt ? now - spotifyClientStatus.lastSeenAt : null;
  res.json({
    ok: true,
    settings: spotifySettingsPublic(),
    defaults: DEFAULT_SPOTIFY_SETTINGS,
    client: {
      ...spotifyClientStatus,
      sinceLastSeenMs: sinceClient,
      connected: sinceClient !== null && sinceClient < 15000,
      // Enlace WebSocket activo = los comandos llegan al instante.
      push: spotifySockets.size > 0
    },
    devices: spotifyDevicesSnapshot,
    log: spotifyRequestLog.slice(-SPOTIFY_REQUEST_LOG_LIMIT).reverse(),
    aliases: spotifyAliases,
    pendingCommands: spotifyCommandQueue.length,
    sessionId: RULO_SESSION_ID,
    serverTime: now
  });
});

// Boton "Probar en el chat": inyecta un comentario falso en el pipeline.
app.post('/api/spotify-simulate-comment', (req, res) => {
  const comment = String(req.body?.comment || '').trim().slice(0, 500);
  const requester = String(req.body?.requester || 'Prueba').trim().slice(0, 80) || 'Prueba';
  if (comment.length < 2) return res.status(400).json({ ok: false, error: 'Escribi un comentario para simular.' });
  const item = {
    id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    requester,
    comment,
    response: '',
    chatimg: '',
    messageId: '',
    timestamp: Date.now(),
    source: 'simulado'
  };
  ruloChatItems.push(item);
  while (ruloChatItems.length > RULO_HISTORY_LIMIT) ruloChatItems.shift();
  saveRuloHistory();
  broadcast({ type: 'rulo_chat_item', item });
  const command = queueSpotifyCommand({ type: 'simulate', comment, requester, via: 'dashboard', parseOnly: req.body?.parseOnly === true });
  res.json({ ok: true, comment, requester, command });
});

// Serve SocialStream Ninja overlays (spotify-lyrics-overlay.html etc.)
const SSN_PATH = path.resolve(__dirname, '../../SocialStream Ninja');

// --- SSN AUTO-PATCHER ---
// Revisa que la extensión conserve los ajustes locales al actualizar SSN.
try {
    const ssnManifestPath = path.resolve(__dirname, '../../SocialStream Ninja/manifest.json');
    if (fs.existsSync(ssnManifestPath)) {
        const manifestData = JSON.parse(fs.readFileSync(ssnManifestPath, 'utf8'));
        if (!manifestData.key) {
            console.log('[SSN Auto-Patcher] ⚠️ Falta la key en manifest.json. Inyectando...');
            const newManifest = {
                key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyUdjby5vpkeVePz8Qx1nYP0y4bl4rjJs1/7DJVMyFTsVgRxJWVCCbXKgNturGB5AQwKG2vQoBitrxez9/mfyQhqsoIG8gVXSKyNag99Lg44gFW39IE3Z14MgDSGBJ0fYASkPSZBjSybdaHuPuFt/t5ffBUU/EhdB1dE6GtnVhIv0zxK/caheuGqkSz13yq7lLyWJkCAF8EGjAfULwWU05gW6oJg11Ssfh4JWFO34HMnn6jMyfz4J/HMllVVXHecOk0nliwJKcMzBLQ4SIJHKAjO639/OUFamOjth2HqooEtZJTIMoY4IBAr/AxhKdaaE2DnUIcVhr3K8slcbDaPjSwIDAQAB",
                ...manifestData
            };
            fs.writeFileSync(ssnManifestPath, JSON.stringify(newManifest, null, 2), 'utf8');
            console.log('[SSN Auto-Patcher] ✅ Key inyectada exitosamente. ID de extensión protegido.');
        } else {
            console.log('[SSN Auto-Patcher] ✅ Key correcta en manifest.json.');
        }
    }

    const localOverrideTargetDir = path.resolve(__dirname, '../../SocialStream Ninja/local-overrides');
    const localOverrides = [
        ['stable-ssn-session-id.js', path.resolve(__dirname, '../integrations/spotify-auto-music/stable-ssn-session-id.js')],
        ['spotify-auto-music.js', path.resolve(__dirname, '../integrations/spotify-auto-music/spotify-auto-music.js')],
        ['spotify-cortex-overlay-relay.js', path.resolve(__dirname, '../integrations/spotify-auto-music/spotify-cortex-overlay-relay.js')],
        ['rulo-chat-relay.js', path.resolve(WORKSPACE_ROOT, 'Rulo/rulo-chat-relay.js')]
    ];
    for (const [overrideFile, sourcePath] of localOverrides) {
        const targetPath = path.join(localOverrideTargetDir, overrideFile);
        if (fs.existsSync(sourcePath)) {
            fs.mkdirSync(localOverrideTargetDir, { recursive: true });
            const sourceCode = fs.readFileSync(sourcePath, 'utf8');
            const targetCode = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
            if (sourceCode !== targetCode) {
                fs.writeFileSync(targetPath, sourceCode, 'utf8');
                console.log(`[SSN Auto-Patcher] ✅ ${overrideFile} copiado a SocialStream Ninja/local-overrides.`);
            }
        }
    }

    // URL base de Cortex generada: evita repetir la IP LAN en cada override.
    try {
        fs.mkdirSync(localOverrideTargetDir, { recursive: true });
        const baseUrlOverridePath = path.join(localOverrideTargetDir, 'cortex-base-url.js');
        const baseUrlCode = [
            '// Generado automaticamente por Control Cortex al arrancar. No editar a mano.',
            '(function () {',
            '  "use strict";',
            `  window.CORTEX_BASE_URL = ${JSON.stringify(CORTEX_BASE_URL)};`,
            `  window.CORTEX_SESSION_ID = ${JSON.stringify(RULO_SESSION_ID)};`,
            '}());',
            ''
        ].join('\n');
        const currentBaseUrlCode = fs.existsSync(baseUrlOverridePath) ? fs.readFileSync(baseUrlOverridePath, 'utf8') : '';
        if (currentBaseUrlCode !== baseUrlCode) {
            fs.writeFileSync(baseUrlOverridePath, baseUrlCode, 'utf8');
            console.log(`[SSN Auto-Patcher] ✅ cortex-base-url.js generado (${CORTEX_BASE_URL}).`);
        }
    } catch (error) {
        console.error('[SSN Auto-Patcher] ❌ No se pudo generar cortex-base-url.js:', error);
    }

    const loaderPath = path.resolve(__dirname, '../../SocialStream Ninja/loader.js');
    if (fs.existsSync(loaderPath)) {
        const SPOTIFY_MODULE_VERSION = 24;
        const autoMusicLoaderLine = `        './local-overrides/spotify-auto-music.js?v=${SPOTIFY_MODULE_VERSION}',`;
        const cortexRelayLoaderLine = "        './local-overrides/spotify-cortex-overlay-relay.js?v=1',";
        const stableSessionLoaderLine = "        './local-overrides/stable-ssn-session-id.js?v=1',";
        const ruloChatRelayLoaderLine = "        './local-overrides/rulo-chat-relay.js?v=1',";
        const baseUrlLoaderLine = "        './local-overrides/cortex-base-url.js?v=1',";
        const oldAutoMusicLoaderLine = "        './custom/spotify-auto-music.js?v=1',";
        let loaderCode = fs.readFileSync(loaderPath, 'utf8');
        // Normaliza la version del modulo: si queda una linea vieja, el modulo
        // se cargaria dos veces. Se reescribe cualquier ?v=NN por la actual.
        const normalizedLoaderCode = loaderCode.replace(
            /\.\/local-overrides\/spotify-auto-music\.js\?v=\d+/g,
            `./local-overrides/spotify-auto-music.js?v=${SPOTIFY_MODULE_VERSION}`
        );
        if (normalizedLoaderCode !== loaderCode) {
            loaderCode = normalizedLoaderCode;
            console.log(`[SSN Auto-Patcher] ✅ Version del modulo de Spotify normalizada a v${SPOTIFY_MODULE_VERSION}.`);
        }
        if (loaderCode.includes(oldAutoMusicLoaderLine)) {
            loaderCode = loaderCode.replace(oldAutoMusicLoaderLine, autoMusicLoaderLine);
        }
        if (!loaderCode.includes(autoMusicLoaderLine)) {
            loaderCode = loaderCode.replace(
                "        './spotify.js?v=1',",
                "        './spotify.js?v=1',\n" + autoMusicLoaderLine
            );
            console.log('[SSN Auto-Patcher] ✅ Loader de Spotify auto music inyectado.');
        }
        if (!loaderCode.includes(baseUrlLoaderLine)) {
            loaderCode = loaderCode.replace(
                autoMusicLoaderLine,
                baseUrlLoaderLine + "\n" + autoMusicLoaderLine
            );
            console.log('[SSN Auto-Patcher] ✅ Loader de cortex-base-url inyectado.');
        }
        if (!loaderCode.includes(cortexRelayLoaderLine)) {
            loaderCode = loaderCode.replace(
                autoMusicLoaderLine,
                autoMusicLoaderLine + "\n" + cortexRelayLoaderLine
            );
            console.log('[SSN Auto-Patcher] ✅ Loader de Spotify Cortex relay inyectado.');
        }
        if (!loaderCode.includes(stableSessionLoaderLine)) {
            loaderCode = loaderCode.replace(
                "        './background.js?v=5',",
                stableSessionLoaderLine + "\n        './background.js?v=5',"
            );
            console.log('[SSN Auto-Patcher] ✅ Loader de Session ID estable inyectado.');
        }
        if (!loaderCode.includes(ruloChatRelayLoaderLine)) {
            loaderCode = loaderCode.replace(
                cortexRelayLoaderLine,
                cortexRelayLoaderLine + "\n" + ruloChatRelayLoaderLine
            );
            console.log('[SSN Auto-Patcher] ✅ Loader de Rulo chat relay inyectado.');
        }
        // Mantener una sola carga del override aunque una actualización previa
        // haya dejado líneas duplicadas en el loader.
        let autoMusicLineSeen = false;
        let baseUrlLineSeen = false;
        loaderCode = loaderCode.split(/\r?\n/).filter(line => {
            if (line.includes("'./local-overrides/spotify-auto-music.js?v=")) {
                if (autoMusicLineSeen) return false;
                autoMusicLineSeen = true;
            }
            if (line.includes("'./local-overrides/cortex-base-url.js?v=")) {
                if (baseUrlLineSeen) return false;
                baseUrlLineSeen = true;
            }
            return true;
        }).join('\n');
        fs.writeFileSync(loaderPath, loaderCode, 'utf8');
    }
} catch (error) {
    console.error('[SSN Auto-Patcher] ❌ Error parcheando manifest:', error);
}
// ------------------------

if (fs.existsSync(SSN_PATH)) {
  app.use('/ssn', express.static(SSN_PATH));
  console.log('[Cortex] Sirviendo overlays SSN en /ssn');
}


// Load services from services.json
function readServices() {
  try {
    if (!fs.existsSync(SERVICES_JSON_PATH)) {
      fs.writeFileSync(SERVICES_JSON_PATH, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(SERVICES_JSON_PATH, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading services.json:', error);
    return [];
  }
}

// Save services to services.json
function writeServices(services) {
  try {
    fs.writeFileSync(SERVICES_JSON_PATH, JSON.stringify(services, null, 2), { encoding: 'utf8' });
  } catch (error) {
    console.error('Error writing services.json:', error);
  }
}// Normalize paths for Windows compatibility
function normalizeWindowsPath(filePath) {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/');
}

function resolveConfiguredPath(inputPath, baseDir = __dirname) {
  if (!inputPath) return '';

  const normalized = normalizeWindowsPath(inputPath);
  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  const candidates = [
    path.resolve(baseDir, normalized),
    path.resolve(WORKSPACE_ROOT, normalized)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

// Connect to PM2 and get process status/info
function getPM2Processes() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        return reject(err);
      }
      pm2.list((err, list) => {
        if (err) {
          return reject(err);
        }
        resolve(list);
      });
    });
  });
}

// API: Get all services with dynamic PM2 status
app.get('/api/services', async (req, res) => {
  try {
    const services = readServices();
    let pm2List = [];
    try {
      pm2List = await getPM2Processes();
    } catch (err) {
      console.warn('Could not connect to PM2 or retrieve list. PM2 may not be running:', err.message);
    }

    const pm2Map = new Map();
    pm2List.forEach((proc) => {
      pm2Map.set(proc.name, {
        status: proc.pm2_env ? proc.pm2_env.status : 'stopped',
        cpu: proc.monit ? proc.monit.cpu : 0,
        memory: proc.monit ? proc.monit.memory : 0,
        pid: proc.pid,
        uptime: proc.pm2_env ? (Date.now() - proc.pm2_env.pm_uptime) : 0,
        restarts: proc.pm2_env ? proc.pm2_env.restart_time : 0
      });
    });

    const enrichedServices = services.map((service) => {
      const pm2Info = pm2Map.get(service.id);
      return {
        ...service,
        status: pm2Info ? pm2Info.status : 'stopped',
        cpu: pm2Info ? pm2Info.cpu : 0,
        memory: pm2Info ? pm2Info.memory : 0,
        pid: pm2Info ? pm2Info.pid : null,
        uptime: pm2Info ? pm2Info.uptime : 0,
        restarts: pm2Info ? pm2Info.restarts : 0
      };
    });

    res.json(enrichedServices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve services', details: error.message });
  }
});

// API: Register a new service
app.post('/api/services', (req, res) => {
  const { id, name, description, directory, script, env, dashboardUrl } = req.body;

  if (!id || !name || !directory || !script) {
    return res.status(400).json({ error: 'id, name, directory, and script are required fields' });
  }

  // Validate ID format (alphanumeric, dashes, underscores)
  if (!/^[a-zA-Z0-9-_]+$/.test(id)) {
    return res.status(400).json({ error: 'id must contain only letters, numbers, dashes, and underscores' });
  }

  const normalizedDir = normalizeWindowsPath(directory);
  const normalizedScript = normalizeWindowsPath(script);
  const absoluteDirPath = resolveConfiguredPath(normalizedDir);
  const absoluteScriptPath = path.isAbsolute(normalizedScript)
    ? normalizedScript
    : resolveConfiguredPath(path.join(normalizedDir, normalizedScript));

  // Validate directory and script existence
  if (!fs.existsSync(absoluteDirPath)) {
    return res.status(400).json({ error: `Directory does not exist: ${normalizedDir}` });
  }

  if (!fs.existsSync(absoluteScriptPath)) {
    return res.status(400).json({ error: `Script file does not exist at: ${absoluteScriptPath}` });
  }

  const services = readServices();

  if (services.some((s) => s.id === id)) {
    return res.status(400).json({ error: `A service with id "${id}" already exists` });
  }

  const newService = {
    id,
    name,
    description: description || '',
    directory: normalizedDir,
    script: normalizedScript,
    env: env || {},
    dashboardUrl: dashboardUrl || '',
    status: 'stopped'
  };

  services.push(newService);
  writeServices(services);

  broadcast({
    type: 'service_added',
    service: newService
  });

  res.status(201).json(newService);
});

// API: Delete a service
app.delete('/api/services/:id', (req, res) => {
  const { id } = req.params;
  const services = readServices();
  const index = services.findIndex((s) => s.id === id);

  if (index === -1) {
    return res.status(404).json({ error: `Service with id "${id}" not found` });
  }

  const service = services[index];

  // Stop and delete from PM2 first
  pm2.connect((err) => {
    if (!err) {
      pm2.delete(id, () => {});
    }
  });

  services.splice(index, 1);
  writeServices(services);

  broadcast({
    type: 'service_deleted',
    id
  });

  res.json({ message: `Service "${service.name}" deleted successfully` });
});

// Helper for PM2 actions
function runPM2Action(id, action) {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);

      if (action === 'start') {
        const services = readServices();
        const service = services.find((s) => s.id === id);

        if (!service) {
          return reject(new Error(`Service ${id} not found in config`));
        }

        const resolvedDirectory = resolveConfiguredPath(service.directory);
        const resolvedScript = path.isAbsolute(service.script)
          ? normalizeWindowsPath(service.script)
          : resolveConfiguredPath(path.join(resolvedDirectory, service.script));

        pm2.start(
          {
            name: service.id,
            script: resolvedScript,
            cwd: resolvedDirectory,
            env: {
              ...process.env,
              ...service.env
            },
            exec_mode: 'fork',
            force: true
          },
          (err, apps) => {
            if (err) reject(err);
            else resolve(apps);
          }
        );
      } else if (action === 'stop') {
        pm2.stop(id, (err, apps) => {
          if (err) reject(err);
          else resolve(apps);
        });
      } else if (action === 'restart') {
        pm2.restart(id, (err, apps) => {
          if (err) reject(err);
          else resolve(apps);
        });
      } else {
        reject(new Error(`Invalid action: ${action}`));
      }
    });
  });
}

// Helper for PM2 batch actions (start-all, stop-all) to prevent concurrent connection gotchas
function runPM2BatchAction(ids, action) {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);

      const services = readServices();
      const promises = ids.map((id) => {
        return new Promise((res, rej) => {
          const service = services.find((s) => s.id === id);
          if (!service && action === 'start') {
            return rej(new Error(`Service ${id} not found in config`));
          }

          if (action === 'start') {
            const resolvedDirectory = resolveConfiguredPath(service.directory);
            const resolvedScript = path.isAbsolute(service.script)
              ? normalizeWindowsPath(service.script)
              : resolveConfiguredPath(path.join(resolvedDirectory, service.script));

            pm2.start(
              {
                name: service.id,
                script: resolvedScript,
                cwd: resolvedDirectory,
                env: {
                  ...process.env,
                  ...service.env
                },
                exec_mode: 'fork',
                force: true
              },
              (err, apps) => {
                if (err) rej(err);
                else res(apps);
              }
            );
          } else if (action === 'stop') {
            pm2.stop(id, (err, apps) => {
              if (err) {
                res();
              } else {
                res(apps);
              }
            });
          }
        });
      });

      Promise.allSettled(promises).then((results) => {
        const errors = results
          .filter((r) => r.status === 'rejected')
          .map((r) => r.reason.message);
        if (errors.length > 0 && errors.length === ids.length) {
          reject(new Error(`Batch action ${action} failed: ${errors.join(', ')}`));
        } else {
          resolve(results);
        }
      });
    });
  });
}

// API: Start all services
app.post('/api/services/start-all', async (req, res) => {
  try {
    const services = readServices();
    const ids = services.map(s => s.id);
    await runPM2BatchAction(ids, 'start');
    
    // Broadcast status change for all
    ids.forEach(id => {
      broadcast({ type: 'status_change', id, status: 'online' });
    });
    
    res.json({ message: 'All services started successfully' });

    // Auto-refresh OBS browser sources 3.5s after starting all services (giving them time to bind ports)
    setTimeout(async () => {
      try {
        const obs = new OBSWebSocket();
        await obs.connect(OBS_CONFIG.url, OBS_CONFIG.password);
        const list = await obs.call('GetInputList');
        const bSources = (list.inputs || []).filter(i => i.inputKind === 'browser_source');
        for (const s of bSources) {
          try {
            await obs.call('PressInputPropertiesButton', { inputName: s.inputName, propertyName: 'refreshnocache' });
          } catch (_) {}
        }
        await obs.disconnect();
        console.log(`[OBS] Auto-refreshed ${bSources.length} browser sources in OBS after starting all services.`);
      } catch (e) {
        // Silently catch if OBS is not running yet
      }
    }, 3500);
  } catch (error) {
    res.status(500).json({ error: 'Failed to start all services', details: error.message });
  }
});

// API: Refresh all Browser Sources in OBS without cache
app.post('/api/obs/refresh-sources', async (req, res) => {
  const obs = new OBSWebSocket();
  try {
    console.log(`[OBS] Connecting to ${OBS_CONFIG.url} to refresh browser sources...`);
    await obs.connect(OBS_CONFIG.url, OBS_CONFIG.password);

    const inputListResponse = await obs.call('GetInputList');
    const browserSources = (inputListResponse.inputs || []).filter(
      (input) => input.inputKind === 'browser_source'
    );

    console.log(`[OBS] Found ${browserSources.length} browser sources to refresh.`);

    const refreshed = [];
    const errors = [];

    for (const source of browserSources) {
      try {
        await obs.call('PressInputPropertiesButton', {
          inputName: source.inputName,
          propertyName: 'refreshnocache'
        });
        refreshed.push(source.inputName);
      } catch (err) {
        console.warn(`[OBS] Failed to refresh "${source.inputName}":`, err.message);
        errors.push({ name: source.inputName, error: err.message });
      }
    }

    await obs.disconnect();

    console.log(`[OBS] Successfully refreshed ${refreshed.length} sources.`);

    res.json({
      success: true,
      message: `Se actualizaron ${refreshed.length} fuentes de navegador en OBS`,
      count: refreshed.length,
      refreshedSources: refreshed,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[OBS] Error refreshing sources:', error.message || error);
    try { await obs.disconnect(); } catch (_) {}
    res.status(500).json({
      success: false,
      error: 'Error al conectar o enviar orden de actualización a OBS',
      details: error.message || String(error)
    });
  }
});

// API: Receive Spotify overlay state from the SocialStream Ninja background page.
app.post('/api/spotify-overlay', (req, res) => {
  const payload = req.body && req.body.spotify ? req.body.spotify : req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid Spotify payload' });
  }

  latestSpotifyOverlay = {
    ...payload,
    receivedAt: payload.receivedAt || Date.now()
  };

  broadcast({
    type: 'spotify_overlay',
    spotify: latestSpotifyOverlay
  });

  res.json({ success: true });
});

app.get('/api/spotify-overlay', (req, res) => {
  res.json({
    success: true,
    hasPayload: !!latestSpotifyOverlay,
    spotify: latestSpotifyOverlay
  });
});

// API: Receive only Spotify bot replies for the independent Rulo overlay.
app.post('/api/rulo-bot-message', (req, res) => {
  const body = req.body || {};
  const message = String(body.message || '').trim().slice(0, 500);
  if (!message) {
    return res.status(400).json({ success: false, error: 'Invalid bot message' });
  }

  const requestedMood = String(body.mood || '').trim().toLowerCase();
  const provisional = body.provisional === true;
  const botMessage = {
    message,
    // Fuente unica de verdad del nombre visible: la configuracion de Rulo.
    botName: ruloConfig.botName,
    mood: RULO_MOODS.includes(requestedMood) ? requestedMood : 'success',
    requester: String(body.requester || '').trim().slice(0, 80),
    timestamp: Number(body.timestamp) || Date.now()
  };

  // Mensaje provisorio (ej. "Buscando en Spotify..." con mood thinking): se muestra en el
  // overlay pero no queda como ultima respuesta ni se empareja con el comentario.
  if (provisional) {
    broadcast({ type: 'rulo_bot_message', rulo: botMessage });
    return res.json({ success: true, provisional: true });
  }

  latestRuloBotMessage = botMessage;

  if (latestRuloBotMessage.requester) {
    const matched = [...ruloChatItems].reverse().find(item =>
      (item.requester.toLowerCase() === latestRuloBotMessage.requester.toLowerCase() ||
       item.requester.toLowerCase().startsWith(latestRuloBotMessage.requester.toLowerCase() + ' ')) &&
      !item.response && Date.now() - item.timestamp < 120000
    );
    if (matched) {
      matched.response = latestRuloBotMessage.message;
      broadcast({ type: 'rulo_chat_item', item: matched });
    }
  }

  broadcast({ type: 'rulo_bot_message', rulo: latestRuloBotMessage });
  res.json({ success: true });
});

app.get('/api/rulo-bot-message', (req, res) => {
  res.json({ success: true, message: latestRuloBotMessage });
});

app.post('/api/rulo-chat-message', (req, res) => {
  const body = req.body || {};
  const comment = String(body.comment || '').trim().slice(0, 500);
  const requester = String(body.requester || body.chatname || '').trim().slice(0, 80);
  if (!comment || !requester) return res.status(400).json({ success: false, error: 'Invalid chat message' });
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    requester,
    comment,
    response: '',
    chatimg: String(body.chatimg || '').slice(0, 500),
    messageId: String(body.id || body.mid || '').slice(0, 120),
    timestamp: Number(body.timestamp) || Date.now(),
    source: String(body.source || body.type || '').slice(0, 40)
  };
  ruloChatItems.push(item);
  while (ruloChatItems.length > RULO_HISTORY_LIMIT) ruloChatItems.shift();
  saveRuloHistory();
  broadcast({ type: 'rulo_chat_item', item });
  res.json({ success: true, item });
});

app.get('/api/rulo-chat-messages', (req, res) => {
  res.json({ success: true, items: ruloPublicHistory(), total: ruloChatItems.length });
});

// API: Vaciar el historial de comentarios de Rulo (memoria + archivo).
app.post('/api/rulo-chat-clear', (req, res) => {
  ruloChatItems.length = 0;
  clearTimeout(ruloHistorySaveTimer);
  try {
    fs.mkdirSync(path.dirname(RULO_HISTORY_PATH), { recursive: true });
    fs.writeFileSync(RULO_HISTORY_PATH, JSON.stringify([], null, 2), 'utf8');
  } catch (error) {
    console.warn('[Rulo] No se pudo vaciar el historial:', error.message);
  }
  broadcast({ type: 'rulo_chat_cleared' });
  res.json({ success: true });
});

app.post('/api/rulo-repeat-response', (req, res) => {
  const body = req.body || {};
      const response = String(body.response || '').trim().slice(0, 500);
  if (!response) return res.status(400).json({ success: false, error: 'Invalid response' });
  const repeatMood = String(body.mood || '').trim().toLowerCase();
  const message = {
    message: response,
    botName: ruloConfig.botName,
    mood: RULO_MOODS.includes(repeatMood) ? repeatMood : 'speaking',
    requester: String(body.requester || '').trim().slice(0, 80),
    timestamp: Date.now()
  };
  latestRuloBotMessage = message;
  broadcast({ type: 'rulo_bot_message', rulo: message });
  res.json({ success: true });
});

app.get('/api/rulo-config', (req, res) => {
  res.json({ success: true, config: ruloConfig });
});

app.post('/api/rulo-config', (req, res) => {
  const body = req.body || {};
  const next = {
    ...ruloConfig,
    botName: String(body.botName ?? ruloConfig.botName).trim().slice(0, 80) || 'Rulo',
    accent: /^#[0-9a-f]{6}$/i.test(String(body.accent || '')) ? String(body.accent) : ruloConfig.accent,
    avatarLetter: String(body.avatarLetter ?? ruloConfig.avatarLetter).trim().slice(0, 2) || 'A',
    visibleMs: Math.min(60000, Math.max(2000, Math.round(Number(body.visibleMs ?? ruloConfig.visibleMs) || 12000))),
    maxWidth: Math.min(1200, Math.max(320, Math.round(Number(body.maxWidth ?? ruloConfig.maxWidth) || 760))),
    fontSize: Math.min(2.5, Math.max(0.7, Number(body.fontSize ?? ruloConfig.fontSize) || 1.35)),
    panelOpacity: Math.min(1, Math.max(0.2, Number(body.panelOpacity ?? ruloConfig.panelOpacity) || 0.94)),
    showRequester: body.showRequester === undefined ? ruloConfig.showRequester : body.showRequester === true,
    showMascot: body.showMascot === undefined ? ruloConfig.showMascot === true : body.showMascot === true,
    overlayTheme: ['dark', 'light'].includes(String(body.overlayTheme || '').toLowerCase())
      ? String(body.overlayTheme).toLowerCase()
      : ruloConfig.overlayTheme,
    animation: ['slide', 'pop', 'soft'].includes(body.animation) ? body.animation : ruloConfig.animation
  };
  ruloConfig = next;
  try {
    fs.mkdirSync(path.dirname(RULO_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(RULO_CONFIG_PATH, JSON.stringify(ruloConfig, null, 2), 'utf8');
    broadcast({ type: 'rulo_config_updated', config: ruloConfig });
    res.json({ success: true, config: ruloConfig });
  } catch (error) {
    console.error('[Rulo] No se pudo guardar la configuracion:', error);
    res.status(500).json({ success: false, error: 'No se pudo guardar la configuracion de Rulo.' });
  }
});

// API: URL base de Cortex — fuente unica para panel, overrides y OBS.
app.get('/api/cortex-base-url', (req, res) => {
  res.json({
    success: true,
    baseUrl: CORTEX_BASE_URL,
    sessionId: RULO_SESSION_ID,
    port: PORT
  });
});

// API: Stop all services
app.post('/api/services/stop-all', async (req, res) => {
  try {
    const services = readServices();
    const ids = services.map(s => s.id);
    await runPM2BatchAction(ids, 'stop');
    
    // Broadcast status change for all
    ids.forEach(id => {
      broadcast({ type: 'status_change', id, status: 'stopped' });
    });
    
    res.json({ message: 'All services stopped successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop all services', details: error.message });
  }
});

// API: Start service
app.post('/api/services/:id/start', async (req, res) => {
  const { id } = req.params;
  try {
    await runPM2Action(id, 'start');
    broadcast({ type: 'status_change', id, status: 'online' });
    res.json({ message: `Service "${id}" started` });
  } catch (error) {
    res.status(500).json({ error: `Failed to start service "${id}"`, details: error.message });
  }
});

// API: Stop service
app.post('/api/services/:id/stop', async (req, res) => {
  const { id } = req.params;
  try {
    await runPM2Action(id, 'stop');
    broadcast({ type: 'status_change', id, status: 'stopped' });
    res.json({ message: `Service "${id}" stopped` });
  } catch (error) {
    res.status(500).json({ error: `Failed to stop service "${id}"`, details: error.message });
  }
});

// API: Restart service
app.post('/api/services/:id/restart', async (req, res) => {
  const { id } = req.params;
  try {
    await runPM2Action(id, 'restart');
    broadcast({ type: 'status_change', id, status: 'online' });
    res.json({ message: `Service "${id}" restarted` });
  } catch (error) {
    res.status(500).json({ error: `Failed to restart service "${id}"`, details: error.message });
  }
});

// API: Get global system resource info
app.get('/api/system', (req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryPercentage = (usedMem / totalMem) * 100;

  // Simple CPU load average (1 min load)
  const load = os.loadavg();

  res.json({
    platform: os.platform(),
    hostname: os.hostname(),
    uptime: os.uptime(),
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      percentage: memoryPercentage
    },
    cpu: {
      model: cpus[0].model,
      cores: cpus.length,
      load: load[0] || 0
    }
  });
});

// WebSocket upgrade and connection handling
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Keep track of connected clients
const clients = new Set();
// Clientes de Spotify (extension SocialStream Ninja): reciben los comandos del
// dashboard al instante, sin esperar el poll. El poll sigue como respaldo.
const spotifySockets = new Set();

function pushToSpotifyClients(payload) {
  if (!spotifySockets.size) return 0;
  const message = JSON.stringify(payload);
  let sent = 0;
  spotifySockets.forEach((socket) => {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
        sent += 1;
      }
    } catch (_) {}
  });
  return sent;
}

wss.on('connection', (ws, request) => {
  const isSpotifyClient = String(request?.url || '').includes('/api/spotify-ws');
  if (isSpotifyClient) {
    // La extension solo recibe lo suyo: no se le manda el trafico de overlays.
    spotifySockets.add(ws);
    console.log(`[Spotify] Extension conectada por WebSocket (${spotifySockets.size} activa/s).`);
    try {
      ws.send(JSON.stringify({ type: 'spotify_settings', settings: spotifySettings, defaults: DEFAULT_SPOTIFY_SETTINGS }));
    } catch (_) {}
    ws.on('close', () => {
      spotifySockets.delete(ws);
      console.log('[Spotify] Extension desconectada del WebSocket.');
    });
    ws.on('error', () => {
      spotifySockets.delete(ws);
    });
    return;
  }
  clients.add(ws);
  console.log(`WebSocket client connected. Total clients: ${clients.size}`);

  if (latestSpotifyOverlay) {
    try {
      ws.send(JSON.stringify({
        type: 'spotify_overlay',
        spotify: latestSpotifyOverlay
      }));
    } catch (_) {}
  }

  if (latestRuloBotMessage) {
    try {
      ws.send(JSON.stringify({
        type: 'rulo_bot_message',
        rulo: latestRuloBotMessage
      }));
    } catch (_) {}
  }

  ruloPublicHistory().forEach(item => {
    try { ws.send(JSON.stringify({ type: 'rulo_chat_item', item })); } catch (_) {}
  });

  try {
    ws.send(JSON.stringify({ type: 'rulo_config_updated', config: ruloConfig }));
  } catch (_) {}

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WebSocket client disconnected. Total clients: ${clients.size}`);
  });
});

// Broadcast helper
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// PM2 launch bus to monitor real-time logs and events
pm2.connect((err) => {
  if (err) {
    console.error('Failed to connect to PM2 for logs bus:', err);
    return;
  }

  pm2.launchBus((err, bus) => {
    if (err) {
      console.error('Failed to launch PM2 log bus:', err);
      return;
    }

    console.log('PM2 log bus successfully connected');

    // Monitor standard output logs
    bus.on('log:out', (data) => {
      broadcast({
        type: 'log',
        serviceId: data.process.name,
        stream: 'stdout',
        timestamp: new Date().toISOString(),
        message: data.data
      });
    });

    // Monitor error logs
    bus.on('log:err', (data) => {
      broadcast({
        type: 'log',
        serviceId: data.process.name,
        stream: 'stderr',
        timestamp: new Date().toISOString(),
        message: data.data
      });
    });

    // Monitor process status changes from PM2
    bus.on('process:event', (data) => {
      if (data.event === 'exit' || data.event === 'start' || data.event === 'online' || data.event === 'stopped') {
        const mappedStatus = data.event === 'online' || data.event === 'start' ? 'online' : 'stopped';
        broadcast({
          type: 'status_change',
          id: data.process.name,
          status: mappedStatus
        });
      }
    });
  });
});

// Periodically broadcast system metrics and service usage updates to all WS clients
setInterval(async () => {
  if (clients.size === 0) return;

  try {
    // 1. Get system metrics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPercentage = (usedMem / totalMem) * 100;

    const systemMetrics = {
      cpuPercentage: getCpuUsagePercentage(),
      memoryPercentage: memoryPercentage,
      freeMemoryGB: (freeMem / (1024 ** 3)).toFixed(2),
      totalMemoryGB: (totalMem / (1024 ** 3)).toFixed(2),
      uptime: os.uptime()
    };

    // 2. Get PM2 process metrics
    let pm2List = [];
    try {
      pm2List = await getPM2Processes();
    } catch (e) {
      // PM2 offline
    }

    const servicesMetrics = pm2List.map((proc) => ({
      id: proc.name,
      status: proc.pm2_env ? proc.pm2_env.status : 'stopped',
      cpu: proc.monit ? proc.monit.cpu : 0,
      memory: proc.monit ? proc.monit.memory : 0,
      uptime: proc.pm2_env ? (Date.now() - proc.pm2_env.pm_uptime) : 0,
      restarts: proc.pm2_env ? proc.pm2_env.restart_time : 0
    }));

    // Calculate total CPU and RAM consumed *only* by our microservices
    let servicesCpuTotal = 0;
    let servicesMemTotal = 0;
    
    // We only count microservices registered in our config
    const servicesConfig = readServices();
    const configIds = new Set(servicesConfig.map(s => s.id));

    servicesMetrics.forEach((metric) => {
      if (configIds.has(metric.id) && metric.status === 'online') {
        servicesCpuTotal += metric.cpu || 0;
        servicesMemTotal += metric.memory || 0;
      }
    });

    broadcast({
      type: 'metrics',
      system: systemMetrics,
      services: servicesMetrics,
      servicesTotal: {
        cpu: servicesCpuTotal,
        memory: servicesMemTotal
      }
    });
  } catch (error) {
    console.error('Error broadcasting metrics:', error);
  }
}, 3000);

// Start HTTP/WS server
server.listen(PORT, () => {
  console.log(`Control Cortex backend listening on http://localhost:${PORT}`);
  console.log(`[Cortex] URL base LAN: ${CORTEX_BASE_URL}`);
  console.log(`[Cortex] .env cargado: ${ENV_VARS_LOADED} variable(s).`);
});
