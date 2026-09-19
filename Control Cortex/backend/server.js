const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pm2 = require('pm2');
const os = require('os');
const { OBSWebSocket } = require('obs-websocket-js');
const { createFileStore } = require('./file-store');
const { createAnalytics } = require('./spotify-analytics');
const {
  RESPONSE_CONTEXTS,
  RESPONSE_CONTEXT_META,
  DEFAULT_SPOTIFY_RESPONSES,
  normalizeSpotifyResponses,
  cleanVariantFor,
  variantKey,
  aiFailureMessage,
  aiEnvelopeError,
  addAiVariants,
  parseAiSuggestions
} = require('./spotify-responses');
const { SPOTIFY_MODULE_VERSION } = require('./versions');

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
const SPOTIFY_VOCABULARY_PATH = path.join(SPOTIFY_DIR, 'spotify-vocabulary.json');
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
  artistVariety: true,       // "un tema de X" -> uno al azar, no siempre el mismo
  artistVarietyPool: 20,     // cuantos resultados mira para elegir al azar (5-50)
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
    artistVariety: pick('artistVariety', true) !== false,
    artistVarietyPool: clampSpotifyNumber(pick('artistVarietyPool', 20), 20, 5, 50),
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
  // El sello se actualiza: este guardado es nuestro, no una edicion externa.
  // (try por si todavia no se creo el store, durante el arranque.)
  try { spotifySettingsStore.markSynced(spotifySettings); } catch (error) { /* store no listo */ }
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

// Limpia lo que venga en spotify-aliases.json (lo puede escribir una IA):
// claves y valores en minusculas, sin basura, tope de 200 pares.
function normalizeSpotifyAliases(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  Object.keys(raw).slice(0, 200).forEach(key => {
    const cleanKey = String(key || '').trim().toLowerCase().slice(0, 60);
    const cleanValue = String(raw[key] || '').trim().toLowerCase().slice(0, 60);
    if (cleanKey && cleanValue && cleanKey !== cleanValue) clean[cleanKey] = cleanValue;
  });
  return clean;
}

// Correcciones de escritura aprendidas ("laberiso" -> "la beriso"): las carga
// el modulo de la extension y las aprende solo cuando una variante funciona.
function saveSpotifyAliases() {
  try {
    fs.mkdirSync(SPOTIFY_DIR, { recursive: true });
    fs.writeFileSync(SPOTIFY_ALIASES_PATH, JSON.stringify(spotifyAliases, null, 2), 'utf8');
    spotifyAliasesStore.markSynced(spotifyAliases);
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
  try { spotifyAnalytics.recordEvent('alias_learned', { from: key, to: value }); } catch (error) { /* arranque */ }
  console.log(`[Spotify] Correccion aprendida: "${key}" -> "${value}"`);
  return {
    from: key,
    to: value,
    artist: String(meta?.artist || '').slice(0, 120),
    track: String(meta?.track || '').slice(0, 120)
  };
}

// --- Vocabulario: como esta entrenado el bot (Rulo/Spotify/spotify-vocabulary.json) ---
// Es la fuente de verdad del parser: la extension lo lee en vivo y el dashboard de
// entrenamiento lo edita. El respaldo del modulo usa estas mismas listas.
const DEFAULT_SPOTIFY_VOCABULARY = {
  commands: ['!playnow', '!tema', '!musica'],
  musicWords: ['tema', 'temas', 'temita', 'temitas', 'temon', 'temones', 'temazo', 'temazos', 'music', 'musica', 'musicas', 'musicon', 'musiquita', 'cancion', 'canciones', 'cancioncita', 'track', 'tracks', 'rola', 'rolas', 'rolita'],
  requestVerbs: ['quiero escuchar', 'quiero oir', 'me pones', 'me podes poner', 'podes poner', 'podrias poner', 'poneme', 'ponele', 'ponete', 'pones', 'poner', 'pongan', 'pone', 'pon', 'pasame', 'pasate', 'pasale', 'pasen', 'pasa', 'quiero', 'quisiera', 'queria', 'pedime', 'pedia', 'pedi', 'pedir', 'pido', 'necesito'],
  greetings: ['hola', 'holis', 'buen dia', 'buenas tardes', 'buenas noches', 'buenas', 'bue', 'que tal', 'q tal', 'como va', 'como andan', 'como estas', 'como te va', 'epa', 'hey', 'saludos', 'aloha', 'buenas y santas'],
  fillers: ['che', 'por favor', 'porfa', 'porfavor', 'please', 'dale', 'gracias', 'muchas gracias', 'amigo', 'amiga', 'genio', 'crack', 'maestro', 'capo', 'grande', 'bot', 'porfi'],
  articles: ['un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'algun', 'alguna', 'alguno', 'algunos', 'otro', 'otra'],
  genres: [
    { id: 'bachata', spotify: 'bachata', words: ['bachata', 'bachatas'] },
    { id: 'blues', spotify: 'blues', words: ['blues'] },
    { id: 'chamame', spotify: 'chamame', words: ['chamame'] },
    { id: 'cumbia', spotify: 'cumbia', words: ['cumbia', 'cumbias', 'cumbia villera'] },
    { id: 'cuarteto', spotify: 'cuarteto', words: ['cuarteto', 'cuartetos'] },
    { id: 'electronica', spotify: 'electronic', words: ['electronica', 'electro', 'edm'] },
    { id: 'folklore', spotify: 'folk', words: ['folklore', 'folclore'] },
    { id: 'funk', spotify: 'funk', words: ['funk'] },
    { id: 'jazz', spotify: 'jazz', words: ['jazz'] },
    { id: 'merengue', spotify: 'merengue', words: ['merengue', 'merengues'] },
    { id: 'metal', spotify: 'metal', words: ['metal'] },
    { id: 'pop', spotify: 'pop', words: ['pop'] },
    { id: 'rap', spotify: 'rap', words: ['rap'] },
    { id: 'reggae', spotify: 'reggae', words: ['reggae', 'regae'] },
    { id: 'reggaeton', spotify: 'reggaeton', words: ['reggaeton', 'regueton', 'regueto', 'regeton', 'regeaton', 'regaeton'] },
    { id: 'romantico', spotify: 'romantico', words: ['romantico', 'romantica', 'romanticos', 'romanticas', 'romanticon'] },
    { id: 'rock', spotify: 'rock', words: ['rock'] },
    { id: 'salsa', spotify: 'salsa', words: ['salsa', 'salsas'] },
    { id: 'techno', spotify: 'techno', words: ['techno', 'tekno'] },
    { id: 'trap', spotify: 'trap', words: ['trap', 'traps'] },
    { id: 'vallenato', spotify: 'vallenato', words: ['vallenato', 'vallenatos'] }
  ],
  typoSwaps: [['y', 'i'], ['i', 'y'], ['b', 'v'], ['v', 'b'], ['s', 'z'], ['z', 's'], ['ll', 'y'], ['qu', 'k'], ['c', 's']],
  search: { maxAttempts: 7, variantLimit: 8 },
  // Respuestas del bot / Rulo: varias variantes por contexto, al azar y sin
  // repetir. Se editan desde la pestana "Bot / Rulo".
  responses: DEFAULT_SPOTIFY_RESPONSES,
  // Cerebro (futuro). La clave NUNCA se guarda aca: sale de backend/.env
  // (SPOTIFY_AI_API_KEY). El dashboard solo muestra si esta puesta.
  ai: {
    enabled: false,
    endpoint: '',
    model: '',
    instructions: '',
    onlyWhenNotUnderstood: true,
    requireSignal: true,
    timeoutMs: 8000
  }
};

function normalizeWordList(value, limit) {
  if (!Array.isArray(value)) return [];
  const out = [];
  value.slice(0, limit || 400).forEach(word => {
    const clean = String(word === undefined || word === null ? '' : word).trim().slice(0, 80);
    if (clean && !out.some(item => item.toLowerCase() === clean.toLowerCase())) out.push(clean);
  });
  return out;
}

function normalizeSpotifyVocabulary(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = DEFAULT_SPOTIFY_VOCABULARY;
  const pick = (key, fallback) => (source[key] === undefined ? fallback : source[key]);
  const genres = (Array.isArray(pick('genres', base.genres)) ? pick('genres', base.genres) : base.genres)
    .slice(0, 100)
    .map(entry => ({
      id: String(entry?.id || entry?.spotify || '').trim().slice(0, 40),
      spotify: String(entry?.spotify || entry?.id || '').trim().slice(0, 40),
      words: normalizeWordList(entry?.words, 60)
    }))
    .filter(entry => entry.id && entry.spotify && entry.words.length);
  const swaps = (Array.isArray(pick('typoSwaps', base.typoSwaps)) ? pick('typoSwaps', base.typoSwaps) : base.typoSwaps)
    .slice(0, 60)
    .filter(pair => Array.isArray(pair) && pair.length === 2 && String(pair[0]).length)
    .map(pair => [String(pair[0]).slice(0, 6), String(pair[1] === undefined ? '' : pair[1]).slice(0, 6)]);
  const ai = pick('ai', base.ai) && typeof pick('ai', base.ai) === 'object' ? pick('ai', base.ai) : base.ai;
  return {
    commands: normalizeWordList(pick('commands', base.commands), 20).map(cmd => cmd.toLowerCase().slice(0, 30)),
    musicWords: normalizeWordList(pick('musicWords', base.musicWords), 200),
    requestVerbs: normalizeWordList(pick('requestVerbs', base.requestVerbs), 200),
    greetings: normalizeWordList(pick('greetings', base.greetings), 200),
    fillers: normalizeWordList(pick('fillers', base.fillers), 200),
    articles: normalizeWordList(pick('articles', base.articles), 100),
    genres,
    typoSwaps: swaps,
    search: {
      maxAttempts: clampSpotifyNumber(pick('search', base.search) && pick('search', base.search).maxAttempts, 7, 1, 12),
      variantLimit: clampSpotifyNumber(pick('search', base.search) && pick('search', base.search).variantLimit, 8, 1, 16)
    },
    ai: {
      enabled: ai.enabled === true,
      endpoint: String(ai.endpoint || '').trim().slice(0, 300),
      model: String(ai.model || '').trim().slice(0, 120),
      instructions: String(ai.instructions || '').trim().slice(0, 2000),
      onlyWhenNotUnderstood: ai.onlyWhenNotUnderstood !== false,
      requireSignal: ai.requireSignal !== false,
      timeoutMs: clampSpotifyNumber(ai.timeoutMs, 8000, 1000, 60000)
    },
    responses: normalizeSpotifyResponses(pick('responses', base.responses))
  };
}

let spotifyVocabulary = DEFAULT_SPOTIFY_VOCABULARY;

function saveSpotifyVocabularyFile() {
  try {
    fs.mkdirSync(SPOTIFY_DIR, { recursive: true });
    fs.writeFileSync(SPOTIFY_VOCABULARY_PATH, JSON.stringify(spotifyVocabulary, null, 2), 'utf8');
    try { spotifyVocabularyStore.markSynced(spotifyVocabulary); } catch (error) { /* store no listo */ }
  } catch (error) {
    console.warn('[Spotify] No se pudo guardar el vocabulario:', error.message);
  }
}

function saveSpotifyVocabulary(patch) {
  const next = Object.assign({}, spotifyVocabulary, patch && typeof patch === 'object' ? patch : {});
  if (patch && patch.ai && typeof patch.ai === 'object') {
    next.ai = Object.assign({}, spotifyVocabulary.ai, patch.ai);
  }
  if (patch && patch.search && typeof patch.search === 'object') {
    next.search = Object.assign({}, spotifyVocabulary.search, patch.search);
  }
  spotifyVocabulary = normalizeSpotifyVocabulary(next);
  saveSpotifyVocabularyFile();
  pushToSpotifyClients({ type: 'spotify_vocabulary', vocabulary: spotifyVocabulary });
  broadcast({ type: 'spotify_vocabulary', vocabulary: spotifyVocabulary });
  // Queda registrado cada cambio de entrenamiento (cuando se toco y que).
  try {
    const contextos = spotifyVocabulary.responses.contexts;
    spotifyAnalytics.recordEvent('vocabulary_saved', {
      musicWords: spotifyVocabulary.musicWords.length,
      requestVerbs: spotifyVocabulary.requestVerbs.length,
      genres: spotifyVocabulary.genres.length,
      respuestas: Object.keys(contextos).length,
      variantes: Object.keys(contextos).reduce((suma, id) => suma + contextos[id].variants.length, 0),
      iaActivada: spotifyVocabulary.ai.enabled === true
    });
  } catch (error) { /* arranque */ }
  return spotifyVocabulary;
}

function spotifyAiKey() {
  return String(process.env.SPOTIFY_AI_API_KEY || process.env.SPOTIFY_AI_KEY || '').trim();
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

// --- Edicion externa de los JSON (a mano o con una IA) ---
// Cada archivo tiene su store: relee solo si cambio de verdad. Antes se leia una
// vez al arrancar y una edicion por fuera quedaba invisible (peor: el siguiente
// guardado del dashboard la pisaba).
const spotifySettingsStore = createFileStore({
  filePath: SPOTIFY_SETTINGS_PATH,
  normalize: normalizeSpotifySettings,
  fallback: DEFAULT_SPOTIFY_SETTINGS,
  label: 'Spotify ajustes'
});
const spotifyVocabularyStore = createFileStore({
  filePath: SPOTIFY_VOCABULARY_PATH,
  normalize: normalizeSpotifyVocabulary,
  fallback: DEFAULT_SPOTIFY_VOCABULARY,
  label: 'Spotify vocabulario'
});
const spotifyAliasesStore = createFileStore({
  filePath: SPOTIFY_ALIASES_PATH,
  normalize: normalizeSpotifyAliases,
  fallback: {},
  label: 'Spotify correcciones'
});

// Relee los tres archivos si cambiaron y avisa a la extension por WebSocket.
// Devuelve que cambio, para poder registrarlo.
function syncSpotifyFiles() {
  const changed = {};
  const freshSettings = spotifySettingsStore.refresh();
  if (freshSettings) {
    spotifySettings = freshSettings;
    applySpotifySettings();
    mirrorLegacySpotifySettings();
    changed.settings = true;
    pushToSpotifyClients({ type: 'spotify_settings', settings: spotifySettings });
  }
  const freshVocabulary = spotifyVocabularyStore.refresh();
  if (freshVocabulary) {
    spotifyVocabulary = freshVocabulary;
    changed.vocabulary = true;
    pushToSpotifyClients({ type: 'spotify_vocabulary', vocabulary: spotifyVocabulary });
    console.log(`[Spotify] Vocabulario recargado del archivo: ${spotifyVocabulary.musicWords.length} palabras, ${spotifyVocabulary.genres.length} generos.`);
  }
  const freshAliases = spotifyAliasesStore.refresh();
  if (freshAliases) {
    spotifyAliases = freshAliases;
    changed.aliases = true;
    pushToSpotifyClients({ type: 'spotify_aliases', aliases: spotifyAliases });
    console.log(`[Spotify] Correcciones recargadas del archivo: ${Object.keys(spotifyAliases).length}.`);
  }
  if (changed.settings) console.log('[Spotify] Ajustes recargados del archivo.');
  return changed;
}

// Los sellos de cada archivo: el dashboard los usa para saber si una edicion
// externa cambio el contenido mientras tenia el formulario abierto.
function spotifyFileStamps() {
  return {
    settings: spotifySettingsStore.stamp(),
    vocabulary: spotifyVocabularyStore.stamp(),
    aliases: spotifyAliasesStore.stamp()
  };
}

function spotifySettingsPublic() {
  return {
    ...spotifySettings,
    // La espera efectiva: en modo prueba el modulo no aplica ninguna.
    effectiveCooldownSeconds: spotifySettings.testMode ? 0 : spotifySettings.cooldownSeconds,
    effectiveUserCooldownSeconds: spotifySettings.testMode ? 0 : spotifySettings.userCooldownSeconds
  };
}

// Ajustes: primera carga (el store relee solo si el archivo cambia afuera).
const settingsInit = spotifySettingsStore.init();
if (!settingsInit.exists) {
  spotifySettings = normalizeSpotifySettings(readLegacySpotifySettings());
  writeSpotifySettingsFile();
  console.log('[Spotify] Ajustes creados en Rulo/Spotify/spotify-settings.json');
} else {
  spotifySettings = normalizeSpotifySettings(spotifySettingsStore.value);
  if (!settingsInit.ok) spotifySettings = { ...DEFAULT_SPOTIFY_SETTINGS };
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

// Correcciones de escritura: primera carga.
const aliasesInit = spotifyAliasesStore.init();
if (aliasesInit.exists && aliasesInit.ok) {
  spotifyAliases = normalizeSpotifyAliases(spotifyAliasesStore.value);
  console.log(`[Spotify] Correcciones de escritura cargadas: ${Object.keys(spotifyAliases).length}.`);
} else if (!aliasesInit.exists) {
  spotifyAliases = {};
  saveSpotifyAliases();
}

// Vocabulario guardado: si no existe, se siembra con los valores por defecto.
const vocabularyInit = spotifyVocabularyStore.init();
if (!vocabularyInit.exists) {
  spotifyVocabulary = normalizeSpotifyVocabulary(DEFAULT_SPOTIFY_VOCABULARY);
  saveSpotifyVocabularyFile();
  console.log('[Spotify] Vocabulario creado en Rulo/Spotify/spotify-vocabulary.json');
} else {
  spotifyVocabulary = normalizeSpotifyVocabulary(spotifyVocabularyStore.value);
  if (vocabularyInit.ok) {
    console.log(`[Spotify] Vocabulario cargado: ${spotifyVocabulary.musicWords.length} palabras de musica, ${spotifyVocabulary.requestVerbs.length} verbos, ${spotifyVocabulary.genres.length} generos.`);
  }
  // Si el archivo todavia no tiene el bloque de respuestas, se completa una vez
  // asi queda visible y editable (el resto del archivo no se toca). El normalize
  // siempre agrega el bloque, asi que hay que mirar el texto crudo del archivo.
  let rawHadResponses = true;
  try { rawHadResponses = /"responses"\s*:/.test(fs.readFileSync(SPOTIFY_VOCABULARY_PATH, 'utf8')); } catch (error) { rawHadResponses = true; }
  if (!rawHadResponses) {
    saveSpotifyVocabularyFile();
    console.log(`[Spotify] Respuestas del bot agregadas al vocabulario (${Object.keys(spotifyVocabulary.responses.contexts).length} contextos).`);
  }
}


app.use(cors());
app.use(express.json());

// Antes de cada consulta de Spotify: si algun JSON cambio afuera (edicion a mano
// o de una IA), se relee y se le avisa a la extension. Ademas un vigilante cada
// 2 s hace lo mismo aunque no haya ningun dashboard abierto, asi el bot toma los
// cambios sin reiniciar nada.
app.use('/api', (req, res, next) => {
  if (req.path.indexOf('/spotify') === 0 || req.path.indexOf('/cortex') === 0) {
    try { syncSpotifyFiles(); } catch (error) { console.warn('[Spotify] No se pudo releer los archivos:', error.message); }
  }
  next();
});

setInterval(() => {
  try { syncSpotifyFiles(); } catch (error) { /* se reintenta en el proximo tick */ }
}, 2000).unref();

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

// Dashboard de entrenamiento del bot (vocabulario, correcciones, cerebro/IA).
app.get('/rulo-spotify-bot.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(WORKSPACE_ROOT, 'Rulo', 'Spotify', 'spotify-bot.html'), error => {
    if (error) next(error);
  });
});

app.get('/rulo-spotify-training.html', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(WORKSPACE_ROOT, 'Rulo', 'Spotify', 'spotify-training.html'), error => {
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
  res.json({ ok: true, settings: spotifySettingsPublic(), defaults: DEFAULT_SPOTIFY_SETTINGS, stamps: spotifyFileStamps() });
});

app.post('/api/spotify-settings', (req, res) => {
  const patch = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {});
  try {
    const settings = saveSpotifySettings({ ...spotifySettings, ...patch });
    console.log('[Spotify] Ajustes guardados desde el dashboard.');
    res.json({ ok: true, settings: spotifySettingsPublic(), stamps: spotifyFileStamps() });
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
    vocabulary: spotifyVocabulary,
    command: commands[0] || null,
    commands,
    stamps: spotifyFileStamps(),
    sessionId: RULO_SESSION_ID,
    serverTime: Date.now()
  });
});

// --- Correcciones de escritura ("laberiso" -> "la beriso") ---
app.get('/api/spotify-aliases', (req, res) => {
  res.json({ success: true, aliases: spotifyAliases, total: Object.keys(spotifyAliases).length, stamps: spotifyFileStamps() });
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

// --- Vocabulario (entrenamiento del bot) ---
app.get('/api/spotify-vocabulary', (req, res) => {
  res.json({
    ok: true,
    vocabulary: spotifyVocabulary,
    defaults: DEFAULT_SPOTIFY_VOCABULARY,
    responseContexts: RESPONSE_CONTEXT_META,
    aiKeyPresent: spotifyAiKey().length > 0,
    stamps: spotifyFileStamps(),
    file: 'Rulo/Spotify/spotify-vocabulary.json'
  });
});

app.post('/api/spotify-vocabulary', (req, res) => {
  try {
    const patch = req.body?.vocabulary && typeof req.body.vocabulary === 'object' ? req.body.vocabulary : (req.body || {});
    const vocabulary = saveSpotifyVocabulary(patch);
    res.json({
      ok: true,
      vocabulary,
      stamps: spotifyFileStamps(),
      aiKeyPresent: spotifyAiKey().length > 0,
      resumen: {
        musicWords: vocabulary.musicWords.length,
        requestVerbs: vocabulary.requestVerbs.length,
        greetings: vocabulary.greetings.length,
        fillers: vocabulary.fillers.length,
        articles: vocabulary.articles.length,
        genres: vocabulary.genres.length,
        commands: vocabulary.commands.length
      }
    });
  } catch (error) {
    console.error('[Spotify] No se pudo guardar el vocabulario:', error);
    res.status(500).json({ ok: false, error: 'No se pudo guardar el vocabulario.' });
  }
});

app.post('/api/spotify-vocabulary-reset', (req, res) => {
  try {
    spotifyVocabulary = normalizeSpotifyVocabulary(DEFAULT_SPOTIFY_VOCABULARY);
    saveSpotifyVocabularyFile();
    pushToSpotifyClients({ type: 'spotify_vocabulary', vocabulary: spotifyVocabulary });
    res.json({ ok: true, vocabulary: spotifyVocabulary, stamps: spotifyFileStamps() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'No se pudo restaurar el vocabulario.' });
  }
});

// --- Cerebro (futuro): interpretar un comentario con la IA configurada ---
function validateAiInterpretation(value) {
  if (!value || typeof value !== 'object') return null;
  const action = String(value.action || '').toLowerCase();
  if (action !== 'play' && action !== 'none') return null;
  const confidence = Number(value.confidence);
  return {
    action,
    query: String(value.query || '').slice(0, 200),
    artist: String(value.artist || '').slice(0, 120),
    title: String(value.title || '').slice(0, 120),
    genre: String(value.genre || '').slice(0, 40),
    confidence: Number.isFinite(confidence) ? Math.round(confidence * 100) / 100 : null,
    reply: String(value.reply || '').slice(0, 200)
  };
}

function extractAiInterpretation(text) {
  const raw = String(text || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.choices?.[0]?.message?.content) return extractAiInterpretation(parsed.choices[0].message.content);
    if (parsed?.interpretation) return validateAiInterpretation(parsed.interpretation);
    if (parsed?.action) return validateAiInterpretation(parsed);
  } catch (error) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return validateAiInterpretation(JSON.parse(match[0]));
  } catch (error) {
    return null;
  }
}

app.post('/api/spotify-ai-interpret', async (req, res) => {
  const ai = spotifyVocabulary.ai || {};
  const comment = String(req.body?.comment || '').trim().slice(0, 400);
  if (!comment) return res.status(400).json({ ok: false, error: 'Falta el comentario.' });
  if (ai.enabled !== true) return res.status(409).json({ ok: false, error: 'La IA esta desactivada en el dashboard de entrenamiento.' });
  if (!ai.endpoint) return res.status(409).json({ ok: false, error: 'Falta configurar el endpoint de la IA.' });

  const key = spotifyAiKey();
  const generos = [...new Set(spotifyVocabulary.genres.map(entry => entry.spotify))];
  const systemPrompt = [
    'Sos el interprete de pedidos de musica de un stream en vivo.',
    'Recibis un comentario del chat y respondes SOLO un objeto JSON, sin texto extra.',
    'Formato: {"action":"play"|"none","artist":"","title":"","genre":"","query":"","confidence":0.0,"reply":""}',
    'Reglas:',
    '- Si el comentario pide musica (aunque este mal escrito), action "play" y completa lo que reconozcas.',
    '- "artist" es el interprete o grupo, "title" el nombre del tema, "query" el texto de busqueda si no separaste artista/tema.',
    '- "genre" solo con uno de estos valores: ' + generos.join(', ') + '.',
    '- Si NO es un pedido de musica, action "none" y reply vacio.',
    '- No inventes: si no estas seguro, deja el campo vacio y baja "confidence".',
    ai.instructions ? 'Instrucciones del streamer: ' + ai.instructions : ''
  ].filter(Boolean).join('\n');

  const isOpenAiStyle = /chat\/completions|responses/.test(ai.endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs || 8000);
  try {
    const response = await fetch(ai.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: `Bearer ${key}` } : {}),
      body: JSON.stringify(isOpenAiStyle
        ? {
            model: ai.model || 'gpt-4o-mini',
            temperature: 0,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: comment }
            ]
          }
        : {
            comment,
            requester: String(req.body?.requester || '').slice(0, 80),
            genres: generos,
            instructions: ai.instructions || ''
          })
    });
    const text = await response.text();
    const fallo = aiFailureMessage(text) || aiFailureMessage(aiEnvelopeError(safeJson(text)));
    if (fallo) {
      console.warn('[Spotify IA] El proveedor rechazo el pedido:', text.slice(0, 200));
      return res.status(502).json({ ok: false, error: fallo });
    }
    const interpretation = extractAiInterpretation(text);
    if (!interpretation) {
      console.warn('[Spotify IA] Respuesta no interpretable:', text.slice(0, 200));
      return res.status(502).json({ ok: false, error: 'La IA no devolvio un pedido valido.' });
    }
    console.log(`[Spotify IA] "${comment.slice(0, 40)}" -> ${interpretation.action} ${interpretation.artist || interpretation.query || interpretation.genre || ''}`.trim());
    res.json({ ok: true, interpretation });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    console.warn('[Spotify IA] Error:', timedOut ? 'timeout' : error.message);
    res.status(502).json({ ok: false, error: timedOut ? 'La IA tardo demasiado.' : 'No se pudo consultar la IA.' });
  } finally {
    clearTimeout(timer);
  }
});

// JSON.parse que no explota (para mirar el error que mando el proveedor).
function safeJson(text) {
  try { return JSON.parse(String(text || '')); } catch (error) { return null; }
}

// Saca las variantes de la respuesta de la IA: array JSON, objeto con "variants"
// o una lista de lineas. Despues limpia cada una para ese contexto (placeholders
// permitidos, largo, sin repetir lo que ya hay).
function extractAiVariants(text, entry, existing, count) {
  const raw = String(text || '').trim();
  const parseCandidate = candidate => {
    if (!candidate) return null;
    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    const source = arrayMatch ? arrayMatch[0] : candidate;
    let parsed = null;
    try { parsed = JSON.parse(source); } catch (error) { parsed = null; }
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.variants)) parsed = parsed.variants;
    if (Array.isArray(parsed)) {
      return parsed.map(item => (item && typeof item === 'object' ? item.text || item.variant || item.message : item));
    }
    // Ultimo recurso: lineas sueltas sin numeracion ni vinetas.
    return candidate
      .split(/\r?\n/)
      .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  };

  let candidates = parseCandidate(raw);
  try {
    const envelope = JSON.parse(raw);
    const content = envelope?.choices?.[0]?.message?.content || envelope?.content || envelope?.text;
    if (typeof content === 'string') candidates = parseCandidate(content);
  } catch (error) { /* no vino envuelto */ }

  const seen = (existing || []).map(item => variantKey(item)).filter(Boolean);
  const out = [];
  (candidates || []).forEach(item => {
    const clean = cleanVariantFor(entry, item);
    if (!clean || clean.length < 6) return;
    // Nada que sea en realidad un error del proveedor entra como respuesta.
    if (aiFailureMessage(clean)) return;
    if (!/\s/.test(clean)) return;
    const key = variantKey(clean);
    if (!key) return;
    // Se descarta si es igual a una que ya existe o si la contiene
    // ("Repetida: Listo {nombre}, ya se esta reproduciendo...", por ejemplo).
    const repetida = seen.some(other => other === key || (other.length >= 12 && key.indexOf(other) !== -1) || (key.length >= 12 && other.indexOf(key) !== -1));
    if (repetida) return;
    seen.push(key);
    out.push(clean);
  });
  const limit = Math.min(6, Math.max(1, Math.round(Number(count) || 3)));
  return out.slice(0, limit);
}

app.post('/api/spotify-ai-replies', async (req, res) => {
  const contextId = String(req.body?.context || '').trim();
  const entry = RESPONSE_CONTEXTS.find(item => item.id === contextId);
  if (!entry) return res.status(400).json({ ok: false, error: 'Ese contexto de respuesta no existe.' });

  const count = Math.min(6, Math.max(1, Math.round(Number(req.body?.count) || 3)));
  const ai = spotifyVocabulary.ai || {};
  if (ai.enabled !== true) return res.status(409).json({ ok: false, error: 'El cerebro (IA) esta apagado. Activalo en la seccion Cerebro de la pagina de entrenamiento.' });
  if (!ai.endpoint) return res.status(409).json({ ok: false, error: 'Falta configurar el endpoint de la IA.' });

  const key = spotifyAiKey();
  const current = (spotifyVocabulary.responses.contexts[contextId] || {}).variants || [];
  const placeholders = (entry.placeholders || []).map(name => '{' + name + '}');
  const systemPrompt = [
    'Sos Rulo, el bot musical de un stream en vivo en Argentina. Hablas en rioplatense, informal y corto.',
    'Escribis SOLO un array JSON de strings, sin texto extra.',
    'Tenes que escribir ' + count + ' formas NUEVAS de avisar lo mismo en este momento del pedido: ' + entry.label + '.',
    placeholders.length
      ? 'Podes usar estos datos entre llaves: ' + placeholders.join(' ') + '. No inventes otros placeholders.'
      : 'No uses placeholders entre llaves.',
    'Cada variante tiene que ser una frase completa y natural, de una sola linea, sin comillas raras.',
    'No repitas ninguna de las que ya existen: ' + (current.slice(0, 8).join(' | ') || '(todavia no hay)'),
    'No agregues emojis ni texto fuera del array.',
    ai.instructions ? 'Instrucciones del streamer: ' + ai.instructions : ''
  ].filter(Boolean).join('\n');

  const isOpenAiStyle = /chat\/completions|responses/.test(ai.endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs || 8000);
  try {
    const response = await fetch(ai.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: `Bearer ${key}` } : {}),
      body: JSON.stringify(isOpenAiStyle
        ? {
            model: ai.model || 'gpt-4o-mini',
            temperature: 0.9,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: 'Contexto: ' + entry.label + '. Escribi ' + count + ' variantes nuevas.' }
            ]
          }
        : {
            context: contextId,
            label: entry.label,
            placeholders: entry.placeholders || [],
            existing: current.slice(0, 8),
            count,
            instructions: ai.instructions || ''
          })
    });
    const text = await response.text();
    const fallo = aiFailureMessage(text) || aiFailureMessage(aiEnvelopeError(safeJson(text)));
    if (fallo) {
      console.warn('[Spotify IA] El proveedor rechazo el pedido:', text.slice(0, 200));
      return res.status(502).json({ ok: false, error: fallo });
    }
    const generadas = extractAiVariants(text, entry, current, count);
    if (!generadas.length) {
      console.warn('[Spotify IA] Variantes no interpretables:', text.slice(0, 200));
      return res.status(502).json({ ok: false, error: 'La IA no devolvio variantes validas.' });
    }
    // Se guardan solas y quedan marcadas como de IA (asi despues se puede saber
    // si la respuesta que salio al aire la escribio la IA o es de fabrica).
    const agregadas = addAiVariants(spotifyVocabulary.responses, contextId, generadas);
    if (!agregadas.length) {
      return res.status(502).json({ ok: false, error: 'La IA no devolvio variantes nuevas (repitio las que ya estaban).' });
    }
    saveSpotifyVocabulary({});
    console.log(`[Spotify IA] ${agregadas.length} variantes nuevas para "${contextId}" (marcadas como de IA).`);
    try {
      spotifyAnalytics.recordEvent('ai_replies', { context: contextId, count, variants: agregadas.length }, ai.model || '');
    } catch (error) { /* nada */ }
    res.json({ ok: true, context: contextId, variants: agregadas, vocabulary: spotifyVocabulary });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    console.warn('[Spotify IA] Error generando respuestas:', timedOut ? 'timeout' : error.message);
    res.status(502).json({ ok: false, error: timedOut ? 'La IA tardo demasiado.' : 'No se pudo consultar la IA.' });
  } finally {
    clearTimeout(timer);
  }
});

// --- Analisis (SQLite): todo lo que pasa con los pedidos, para buscar mejoras ---
const spotifyAnalytics = createAnalytics({
  filePath: path.join(SPOTIFY_DIR, 'spotify-analytics.db'),
  session: RULO_SESSION_ID,
  log: mensaje => console.warn('[Spotify analisis] ' + mensaje)
});
if (spotifyAnalytics.enabled) {
  console.log('[Spotify] Historial de analisis listo: Rulo/Spotify/spotify-analytics.db');
}

app.get('/api/spotify-analytics', (req, res) => {
  const stats = spotifyAnalytics.stats(req.query?.dias);
  if (!stats) return res.status(503).json({ ok: false, error: 'El historial de analisis no esta disponible en este Node.' });
  // Avisos: lo que conviene mirar (tasa de no encontrados, pedidos repetidos, saltos...).
  stats.avisos = spotifyAnalytics.avisos(req.query?.dias);
  res.json({ ok: true, analytics: stats });
});

// Avisos sueltos (los usa el recordatorio semanal).
app.get('/api/spotify-analytics-alerts', (req, res) => {
  res.json({ ok: true, avisos: spotifyAnalytics.avisos(req.query?.dias), recordatorio: (spotifyAnalytics.stats(req.query?.dias) || {}).recordatorio || null });
});

// Marcar como revisado: apaga el recordatorio hasta que haya algo nuevo.
app.post('/api/spotify-analytics-reviewed', (req, res) => {
  res.json({ ok: true, marcadas: spotifyAnalytics.markReviewed() });
});

// Que la IA proponga como arreglar los pedidos que no se encontraron.
app.post('/api/spotify-ai-suggest', async (req, res) => {
  const ai = spotifyVocabulary.ai || {};
  const filas = spotifyAnalytics.rows({ dias: req.body?.dias || 30, limite: 40, estado: 'notfound' });
  const comentarios = [];
  filas.forEach(fila => {
    const texto = String(fila.comment || '').trim();
    if (texto && comentarios.indexOf(texto) === -1 && comentarios.length < 15) comentarios.push(texto);
  });
  if (!comentarios.length) {
    return res.status(400).json({ ok: false, error: 'Todavia no hay pedidos sin encontrar en el historial.' });
  }
  if (ai.enabled !== true) return res.status(409).json({ ok: false, error: 'El cerebro (IA) esta apagado. Activalo en Entrenamiento -> Cerebro (IA).' });
  if (!ai.endpoint) return res.status(409).json({ ok: false, error: 'Falta configurar el endpoint de la IA.' });

  const key = spotifyAiKey();
  const generos = [...new Set(spotifyVocabulary.genres.map(entry => entry.spotify))];
  const artistas = [...new Set(spotifyVocabulary.aliases ? Object.values(spotifyVocabulary.aliases) : [])].slice(0, 20);
  const systemPrompt = [
    'Sos el que entrena a Rulo, el bot musical de un stream en vivo. Te paso comentarios que pidieron musica y NO se encontraron en Spotify.',
    'Para cada uno decidi que paso y que habria que cargar. Responde SOLO un array JSON, sin texto extra.',
    'Formato: [{"comment":"<el comentario tal cual>","problema":"<que fallo, corto>","tipo":"alias|cancion|artista|palabra|genero|nada","de":"<lo que escribio la persona>","a":"<lo que deberia buscar>"}]',
    'Reglas:',
    '- tipo "alias" cuando esta mal escrito o abreviado (de -> a, ejemplo: "laberiso" -> "la beriso").',
    '- tipo "cancion" o "artista" cuando el nombre esta bien pero el bot no lo encontro en Spotify (a = nombre probable).',
    '- tipo "palabra" cuando usan una palabra de pedido que el bot no conoce (de = la palabra).',
    '- tipo "genero" cuando piden un genero que no esta en la lista: ' + generos.join(', ') + '.',
    '- tipo "nada" si no es un pedido de musica o no se puede deducir.',
    '- Usa exactamente los comentarios que te paso, sin inventar otros.',
    '- No repitas lo que ya esta: los generos son ' + generos.join(', ') + ' y ya hay correcciones como ' + (artistas.join(', ') || '(ninguna)') + '.',
    ai.instructions ? 'Instrucciones del streamer: ' + ai.instructions : ''
  ].filter(Boolean).join('\n');

  const isOpenAiStyle = /chat\/completions|responses/.test(ai.endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs || 8000);
  try {
    const response = await fetch(ai.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: `Bearer ${key}` } : {}),
      body: JSON.stringify(isOpenAiStyle
        ? {
            model: ai.model || 'gpt-4o-mini',
            temperature: 0.3,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: comentarios.map((texto, indice) => indice + 1 + '. ' + texto).join('\n') }
            ]
          }
        : { comentarios, generos, instructions: ai.instructions || '' })
    });
    const text = await response.text();
    const fallo = aiFailureMessage(text) || aiFailureMessage(aiEnvelopeError(safeJson(text)));
    if (fallo) return res.status(502).json({ ok: false, error: fallo });
    const sugerencias = parseAiSuggestions(text, comentarios);
    if (!sugerencias.length) {
      console.warn('[Spotify IA] Sugerencias no interpretables:', text.slice(0, 200));
      return res.status(502).json({ ok: false, error: 'La IA no devolvio sugerencias validas.' });
    }
    console.log(`[Spotify IA] ${sugerencias.length} sugerencias para los pedidos que no se encontraron.`);
    try { spotifyAnalytics.recordEvent('ai_suggest', { comentarios: comentarios.length, sugerencias: sugerencias.length }, ai.model || ''); } catch (error) { /* nada */ }
    res.json({ ok: true, sugerencias, analizados: comentarios.length });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    console.warn('[Spotify IA] Error sugiriendo:', timedOut ? 'timeout' : error.message);
    res.status(502).json({ ok: false, error: timedOut ? 'La IA tardo demasiado.' : 'No se pudo consultar la IA.' });
  } finally {
    clearTimeout(timer);
  }
});

app.get('/api/spotify-analytics-rows', (req, res) => {
  res.json({
    ok: true,
    rows: spotifyAnalytics.rows({ dias: req.query?.dias, limite: req.query?.limite, estado: req.query?.estado }),
    file: 'Rulo/Spotify/spotify-analytics.db'
  });
});

app.get('/api/spotify-analytics.csv', (req, res) => {
  const contenido = spotifyAnalytics.csv(req.query?.dias);
  const dias = Math.max(1, Math.min(3650, Number(req.query?.dias) || 30));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="rulo-spotify-analisis-${dias}d.csv"`);
  res.send(contenido);
});

// --- Estado de la instalacion: sirve para verificar despues de actualizar SSN ---
app.get('/api/cortex-install-status', (req, res) => {
  const now = Date.now();
  const sinceClient = spotifyClientStatus.lastSeenAt ? now - spotifyClientStatus.lastSeenAt : null;
  res.json({
    ok: true,
    moduleVersion: typeof SPOTIFY_MODULE_VERSION === 'number' ? SPOTIFY_MODULE_VERSION : null,
    baseUrl: typeof CORTEX_BASE_URL === 'string' ? CORTEX_BASE_URL : '',
    install: typeof ssnInstallStatus === 'object' ? ssnInstallStatus : { ok: false, steps: [], warnings: ['Sin datos: el backend no aplico el parcheo.'] },
    extension: {
      ...spotifyClientStatus,
      sinceLastSeenMs: sinceClient,
      connected: sinceClient !== null && sinceClient < 15000,
      push: spotifySockets.size > 0
    },
    checkedAt: now
  });
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
  // Historial completo en SQLite: el JSON del dashboard guarda solo los ultimos 50.
  const reply = body.reply && typeof body.reply === 'object' ? body.reply : {};
  const parsed = body.parsed && typeof body.parsed === 'object' ? body.parsed : {};
  spotifyAnalytics.recordInteraction({
    timestamp: entry.timestamp,
    source: entry.source,
    platform: body.platform,
    requester: entry.requester,
    requesterId: body.requesterId,
    comment: body.comment,
    isRequest: body.isRequest === true || !!entry.query || !!parsed.query,
    parsedSource: parsed.source || body.parsed_source,
    artist: parsed.artist || body.artist,
    title: parsed.title || body.title,
    genre: parsed.genre || body.genre,
    query: entry.query || parsed.query,
    status: String(body.status || '').slice(0, 30) || (entry.ok ? 'played' : 'error'),
    reason: entry.message,
    ok: entry.ok,
    aiInterpreted: body.aiInterpreted === true,
    aiModel: body.aiModel,
    replyText: reply.text || body.replyText,
    replyContext: reply.context,
    replyVariant: reply.variant,
    replyRandom: reply.random,
    replyAi: reply.ai === true || body.replyAi === true,
    trackName: track && track.name,
    trackArtist: track && track.artist,
    trackUri: track && track.uri,
    trackSource: body.trackSource,
    seconds: body.seconds,
    durationMs: body.durationMs,
    // Cuanto tiempo paso desde que sono el tema: sirve para el enganche.
    sincePlayMs: body.sincePlayMs
  });
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
    stamps: spotifyFileStamps(),
    // Recordatorio: cuantas interacciones quedan sin revisar en el analisis.
    analytics: (() => {
      try {
        const stats = spotifyAnalytics.stats(7);
        return stats && stats.recordatorio ? stats.recordatorio : null;
      } catch (error) {
        return null;
      }
    })(),
    aliases: spotifyAliases,
    vocabulary: spotifyVocabulary,
    aiKeyPresent: spotifyAiKey().length > 0,
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
// Todo el parcheo vive en ssn-patcher.js y se aplica en cada arranque, con
// verificacion. El resultado queda en ssnInstallStatus y se ve en
// GET /api/cortex-install-status.
const ssnInstallStatus = (() => {
    const { applySsnPatches } = require('./ssn-patcher');
    try {
        const status = applySsnPatches({
            ssnDir: SSN_PATH,
            moduleVersion: SPOTIFY_MODULE_VERSION,
            cortexBaseUrl: CORTEX_BASE_URL,
            ruloSessionId: RULO_SESSION_ID,
            overrides: [
                { id: 'stable-session', file: 'stable-ssn-session-id.js', source: path.resolve(__dirname, '../integrations/spotify-auto-music/stable-ssn-session-id.js') },
                { id: 'spotify-auto-music', file: 'spotify-auto-music.js', source: path.resolve(__dirname, '../integrations/spotify-auto-music/spotify-auto-music.js') },
                { id: 'spotify-relay', file: 'spotify-cortex-overlay-relay.js', source: path.resolve(__dirname, '../integrations/spotify-auto-music/spotify-cortex-overlay-relay.js') },
                { id: 'rulo-chat-relay', file: 'rulo-chat-relay.js', source: path.resolve(WORKSPACE_ROOT, 'Rulo/rulo-chat-relay.js') }
            ],
            log: message => console.log('[SSN Auto-Patcher] ' + message)
        });
        status.steps.forEach(step => console.log(`[SSN Auto-Patcher] ${step.ok ? 'OK   ' : 'FALLA'} ${step.id}: ${step.detail}`));
        status.warnings.forEach(warning => console.warn('[SSN Auto-Patcher] AVISO: ' + warning));
        if (status.ok) {
            console.log(`[SSN Auto-Patcher] Extension lista (SSN ${status.ssnVersion || '?'}): ${status.steps.length} verificaciones OK.`);
        } else {
            console.error('[SSN Auto-Patcher] REVISAR: hay pasos con problemas. Mirar /api/cortex-install-status o MIGRAR-SOCIALSTREAM.md');
        }
        return status;
    } catch (error) {
        console.error('[SSN Auto-Patcher] Error parcheando SocialStream Ninja:', error);
        return { ok: false, steps: [], warnings: [error.message], generatedAt: Date.now() };
    }
})();
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
