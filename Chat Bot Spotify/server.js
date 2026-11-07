'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const SpotifyBot = require('./src/spotify');
const FacebookStatsStore = require('./src/facebook-stats');
const { streamId: facebookStreamId } = require('./extension/facebook-stats');
const facebookStats = new FacebookStatsStore();
let statsDelivery = Promise.resolve();

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PORT = Number(process.env.CHAT_BOT_SPOTIFY_PORT || 9765);
const HOST = process.env.CHAT_BOT_SPOTIFY_HOST || '0.0.0.0';
const MAX_BODY = 64 * 1024;
const MAX_RECENT = 120;

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_CONFIG = {
  enabled: false,
  captureFacebook: false,
  spotifyEnabled: false,
  testMode: false,
  cortexBaseUrl: process.env.CORTEX_BASE_URL || 'http://127.0.0.1:4000',
  forwardToCortex: true,
  spotifyClientId: '',
  spotifyRedirectUri: `http://127.0.0.1:${PORT}/spotify/callback`,
  apiToken: crypto.randomBytes(32).toString('hex')
};

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const testMode = saved.testMode === true;
    const { rouletteBaseUrl, forwardToRoulette, ...currentSettings } = saved;
    return { ...DEFAULT_CONFIG, ...currentSettings, testMode, apiToken: saved.apiToken || DEFAULT_CONFIG.apiToken };
  } catch (_) {
    return { ...DEFAULT_CONFIG };
  }
}

let config = loadConfig();
function saveConfig() {
  const temporaryPath = `${CONFIG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(temporaryPath, CONFIG_FILE);
}
saveConfig();

const clients = new Set();
const recentMessages = [];
const seenIds = new Set();
const captureStatuses = new Map();
let cortexArchiveCapability = { checkedAt: 0, supported: false };
const health = {
  startedAt: Date.now(),
  facebookLastSeenAt: 0,
  cortex: 'unknown',
  lastEventAt: 0,
  lastError: ''
};
let featuredMessage = null;

function cleanBaseUrl(value, fallback) {
  try {
    const url = new URL(String(value || fallback));
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    return url.origin;
  } catch (_) {
    return fallback;
  }
}

function publicConfig() {
  return {
    enabled: config.enabled === true,
    captureFacebook: config.captureFacebook === true,
    spotifyEnabled: config.spotifyEnabled === true,
    testMode: config.testMode === true,
    forwardToCortex: config.forwardToCortex !== false,
    cortexBaseUrl: cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000'),
    spotifyClientId: String(config.spotifyClientId || ''),
    spotifyRedirectUri: String(config.spotifyRedirectUri || `http://127.0.0.1:${PORT}/spotify/callback`)
  };
}

function isLoopback(req) {
  const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1' || address.startsWith('127.');
}

function isThisComputer(req) {
  if (isLoopback(req)) return true;
  const normalize = value => String(value || '').toLowerCase().replace(/^::ffff:/, '').split('%')[0];
  const remoteAddress = normalize(req.socket.remoteAddress);
  if (!remoteAddress) return false;
  const localAddresses = Object.values(os.networkInterfaces()).flat()
    .filter(Boolean)
    .map(address => normalize(address.address));
  return localAddresses.includes(remoteAddress);
}

function isAuthorized(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.headers['x-chat-bot-token'] || '');
  if (!token || token.length !== config.apiToken.length) return false;
  const provided = Buffer.from(token);
  const expected = Buffer.from(config.apiToken);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY) {
        reject(Object.assign(new Error('El cuerpo supera el límite permitido.'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(Object.assign(new Error('JSON inválido.'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function isPrivateIpv4(host) {
  return host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('127.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function isAllowedBrowserOrigin(origin) {
  if (!origin) return false;
  if (/^chrome-extension:\/\//i.test(origin)) return true;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host.endsWith('.localhost') || isPrivateIpv4(host)
      || host === '::1' || host.startsWith('fc') || host.startsWith('fd');
  } catch (_) { return false; }
}

function setCors(req, res) {
  // The browser extension uses a bearer token and the OBS Browser Source only
  // reads the local SSE feed. No cookies or ambient credentials are accepted.
  const origin = String(req.headers.origin || '');
  const pathname = String(req.url || '').split('?')[0];
  const extensionOrigin = /^chrome-extension:\/\//i.test(origin);
  const safeExtensionRead = ['/api/status', '/api/spotify/status'].includes(pathname);
  if (isAllowedBrowserOrigin(origin) && (!extensionOrigin || req.method === 'OPTIONS' || safeExtensionRead || isAuthorized(req))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Chat-Bot-Token');
  res.setHeader('Vary', 'Origin');
}

function sendSse(type, payload) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach(client => {
    try { client.write(frame); }
    catch (_) { clients.delete(client); }
  });
}

function publish(type, payload) {
  const event = { type, payload, timestamp: Date.now() };
  sendSse(type, payload);
  health.lastEventAt = event.timestamp;
}

function safeUrl(value) {
  const text = String(value || '').trim();
  if (text.length > 4000) return '';
  try {
    const url = new URL(text);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString().slice(0, 4000) : '';
  } catch (_) { return ''; }
}

function safeAvatar(value) {
  const text = String(value || '').trim();
  if (text.length <= 40000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(text)) return text;
  const urlText = safeUrl(text);
  if (!urlText) return '';
  try {
    const url = new URL(urlText);
    const host = url.hostname.toLowerCase();
    if ((host.endsWith('.fbcdn.net') || host.endsWith('.fbsbx.com'))
      && (host.startsWith('static.') || /\/(?:rsrc\.php|images\/emoji\.php|emg1|emoji)(?:\/|$)/i.test(url.pathname))) return '';
    return urlText;
  } catch (_) { return ''; }
}

function normalizeEvent(input) {
  const source = input && typeof input === 'object' ? input : {};
  const type = String(source.type || source.platform || 'facebook').trim().toLowerCase().slice(0, 32);
  const chatname = String(source.chatname || source.username || source.name || '').trim().slice(0, 120);
  const chatmessage = String(source.chatmessage || source.message || '').slice(0, 5000);
  const meta = source.meta && typeof source.meta === 'object' && !Array.isArray(source.meta) ? source.meta : {};
  const suppliedTraceId = String(source.traceId || meta.traceId || '').trim();
  const traceId = /^[a-zA-Z0-9_-]{8,80}$/.test(suppliedTraceId) ? suppliedTraceId : crypto.randomUUID();
  const traceStartedAt = Date.now();
  const suppliedId = String(source.id || source.mid || meta.messageId || '').trim().slice(0, 180);
  const id = suppliedId ? `${type}:${suppliedId}` : `${type}:${crypto.randomUUID()}`;
  const timestamp = Number(source.timestamp);
  const normalized = {
    id,
    mid: suppliedId || id,
    platform: type,
    type,
    chatname,
    chatmessage,
    chatimg: safeAvatar(source.chatimg),
    contentimg: safeUrl(source.contentimg),
    chatbadges: Array.isArray(source.chatbadges) ? source.chatbadges.slice(0, 12) : [],
    userid: String(source.userid || source.userId || source.facebookUserId || '').slice(0, 160),
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    textonly: source.textonly !== false,
    traceId,
    traceStartedAt,
    meta: { ...meta, traceId, traceStartedAt }
  };
  const captureId = String(source.captureId || meta.captureId || '').trim().slice(0, 180);
  const accountLabel = String(source.accountLabel || meta.accountLabel || '').trim().slice(0, 100);
  const streamId = String(source.streamId || meta.streamId || meta.videoId || '').trim().slice(0, 180);
  if (captureId) normalized.meta.captureId = captureId;
  if (accountLabel) normalized.meta.accountLabel = accountLabel;
  if (streamId) normalized.meta.streamId = streamId;
  if (Number.isInteger(Number(meta.tabId))) normalized.meta.tabId = Number(meta.tabId);
  if (source.avatarUpdateOnly === true) normalized.avatarUpdateOnly = true;
  if (source.event) normalized.event = String(source.event).slice(0, 80);
  if (source.hasDonation) normalized.hasDonation = String(source.hasDonation).slice(0, 120);
  if (source.donoValue !== undefined && Number.isFinite(Number(source.donoValue))) normalized.donoValue = Number(source.donoValue);
  if (source.isAlert === true) normalized.isAlert = true;
  if (type === 'facebook' && normalized.userid) normalized.facebookUserId = String(source.facebookUserId || normalized.userid).slice(0, 160);
  return normalized;
}

async function postJson(url, body, timeoutMs = 4500, extraHeaders = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok) throw new Error(json?.error || json?.message || `HTTP ${response.status}`);
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function reportTrace(messageOrTraceId, stage, status, details = {}) {
  const traceId = typeof messageOrTraceId === 'string'
    ? messageOrTraceId
    : String(messageOrTraceId?.meta?.traceId || messageOrTraceId?.traceId || '');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(traceId) || !config.forwardToCortex || config.testMode) return;
  const base = cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000');
  void postJson(`${base}/api/event-traces`, { traceId, component: 'chat-bot-spotify', stage, status, details, timestamp: Date.now() }, 2000, {
    Authorization: `Bearer ${config.apiToken}`
  }).catch(() => {});
}

function getCaptureStatus(captureId) {
  return captureStatuses.get(String(captureId || '')) || null;
}

function updateCaptureDelivery(message, destination, state, error = '') {
  const captureId = String(message?.meta?.captureId || '');
  if (!captureId) return;
  const current = getCaptureStatus(captureId);
  if (!current) return;
  const now = Date.now();
  current[`last${destination}State`] = state;
  current[`last${destination}At`] = now;
  if (error) current.lastError = `${destination}: ${String(error).slice(0, 240)}`;
  else if (current.lastError.startsWith(`${destination}:`)) current.lastError = '';
  captureStatuses.set(captureId, current);
  publish('capture_status', publicCaptures());
}

function publicCaptures() {
  const now = Date.now();
  return [...captureStatuses.values()]
    .sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
    .slice(0, 32)
    .map(status => ({ ...status, connected: now - Number(status.lastSeenAt || 0) < 15000 }));
}

function normalizeCaptureStatus(body) {
  const source = body && typeof body === 'object' ? body : {};
  const instanceId = String(source.instanceId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const tabId = Number(source.tabId);
  if (!instanceId || !Number.isInteger(tabId) || tabId < 0) return null;
  const pageUrl = safeUrl(source.pageUrl);
  let facebookUrl = '';
  try {
    const parsed = new URL(pageUrl);
    if (parsed.protocol === 'https:' && /(^|\.)facebook\.com$/i.test(parsed.hostname)) facebookUrl = `${parsed.origin}${parsed.pathname}`.slice(0, 500);
  } catch (_) {}
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1000000, Math.floor(Number(value)))) : 0;
  const timestamp = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  return {
    captureId: `${instanceId}:${tabId}`,
    instanceId,
    tabId,
    accountLabel: String(source.accountLabel || 'Cuenta Facebook').trim().slice(0, 100),
    pageUrl: facebookUrl,
    streamId: String(source.streamId || '').trim().slice(0, 180),
    videoContext: source.videoContext === true,
    active: source.active === true,
    visible: source.visible === true,
    visibleCommentRows: number(source.visibleCommentRows),
    recognizedComments: number(source.recognizedComments),
    commentsDetected: number(source.commentsDetected),
    commentsSent: number(source.commentsSent),
    commentsFailed: number(source.commentsFailed),
    lastScanAt: timestamp(source.lastScanAt),
    lastCommentDetectedAt: timestamp(source.lastCommentDetectedAt),
    lastCommentSentAt: timestamp(source.lastCommentSentAt),
    lastSendState: String(source.lastSendState || 'unknown').slice(0, 24),
    lastError: String(source.lastError || '').trim().slice(0, 240),
    lastSeenAt: Date.now(),
    lastCortexState: 'pending',
    lastRouletteState: 'pending'
  };
}

async function cortexSupportsTestIsolation(base) {
  if (Date.now() - cortexArchiveCapability.checkedAt < 5000) return cortexArchiveCapability.supported;
  cortexArchiveCapability.checkedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${base}/api/rulo-chat-archive-capability`, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    cortexArchiveCapability.supported = response.ok && data.excludeFromProgramArchive === true && data.isolatedTestMode === true;
  } catch (_) {
    cortexArchiveCapability.supported = false;
  } finally {
    clearTimeout(timer);
  }
  return cortexArchiveCapability.supported;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0].slice(0, 80);
}

async function forwardToCortex(message) {
  if (!config.forwardToCortex) {
    updateCaptureDelivery(message, 'Cortex', 'disabled');
    reportTrace(message, 'cortex.forward', 'skipped', { source: 'facebook', result: 'disabled' });
    return;
  }
  const base = cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000');
  try {
    if (message.event === 'viewer_update' || message.event === 'viewer_updates') {
      const meta = message.meta && typeof message.meta === 'object' ? message.meta : null;
      if (!meta || /\/live\/producer\//i.test(meta.pageUrl || '')) return;
      const streamId = facebookStreamId(meta.pageUrl) || String(meta.streamId || '');
      facebookStats.update(streamId, 'video', { currentViewers: meta.facebook }, meta.accountLabel);
      await forwardFacebookTotals();
    } else if (message.event === 'facebook_comment_count_update') {
      await postJson(`${base}/api/stream-comment-count`, { count: Number(message.meta), platform: 'facebook' });
    } else if (message.chatname && message.chatmessage) {
      if (config.testMode && !await cortexSupportsTestIsolation(base)) {
        health.cortex = 'restart-required';
        health.lastError = 'Reinicia Control Cortex para activar el aislamiento completo de pruebas.';
        updateCaptureDelivery(message, 'Cortex', 'error', health.lastError);
        return;
      }
      const meta = message.meta && typeof message.meta === 'object' ? message.meta : {};
      const result = await postJson(`${base}/api/rulo-chat-message`, {
        comment: message.chatmessage,
        requester: message.chatname,
        userid: message.userid,
        facebookUserId: message.facebookUserId || message.userid,
        chatimg: message.chatimg,
        id: message.mid || message.id,
        timestamp: message.timestamp,
        source: message.type,
        sourceCaptureId: meta.captureId || '',
        traceId: message.traceId || meta.traceId || '',
        traceStartedAt: Number(message.traceStartedAt || meta.traceStartedAt) || Date.now(),
        captureAccount: meta.accountLabel || '',
        streamId: meta.streamId || meta.videoId || '',
        meta,
        testMode: config.testMode === true,
        avatarUpdateOnly: message.avatarUpdateOnly === true,
        event: message.event || '',
        isAlert: message.isAlert === true || message.event === 'alert',
        excludeFromProgramArchive: config.testMode === true
      }, 4500, { Authorization: `Bearer ${config.apiToken}` });
      updateCaptureDelivery(message, 'Cortex', 'ok');
      reportTrace(message, 'cortex.forward', result?.duplicate ? 'duplicate' : 'ok', { source: 'facebook', result: result?.duplicate ? 'duplicate' : 'accepted' });
    }
    health.cortex = 'connected';
  } catch (error) {
    health.cortex = 'error';
    health.lastError = `Cortex: ${error.message}`;
    updateCaptureDelivery(message, 'Cortex', 'error', error.message);
    reportTrace(message, 'cortex.forward', 'failed', { source: 'facebook', result: 'error' });
  }
}

function forwardFacebookTotals() {
  statsDelivery = statsDelivery.catch(() => {}).then(async () => {
    if (!config.enabled || !config.forwardToCortex) return;
    const primary = facebookStats.primaryTotals();
    const totals = facebookStats.accountTotals();
    const base = cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000');
    if (primary.currentViewers !== null) {
      await postJson(base + '/api/viewer-count', { counts: { facebook: primary.currentViewers }, replace: false });
    }
    if (primary.comments !== null) {
      await postJson(base + '/api/stream-comment-count', { count: primary.comments, platform: 'facebook' });
    }
    if (totals.currentViewers !== null || totals.comments !== null) {
      try { await postJson(base + '/api/facebook-account-totals', totals); }
      catch (error) { console.warn('[Chat Bot Spotify] Cortex aún no acepta los totales combinados de Facebook:', error.message); }
    }
  });
  return statsDelivery;
}

async function forwardToRoulette(message) {
  if (!message.chatname || !message.chatmessage || message.event) return;
  // La ruleta ya no recibe comentarios automáticamente; se sincroniza desde
  // el historial normal de Rulo cuando el operador pulsa "Obtener participantes".
  updateCaptureDelivery(message, 'Roulette', 'disabled');
  reportTrace(message, 'roulette.sync', 'skipped', { source: 'facebook', result: 'manual_sqlite_sync' });
}

const spotifyBot = new SpotifyBot({
  tokenFile: path.join(DATA_DIR, 'spotify-token.json'),
  getConfig: () => config,
  saveConfig: value => { config = value; saveConfig(); },
  getCortexBaseUrl: () => cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000'),
  publish,
  sendBotReply: async (text, requester, mood, provisional = false, isolatedTest = false, metadata = {}) => {
    if (!config.forwardToCortex || (config.testMode && !isolatedTest)) return;
    try {
      return await postJson(`${cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000')}/api/rulo-bot-message`, {
        message: String(text).slice(0, 500),
        requester: firstName(requester),
        traceId: String(metadata?.traceId || '').slice(0, 80),
        source: isolatedTest ? 'isolated-test' : 'request',
        isolatedTest: isolatedTest === true,
        simulationCommentId: isolatedTest ? String(metadata?.simulationCommentId || '').slice(0, 120) : '',
        interpretationSource: ['ai', 'rules', 'rules-fallback'].includes(metadata?.interpretationSource) ? metadata.interpretationSource : '',
        mood,
        provisional,
        timestamp: Date.now()
      });
    } catch (error) {
      health.lastError = `Respuesta Rulo: ${error.message}`;
    }
  },
  generateAiReply: async payload => {
    if (!config.forwardToCortex || (config.testMode && payload?.isolatedTest !== true)) return '';
    const base = cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000');
    const result = await postJson(`${base}/api/spotify-ai-reply`, payload, 6000, { Authorization: `Bearer ${config.apiToken}` });
    if (result?.ok === true && result.reply) return result.reply;
    throw new Error(result?.error || 'La IA no generó una respuesta válida.');
  },
  logRequest: async entry => {
    if (!config.forwardToCortex || config.testMode) return;
    try {
      await postJson(`${cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000')}/api/spotify-request-log`, entry);
    } catch (error) {
      health.lastError = `Registro Spotify: ${error.message}`;
    }
  },
  reportDevices: async devices => {
    if (!config.forwardToCortex || config.testMode) return;
    try {
      await postJson(`${cleanBaseUrl(config.cortexBaseUrl, 'http://127.0.0.1:4000')}/api/spotify-devices-report`, {
        devices,
        activeName: devices.find(device => device.is_active)?.name || ''
      });
    } catch (error) {
      health.lastError = `Dispositivos Spotify: ${error.message}`;
    }
  }
});

function localFeatureOrigin(origin, requestHost) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.port !== '4000') return false;
    const host = url.hostname.toLowerCase();
    const target = new URL(`http://${String(requestHost || '')}`);
    const normalizedHost = host === 'localhost' ? '127.0.0.1' : host.replace(/^\[|\]$/g, '');
    const normalizedTarget = target.hostname.toLowerCase() === 'localhost' ? '127.0.0.1' : target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLocalHost = normalizedHost === '127.0.0.1' || normalizedHost === '::1' || normalizedHost === 'localhost'
      || isPrivateIpv4(normalizedHost) || normalizedHost.startsWith('fc') || normalizedHost.startsWith('fd');
    return isLocalHost && normalizedHost === normalizedTarget;
  } catch (_) { return false; }
}

function handleFeaturedPost(req, res, body) {
  if (!isAuthorized(req) && !localFeatureOrigin(req.headers.origin, req.headers.host)) {
    return sendJson(res, 403, { ok: false, error: 'Origen no autorizado para destacar comentarios.' });
  }
  const message = normalizeEvent(body.message || body);
  if (!message.chatname || !message.chatmessage) return sendJson(res, 400, { ok: false, error: 'Falta el nombre o el comentario.' });
  featuredMessage = message;
  publish('featured_message', message);
  return sendJson(res, 200, { ok: true, message });
}

function publicStatus(includeCaptureDetails = true) {
  const captures = publicCaptures();
  return {
    ok: true,
    enabled: config.enabled === true,
    captureFacebook: config.captureFacebook === true,
    spotifyEnabled: config.spotifyEnabled === true,
    testMode: config.testMode === true,
    spotifyConnected: spotifyBot.isConnected(),
    cortexDashboardConnected: spotifyBot.dashboardAlive === true,
    spotifyClientIdConfigured: !!String(config.spotifyClientId || '').trim(),
    facebookLastSeenAt: health.facebookLastSeenAt || null,
    cortex: health.cortex,
    roulette: 'sincronización desde el historial de Rulo',
    lastEventAt: health.lastEventAt || null,
    uptimeSeconds: Math.floor((Date.now() - health.startedAt) / 1000),
    lastError: health.lastError,
    recentCount: recentMessages.length,
    captureCount: captures.length,
    activeCaptureCount: captures.filter(item => item.connected && item.active).length,
    ...(includeCaptureDetails ? { captures } : {})
  };
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/dashboard.html' : decodeURIComponent(pathname);
  const file = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': mimeType(file), 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function requireToken(req, res) {
  if (isAuthorized(req)) return true;
  sendJson(res, 401, { ok: false, error: 'Token del módulo inválido o ausente.' });
  return false;
}

async function handleRequest(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const extensionOrigin = /^chrome-extension:\/\//i.test(String(req.headers.origin || ''));
  if (extensionOrigin && pathname === '/api/setup') return sendJson(res, 403, { ok: false, error: 'Abre el dashboard del módulo desde una página local para consultar la configuración.' });
  const extensionPublicRoutes = ['/api/status', '/api/spotify/status'];
  if (extensionOrigin && pathname.startsWith('/api/') && !extensionPublicRoutes.includes(pathname) && !isAuthorized(req)) {
    return sendJson(res, 401, { ok: false, error: 'La extensión necesita el token del módulo para esta ruta.' });
  }

  if (req.method === 'GET' && pathname === '/api/status') return sendJson(res, 200, publicStatus(!extensionOrigin));
  if (pathname === '/api/facebook-insights') {
    if (!requireToken(req, res)) return;
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, streams: facebookStats.snapshot() });
    if (req.method === 'POST') {
      if (!config.enabled || !config.captureFacebook) return sendJson(res, 409, { ok: false, error: 'La captura está apagada.' });
      const body = await readJson(req);
      try { facebookStats.update(String(body.streamId || ''), 'insights', body.metrics, body.accountLabel); }
      catch (error) { return sendJson(res, 400, { ok: false, error: error.message }); }
      publish('facebook_insights', facebookStats.snapshot());
      try { await forwardFacebookTotals(); }
      catch (error) {
        health.lastError = 'Estadísticas / Cortex: ' + error.message;
        return sendJson(res, 502, { ok: false, error: health.lastError });
      }
      return sendJson(res, 200, { ok: true });
    }
  }
  if (req.method === 'GET' && pathname === '/api/test-mode-capability') {
    if (!requireToken(req, res)) return;
    return sendJson(res, 200, { ok: true, isolatedTestMode: true, eventContractVersion: 2, testMode: config.testMode === true });
  }
  if (req.method === 'GET' && pathname === '/api/setup') {
    if (!isThisComputer(req)) return sendJson(res, 403, { ok: false, error: 'Abre el dashboard desde la PC que ejecuta este módulo para cargar sus ajustes locales.' });
    return sendJson(res, 200, { ok: true, token: config.apiToken, config: publicConfig() });
  }
  if (req.method === 'GET' && pathname === '/api/config') {
    if (!requireToken(req, res)) return;
    return sendJson(res, 200, { ok: true, config: publicConfig() });
  }
  if (req.method === 'POST' && pathname === '/api/capture-status') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req);
    const incoming = normalizeCaptureStatus(body.capture || body);
    if (!incoming) return sendJson(res, 400, { ok: false, error: 'Falta la identidad de esta pestaña de captura.' });
    const previous = captureStatuses.get(incoming.captureId);
    const status = {
      ...previous,
      ...incoming,
      lastCortexState: previous?.lastCortexState || 'unknown',
      lastRouletteState: previous?.lastRouletteState || 'unknown',
      lastCortexAt: previous?.lastCortexAt || null,
      lastRouletteAt: previous?.lastRouletteAt || null,
      lastError: incoming.lastError || previous?.lastError || ''
    };
    captureStatuses.set(status.captureId, status);
    while (captureStatuses.size > 32) {
      const oldest = [...captureStatuses.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
      if (!oldest) break;
      captureStatuses.delete(oldest.captureId);
    }
    publish('capture_status', publicCaptures());
    publish('module_status', publicStatus());
    return sendJson(res, 200, { ok: true, captureId: status.captureId, connected: true });
  }
  if (req.method === 'POST' && pathname === '/api/config') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req);
    const next = { ...config };
    ['enabled', 'captureFacebook', 'spotifyEnabled', 'testMode', 'forwardToCortex'].forEach(key => {
      if (typeof body[key] === 'boolean') next[key] = body[key];
    });
    if (typeof body.cortexBaseUrl === 'string') next.cortexBaseUrl = cleanBaseUrl(body.cortexBaseUrl, config.cortexBaseUrl);
    if (typeof body.spotifyClientId === 'string') next.spotifyClientId = body.spotifyClientId.trim().slice(0, 100);
    if (typeof body.spotifyRedirectUri === 'string') next.spotifyRedirectUri = body.spotifyRedirectUri.trim().slice(0, 240);
    let warning = '';
    if (typeof body.testMode === 'boolean' && body.testMode !== config.testMode && body.syncGlobalTestMode !== false) {
      const cortexBase = cleanBaseUrl(next.cortexBaseUrl, 'http://127.0.0.1:4000');
      let response;
      let result = {};
      try {
        response = await fetch(`${cortexBase}/api/test-mode`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: body.testMode }),
          signal: AbortSignal.timeout(5000)
        });
        result = await response.json().catch(() => ({}));
      } catch (error) {
        warning = `Se guardaron los demás ajustes, pero no se pudo sincronizar el modo de pruebas. Lo mantuve activo aquí por seguridad: ${error.message}`;
      }
      if (response && !response.ok) warning = `Se guardaron los demás ajustes, pero no se pudo sincronizar el modo de pruebas. Lo mantuve activo aquí por seguridad: ${result.error || 'inicia o actualiza los receptores y vuelve a guardar.'}`;
      if (warning) next.testMode = true;
    }
    config = next;
saveConfig();
    publish('module_status', publicStatus());
    return sendJson(res, 200, { ok: true, partialSaved: !!warning, warning, config: publicConfig(), status: publicStatus() });
  }
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: module_status\ndata: ${JSON.stringify(publicStatus())}\n\n`);
    if (featuredMessage) res.write(`event: featured_message\ndata: ${JSON.stringify(featuredMessage)}\n\n`);
    recentMessages.forEach(message => res.write(`event: chat_message\ndata: ${JSON.stringify(message)}\n\n`));
    clients.add(res);
    const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch (_) {} }, 20000);
    req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/chat-event') {
    if (!requireToken(req, res)) return;
    if (!config.enabled || !config.captureFacebook) return sendJson(res, 409, { ok: false, error: 'La captura de Facebook está apagada.' });
    const body = await readJson(req);
    const message = normalizeEvent(body.message || body);
    message.testMode = config.testMode === true;
    if (message.type !== 'facebook') return sendJson(res, 400, { ok: false, error: 'Este capturador acepta mensajes Facebook.' });
    if (message.event !== 'viewer_update' && message.event !== 'facebook_comment_count_update' && (!message.chatname || !message.chatmessage)) {
      return sendJson(res, 400, { ok: false, error: 'El evento no contiene un comentario válido.' });
    }
    if (message.avatarUpdateOnly) {
      const existing = recentMessages.find(item => item.id === message.id);
      if (existing && message.chatimg && message.chatimg !== existing.chatimg) existing.chatimg = message.chatimg;
      else if (existing && !message.chatimg && /static\.xx\.fbcdn\.net.*(?:rsrc\.php|emoji\.php)|(?:images\/emoji\.php|\/emg1\/)/i.test(existing.chatimg || '')) existing.chatimg = '';
      if (existing) publish('chat_message', existing);
      void forwardToCortex(message);
      return sendJson(res, 200, { ok: true, avatarUpdateOnly: true, id: message.id });
    }
    if (seenIds.has(message.id)) {
      const existing = recentMessages.find(item => item.id === message.id);
      const shouldUpgradeAvatar = existing && message.chatimg && message.chatimg !== existing.chatimg
        && (!existing.chatimg || message.chatimg.startsWith('data:image/webp;base64,') || /static\.xx\.fbcdn\.net.*(?:rsrc\.php|emoji\.php)/i.test(existing.chatimg));
      if (shouldUpgradeAvatar) {
        existing.chatimg = message.chatimg;
        publish('chat_message', existing);
        void forwardToCortex({ ...existing, avatarUpdateOnly: true });
        return sendJson(res, 200, { ok: true, updatedAvatar: true, id: message.id });
      }
      return sendJson(res, 200, { ok: true, duplicate: true });
    }
    if (message.avatarUpdateOnly) {
      void forwardToCortex(message);
      return sendJson(res, 202, { ok: true, avatarUpdateOnly: true, id: message.id });
    }
    seenIds.add(message.id);
    if (seenIds.size > 3000) seenIds.delete(seenIds.values().next().value);
    if (message.event === 'viewer_update' || message.event === 'facebook_comment_count_update') {
      void forwardToCortex(message);
      publish('facebook_status', message);
      return sendJson(res, 202, { ok: true, id: message.id, event: message.event });
    }
    health.facebookLastSeenAt = Date.now();
    recentMessages.push(message);
    while (recentMessages.length > MAX_RECENT) recentMessages.shift();
    publish('chat_message', message);
    void forwardToCortex(message);
    void forwardToRoulette(message);
    if (config.spotifyEnabled && !config.testMode && !message.event && message.chatmessage) {
      void spotifyBot.handleMessage(message).then(result => {
        const traceResult = result?.ok === true ? 'played'
          : result?.ignored ? 'not_request'
            : result?.cooldown ? 'cooldown'
              : result?.noDevice ? 'no_device'
                : result?.notFound ? 'not_found' : result?.error ? 'error' : 'not_understood';
        reportTrace(message, 'spotify.processing', result?.ok === true ? 'ok' : result?.ignored ? 'skipped' : 'failed', { source: 'facebook', result: traceResult });
        const detail = result?.error || (result?.noDevice ? 'No hay un dispositivo Spotify disponible.' : '');
        if (detail) {
          health.lastError = `Spotify: ${detail}`;
          publish('module_status', publicStatus());
        } else if (result?.ok === true && health.lastError.startsWith('Spotify:')) {
          health.lastError = '';
          publish('module_status', publicStatus());
        }
      }).catch(error => {
        reportTrace(message, 'spotify.processing', 'failed', { source: 'facebook', result: 'error' });
        health.lastError = `Spotify: ${error.message}`;
        publish('module_status', publicStatus());
      });
    } else if (!config.testMode && !message.event && message.chatmessage) {
      reportTrace(message, 'spotify.processing', 'skipped', { source: 'facebook', result: 'disabled' });
    }
    return sendJson(res, 202, { ok: true, id: message.id });
  }
  if (req.method === 'POST' && pathname === '/api/featured') {
    const body = await readJson(req);
    return handleFeaturedPost(req, res, body);
  }
  if (req.method === 'POST' && pathname === '/api/featured/clear') {
    if (!isAuthorized(req) && !localFeatureOrigin(req.headers.origin, req.headers.host)) return sendJson(res, 403, { ok: false, error: 'Origen no autorizado.' });
    featuredMessage = null;
    publish('featured_clear', { cleared: true });
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'GET' && pathname === '/api/featured') return sendJson(res, 200, { ok: true, message: featuredMessage });
  if (req.method === 'GET' && pathname === '/api/spotify/status') {
    return sendJson(res, 200, { ok: true, connected: spotifyBot.isConnected(), cortexDashboardConnected: spotifyBot.dashboardAlive === true, clientIdConfigured: !!String(config.spotifyClientId || '').trim(), moduleEnabled: config.enabled === true, captureFacebook: config.captureFacebook === true, enabled: config.spotifyEnabled === true, testMode: config.testMode === true, redirectUri: config.spotifyRedirectUri });
  }
  if (req.method === 'GET' && pathname === '/api/spotify/login') {
    if (!String(config.spotifyClientId || '').trim()) return sendJson(res, 409, { ok: false, error: 'Configura el Client ID de Spotify en el dashboard.' });
    const authUrl = spotifyBot.createAuthorizationUrl(config.spotifyClientId, config.spotifyRedirectUri);
    res.writeHead(302, { Location: authUrl });
    return res.end();
  }
  if (req.method === 'GET' && pathname === '/spotify/callback') {
    const error = url.searchParams.get('error');
    if (error) {
      spotifyBot.clearOAuthSession();
      return serveStatic(req, res, '/spotify-callback.html');
    }
    try {
      await spotifyBot.completeAuthorization({
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        clientId: config.spotifyClientId,
        redirectUri: config.spotifyRedirectUri
      });
      publish('module_status', publicStatus());
      return serveStatic(req, res, '/spotify-connected.html');
    } catch (error) {
      health.lastError = `OAuth Spotify: ${error.message}`;
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }
  if (req.method === 'POST' && pathname === '/api/spotify/logout') {
    if (!requireToken(req, res)) return;
    spotifyBot.logout();
    publish('module_status', publicStatus());
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/api/spotify/transport') {
    if (!requireToken(req, res)) return;
    if (!spotifyBot.isConnected()) return sendJson(res, 409, { ok: false, error: 'Conecta Spotify primero.' });
    const body = await readJson(req);
    const action = String(body.action || '').trim().toLowerCase();
    const commands = { next: '!skip', previous: '!previous', pause: '!pause', resume: '!resume' };
    if (!commands[action]) return sendJson(res, 400, { ok: false, error: 'Acción de Spotify inválida.' });
    // Son controles manuales explícitos: funcionan en modo aislado y no generan
    // comentarios ni registros persistentes.
    const result = await spotifyBot.handleMessage({
      type: 'dashboard',
      platform: 'dashboard',
      chatname: 'Control Cortex',
      chatmessage: commands[action],
      userid: 'rulo-chat-historial',
      textonly: true
    }, { skipCooldown: true, silent: true, manualTransport: true });
    if (result?.ok) return sendJson(res, 200, { ok: true, action, response: result.response || '' });
    return sendJson(res, result?.error ? 502 : 409, {
      ok: false,
      action,
      error: result?.error || result?.reason || result?.response || 'Spotify no pudo ejecutar el comando.'
    });
  }
  if (req.method === 'POST' && pathname === '/api/spotify/test') {
    if (!requireToken(req, res)) return;
    if (!spotifyBot.isConnected()) return sendJson(res, 409, { ok: false, error: 'Conecta Spotify primero.' });
    const body = await readJson(req);
    const query = String(body.query || '').trim().slice(0, 180);
    if (!query) return sendJson(res, 400, { ok: false, error: 'Escribe un artista o tema para probar la búsqueda.' });
    // This is a direct dashboard search, not a raw chat message. Add a command
    // marker so handleMessage's chat-intent guard accepts it, and force the
    // exact query so users do not need to phrase it like a Facebook request.
    const message = { type: 'facebook', chatname: 'Prueba', chatmessage: `!tema ${query}`, userid: 'dashboard-test', textonly: true };
    const result = await spotifyBot.handleMessage(message, { analysis: true, forceQuery: query, suppressLog: true, silent: true });
    if (result?.ok) return sendJson(res, 200, result);
    const error = result?.error || result?.response || (result?.ignored
      ? 'No se pudo interpretar la búsqueda. Escribe el nombre de una canción o artista.'
      : `Spotify no encontró resultados para "${query}".`);
    return sendJson(res, result?.notFound ? 404 : result?.error ? 502 : 422, { ok: false, ...result, error });
  }
  if (req.method === 'POST' && pathname === '/api/spotify/test-playback') {
    if (!requireToken(req, res)) return;
    if (config.testMode !== true) return sendJson(res, 409, { ok: false, isolated: false, error: 'Activa Modo de pruebas aislado para reproducir sin procesar ni archivar comentarios.' });
    if (!spotifyBot.isConnected()) return sendJson(res, 409, { ok: false, isolated: true, error: 'Conecta Spotify primero.' });
    const body = await readJson(req);
    const query = String(body.query || '').trim().slice(0, 180);
    if (!query) return sendJson(res, 400, { ok: false, isolated: true, error: 'Escribe el tema que quieres probar.' });
    const message = {
      type: 'spotify-isolated-test',
      platform: 'dashboard',
      chatname: 'Prueba aislada',
      chatmessage: `!tema ${query}`,
      userid: 'dashboard-isolated-playback-test',
      textonly: true
    };
    const result = await spotifyBot.handleMessage(message, {
      forceQuery: query,
      skipCooldown: true,
      explicitTestPlayback: true,
      suppressLog: true,
      silent: true
    });
    if (!result?.ok) {
      return sendJson(res, 422, {
        ok: false,
        isolated: true,
        error: result?.error || result?.response || result?.reason || 'No se pudo reproducir el tema.',
        response: result?.response || '',
        noDevice: result?.noDevice === true
      });
    }
    return sendJson(res, 200, {
      ok: true,
      isolated: true,
      response: result.response,
      track: result.track ? { name: result.track.name, artists: (result.track.artists || []).map(artist => artist.name), uri: result.track.uri } : null,
      device: result.device || ''
    });
  }

  if (req.method === 'GET' && pathname === '/api/spotify/devices') {
    if (!requireToken(req, res)) return;
    if (!spotifyBot.isConnected()) return sendJson(res, 409, { ok: false, error: 'Conecta Spotify primero.' });
    try {
      const devices = await spotifyBot.devices();
      const active = devices.find(device => device.is_active);
      return sendJson(res, 200, {
        ok: true,
        activeName: active?.name || '',
        devices: devices.slice(0, 25).map(device => ({
          id: device.id || '', name: device.name || 'Sin nombre', type: device.type || '',
          isActive: device.is_active === true, isRestricted: device.is_restricted === true,
          volumePercent: Number.isFinite(Number(device.volume_percent)) ? Number(device.volume_percent) : null
        }))
      });
    } catch (error) {
      return sendJson(res, error.status === 401 ? 401 : 502, { ok: false, error: error.message || 'No se pudieron consultar los dispositivos Spotify.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/spotify/test-comment') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req);
    const comment = String(body.comment || '').trim().slice(0, 500);
    const requester = String(body.requester || 'Prueba').trim().slice(0, 80) || 'Prueba';
    const requesterId = String(body.requesterId || '').trim().slice(0, 160);
    const liveSimulation = body.liveSimulation === true;
    const simulationKey = String(body.simulationKey || '').trim().slice(0, 30);
    const simulationCommentId = liveSimulation ? String(body.simulationCommentId || '').trim().slice(0, 120) : '';
    const parseOnly = body.parseOnly === true;
    const spotifyDisabled = body.spotifyDisabled === true;
    const timeScale = Number(body.timeScale) === 10 ? 10 : 1;
    if (comment.length < 2) return sendJson(res, 400, { ok: false, error: 'Escribe un comentario para analizar o probar.' });
    if (liveSimulation && !/^\d{1,30}$/.test(simulationKey)) return sendJson(res, 400, { ok: false, error: 'El programa de la simulación no es válido.' });
    let isMusicIntent = false;
    try { isMusicIntent = await spotifyBot.isMusicIntentCandidate(comment); }
    catch (error) { return sendJson(res, 503, { ok: false, error: error.message || 'No se pudo cargar el detector de pedidos de música.' }); }
    if (!isMusicIntent) return sendJson(res, 422, { ok: false, ignored: true, action: 'not-music', error: 'No detecté un pedido de música en ese comentario.' });
    if (liveSimulation && spotifyDisabled) {
      return sendJson(res, 200, { ok: true, isolated: true, handled: true, action: 'disabled', response: 'En esta simulación Spotify está marcado como apagado, así que no puedo cambiar la música.' });
    }
    if (liveSimulation && (!config.enabled || !config.captureFacebook)) {
      return sendJson(res, 409, { ok: false, isolated: true, error: 'En un vivo real no se recibirían comentarios: el módulo de Chat Bot Spotify o la captura de Facebook están apagados.' });
    }
    if (liveSimulation && !config.spotifyEnabled) {
      return sendJson(res, 409, { ok: false, isolated: true, error: 'Los pedidos de música por chat están apagados, así que en un vivo real Rulo no cambiaría el tema.' });
    }
    const ruloEnabled = (liveSimulation || !parseOnly) ? await spotifyBot.getRuloEnabled() : true;
    if (ruloEnabled !== true) {
      return sendJson(res, 409, { ok: false, isolated: true, error: 'Rulo está apagado; los pedidos de música del chat no se procesan. Enciéndelo para simular este comentario.' });
    }
    if (liveSimulation && (await spotifyBot.getSettings()).enabled === false) {
      return sendJson(res, 409, { ok: false, isolated: true, error: 'Los pedidos de música por chat están apagados en los ajustes de Rulo; en un vivo real este pedido no se procesaría.' });
    }
    if ((!parseOnly || liveSimulation) && config.testMode !== true) {
      return sendJson(res, 409, { ok: false, isolated: false, error: 'Activa Modo de pruebas aislado antes de simular un pedido de Spotify.' });
    }
    if (!spotifyBot.isConnected()) return sendJson(res, 409, { ok: false, error: 'Conecta Spotify primero.' });
    if (liveSimulation && parseOnly && /^!(?:skip|siguiente|pause|pausa|resume|reanudar|next|previous|anterior)\b/i.test(comment)) {
      return sendJson(res, 200, { ok: true, isolated: true, parseOnly: true, handled: true, action: 'preview', response: 'La vista previa no ejecuta comandos de transporte ni cambia la reproducción de Spotify.' });
    }
    const message = {
      type: liveSimulation ? 'facebook' : 'spotify-isolated-test', platform: liveSimulation ? 'facebook' : 'dashboard', chatname: requester,
      chatmessage: comment, userid: requesterId || `dashboard-comment-test-${Date.now()}`, textonly: true
    };
    const result = await spotifyBot.handleMessage(message, {
      analysis: parseOnly,
      skipCooldown: !liveSimulation,
      explicitTestPlayback: !parseOnly && !liveSimulation,
      isolatedLiveSimulation: !parseOnly && liveSimulation,
      simulationCommentId,
      simulationKey,
      timeScale,
      allowAliasLearning: !(liveSimulation && parseOnly),
      updateSelectionState: !(liveSimulation && parseOnly),
      suppressReplyHistory: liveSimulation && parseOnly,
      suppressLog: true,
      silent: true
    });
    const interpretationDetails = {
      interpretationSource: ['ai', 'rules', 'rules-fallback', 'manual', 'none'].includes(result?.interpretationSource) ? result.interpretationSource : 'none',
      aiInterpreted: result?.aiInterpreted === true,
      aiAttempted: result?.aiAttempted === true,
      aiModel: String(result?.aiModel || '').slice(0, 120),
      aiFallbackReason: String(result?.aiFallbackReason || '').slice(0, 180)
    };
    if (!result?.ok) {
      const error = result?.error || result?.response || result?.reason || (result?.ignored
        ? 'No detecté un pedido de música en ese comentario.'
        : 'No se pudo procesar el comentario de prueba.');
      const expectedLimitAction = result?.cooldown ? (result.userCooldown ? 'user-cooldown' : 'cooldown')
        : result?.queued === false ? 'queue-full'
          : result?.busy ? 'busy' : '';
      if (liveSimulation && expectedLimitAction) {
        return sendJson(res, 200, {
          ok: true, isolated: true, handled: true, action: expectedLimitAction,
          response: result.response || error, ruloNotified: result.ruloNotified === true, ...interpretationDetails
        });
      }
      return sendJson(res, result?.busy ? 409 : result?.error ? 502 : 422, {
        ok: false, isolated: !parseOnly, parseOnly, error, response: result?.response || '', noDevice: result?.noDevice === true,
        cooldown: result?.cooldown === true, userCooldown: result?.userCooldown === true, queueFull: result?.queued === false,
        ruloNotified: result?.ruloNotified === true,
        ...interpretationDetails
      });
    }
    if (parseOnly) {
      return sendJson(res, 200, {
        ok: true, isolated: liveSimulation, parseOnly: true, action: 'preview', response: result.response || '',
        track: result.track ? { name: result.track.name, artists: (result.track.artists || []).map(artist => artist.name), uri: result.track.uri } : null,
        ...interpretationDetails
      });
    }
    return sendJson(res, 200, {
      ok: true, isolated: !parseOnly, parseOnly, response: result.response || '',
      ...interpretationDetails,
      ruloNotified: !parseOnly && result.ruloNotified === true,
      track: result.track ? {
        name: result.track.name,
        artists: (result.track.artists || []).map(artist => artist.name),
        uri: result.track.uri
      } : null,
      device: result.device || ''
    });
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);
  return sendJson(res, 404, { ok: false, error: 'Ruta no encontrada.' });
}

const server = http.createServer((req, res) => {
  Promise.resolve(handleRequest(req, res)).catch(error => {
    if (res.headersSent) return res.destroy(error);
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || 'Error interno.' });
  });
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[Chat Bot Spotify] El puerto ${PORT} ya está ocupado. Revisa si Cortex ya administra el servicio o usa iniciar-Chat-Bot-Spotify.bat para reiniciar la instancia propia.`);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 50);
    return;
  }
  console.error('[Chat Bot Spotify] Error del servidor:', error.message || error);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50);
});

server.listen(PORT, HOST, () => {
  console.log(`[Chat Bot Spotify] escuchando en http://127.0.0.1:${PORT}`);
  console.log(`[Chat Bot Spotify] captura ${config.enabled && config.captureFacebook ? 'encendida' : 'apagada'}; Spotify ${config.spotifyEnabled ? 'encendido' : 'apagado'}`);
});

setInterval(() => publish('module_status', publicStatus()), 15000).unref();

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
