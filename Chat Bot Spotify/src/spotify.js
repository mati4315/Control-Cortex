'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';
const DEFAULT_SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state'
].join(' ');

function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeMatchText(value) {
  return fold(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function textSimilarity(left, right) {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);
  if (a === b) return 1;
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return Math.max(0, 1 - previous[b.length] / Math.max(a.length, b.length));
}

function hasPossibleMusicIntent(value, vocabulary = {}) {
  const text = normalizeMatchText(value);
  if (!text) return false;
  const terms = [
    ...(vocabulary.musicWords || []),
    ...(vocabulary.requestVerbs || []),
    'algo', 'escuchar', 'escucha', 'oir', 'pon', 'poneme', 'tema', 'cancion', 'musica'
  ].flatMap(term => normalizeMatchText(term).split(' ')).filter(term => term.length >= 4);
  const tokens = text.split(' ');
  if (terms.some(term => tokens.includes(term))) return true;
  return tokens.some(token => token.length >= 4 && terms.some(term =>
    Math.min(token.length, term.length) >= 4 && textSimilarity(token, term) >= 0.78
  ));
}

function requestContentPhrase(value) {
  const stopWords = [
    'quiero', 'quisiera', 'queria', 'poneme', 'pone', 'pongan', 'pasame', 'pasen', 'pasa', 'podes', 'podrias',
    'poner', 'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'algun', 'alguna', 'tema', 'temas',
    'temita', 'temazo', 'cancion', 'canciones', 'musica', 'rola', 'track', 'de', 'del', 'por', 'favor',
    'che', 'algo', 'escuchar', 'escucha', 'oir', 'me'
  ];
  return normalizeMatchText(value).split(' ').filter(token => token && !stopWords.some(word =>
    token === word || (Math.min(token.length, word.length) >= 4 && textSimilarity(token, word) >= 0.78)
  )).join(' ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class SpotifyBot {
  constructor(options) {
    this.options = options;
    this.tokenFile = options.tokenFile;
    this.oauthFile = options.oauthFile || path.join(path.dirname(this.tokenFile), 'spotify-oauth-session.json');
    this.token = this.readToken();
    this.oauth = null;
    this.inFlight = false;
    this.lastIsolatedTestReplySent = false;
    this.spotifyBackoffUntil = 0;
    this.spotifyNoResponseUntil = 0;
    this.localRequestQueue = Promise.resolve();
    this.localRequestQueueSize = 0;
    this.lastGlobalRequestAt = 0;
    this.userRequestAt = new Map();
    this.liveSimulationCooldowns = new Map();
    this.lastTrackUri = '';
    this.lastOverlaySignature = '';
    this.lastPublishAt = 0;
    this.lastSkippedUri = '';
    this.replyHistory = new Map();
    this.artistBags = new Map();
    this.recentTrackUris = [];
    this.vocabularyCache = null;
    this.vocabularyCacheAt = 0;
    this.settingsCache = null;
    this.settingsCacheAt = 0;
    this.ruloEnabledCache = null;
    this.ruloEnabledCheckedAt = 0;
    this.ruloEnabledRequest = null;
    this.aliasesCache = null;
    this.aliasesCacheAt = 0;
    this.cortexCommandQueue = Promise.resolve();
    this.cortexPollTimer = null;
    this.playbackPollTimer = null;
    this.trackEndAt = 0;
    this.dashboardAlive = false;
    this.scheduleCortexPoll(2500);
    this.schedulePlaybackPoll(2500);
  }

  getLiveSimulationCooldownState(key, requestedTimeScale = 1) {
    const now = Date.now();
    const normalizedKey = String(key || '').trim().slice(0, 30) || 'default';
    const timeScale = Number(requestedTimeScale) === 10 ? 10 : 1;
    const maxAgeMs = 6 * 60 * 60 * 1000;
    for (const [existingKey, state] of this.liveSimulationCooldowns) {
      if (now - Number(state.updatedAt || 0) > maxAgeMs) this.liveSimulationCooldowns.delete(existingKey);
    }
    let state = this.liveSimulationCooldowns.get(normalizedKey);
    if (!state) {
      if (this.liveSimulationCooldowns.size >= 128) this.liveSimulationCooldowns.delete(this.liveSimulationCooldowns.keys().next().value);
      state = { lastGlobalRequestAt: 0, userRequestAt: new Map(), updatedAt: now, virtualNow: now, wallNow: now, timeScale };
    } else {
      const elapsedWallMs = Math.max(0, now - Number(state.wallNow || now));
      state.virtualNow = Number(state.virtualNow || now) + elapsedWallMs * (Number(state.timeScale) === 10 ? 10 : 1);
    }
    state.wallNow = now;
    state.timeScale = timeScale;
    state.updatedAt = now;
    this.liveSimulationCooldowns.set(normalizedKey, state);
    return state;
  }

  readToken() {
    try { return JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')); }
    catch (_) { return null; }
  }

  saveToken() {
    const temporaryPath = `${this.tokenFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.token, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.tokenFile);
  }

  saveOAuthSession() {
    fs.mkdirSync(path.dirname(this.oauthFile), { recursive: true });
    const temporaryPath = `${this.oauthFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.oauth, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.oauthFile);
  }

  readOAuthSession() {
    try {
      const session = JSON.parse(fs.readFileSync(this.oauthFile, 'utf8'));
      return session && typeof session.state === 'string' && typeof session.verifier === 'string'
        ? session
        : null;
    } catch (_) { return null; }
  }

  clearOAuthSession() {
    this.oauth = null;
    try { fs.rmSync(this.oauthFile, { force: true }); } catch (_) {}
  }

  isConnected() {
    return !!(this.token && (this.token.refresh_token || (this.token.access_token && this.token.expires_at > Date.now())));
  }

  createAuthorizationUrl(clientId, redirectUri) {
    const state = crypto.randomBytes(24).toString('hex');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    this.oauth = { state, verifier, createdAt: Date.now() };
    this.saveOAuthSession();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
      scope: DEFAULT_SCOPES,
      show_dialog: 'true'
    });
    return `${SPOTIFY_ACCOUNTS}/authorize?${params}`;
  }

  async completeAuthorization({ code, state, clientId, redirectUri }) {
    const oauth = this.oauth || this.readOAuthSession();
    if (!oauth || !state || state !== oauth.state || Date.now() - oauth.createdAt > 10 * 60 * 1000) {
      this.clearOAuthSession();
      throw new Error('La sesión de autorización venció. Vuelve a conectar Spotify.');
    }
    const verifier = oauth.verifier;
    this.clearOAuthSession();
    const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: String(code || ''),
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new Error(body.error_description || body.error || `Spotify respondió HTTP ${response.status}.`);
    this.token = {
      access_token: body.access_token,
      refresh_token: body.refresh_token || '',
      token_type: body.token_type || 'Bearer',
      scope: body.scope || DEFAULT_SCOPES,
      expires_at: Date.now() + (Number(body.expires_in) || 3600) * 1000
    };
    this.saveToken();
    return true;
  }

  logout() {
    this.token = null;
    this.clearOAuthSession();
    try { fs.rmSync(this.tokenFile, { force: true }); } catch (_) {}
  }

  async accessToken() {
    if (!this.token) throw new Error('Spotify no está conectado.');
    if (this.token.access_token && this.token.expires_at > Date.now() + 60000) return this.token.access_token;
    if (!this.token.refresh_token) throw new Error('La autorización venció. Conecta Spotify otra vez.');
    const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.getConfig().spotifyClientId,
        grant_type: 'refresh_token',
        refresh_token: this.token.refresh_token
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      if (response.status === 400 || response.status === 401) this.logout();
      throw new Error(body.error_description || body.error || `No se pudo renovar Spotify (HTTP ${response.status}).`);
    }
    this.token = {
      ...this.token,
      access_token: body.access_token,
      refresh_token: body.refresh_token || this.token.refresh_token,
      scope: body.scope || this.token.scope,
      expires_at: Date.now() + (Number(body.expires_in) || 3600) * 1000
    };
    this.saveToken();
    return this.token.access_token;
  }

  async api(path, options = {}) {
    const now = Date.now();
    if (this.spotifyBackoffUntil > now) {
      const retryAfter = Math.ceil((this.spotifyBackoffUntil - now) / 1000);
      throw Object.assign(new Error(`Spotify pidió esperar ${retryAfter}s antes de volver a consultar.`), { status: 429, retryAfter });
    }
    if (this.spotifyNoResponseUntil > now) {
      const retryAfter = Math.ceil((this.spotifyNoResponseUntil - now) / 1000);
      throw Object.assign(new Error(`Spotify no respondió; reintentaré en ${retryAfter}s.`), { status: 0, retryAfter });
    }
    const accessToken = await this.accessToken();
    const controller = new AbortController();
    const timeoutMs = 12000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${SPOTIFY_API}${path}`, {
        ...options,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
      });
      if (response.status === 204) {
        this.spotifyNoResponseUntil = 0;
        return { response, body: null };
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = Math.max(5, Math.min(120, Number(response.headers.get('retry-after')) || 15));
          this.spotifyBackoffUntil = Date.now() + retryAfter * 1000;
          throw Object.assign(new Error(`Spotify limitó las solicitudes; espera ${retryAfter}s.`), { status: 429, retryAfter });
        }
        throw Object.assign(new Error(body.error?.message || body.error_description || `Spotify respondió HTTP ${response.status}.`), { status: response.status });
      }
      this.spotifyNoResponseUntil = 0;
      return { response, body };
    } catch (error) {
      if (controller.signal.aborted || error.name === 'AbortError') {
        this.spotifyNoResponseUntil = Date.now() + 8000;
        throw Object.assign(new Error(`Spotify no respondió en ${Math.round(timeoutMs / 1000)}s; el pedido se liberó para que los siguientes no queden bloqueados.`), { status: 0, retryAfter: 8 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async cortexJson(path, timeoutMs = 3500) {
    const base = this.options.getCortexBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) { return null; }
    finally { clearTimeout(timer); }
  }

  async getSettings() {
    if (this.settingsCache && Date.now() - this.settingsCacheAt < 10000) return this.settingsCache;
    const data = await this.cortexJson('/api/spotify-settings');
    const settings = data?.settings || {};
    const target = await this.cortexJson('/api/spotify-device-target');
    const offset = await this.cortexJson('/api/spotify-playback-offset');
    this.settingsCache = {
      cooldownSeconds: 40,
      userCooldownSeconds: 120,
      minTextLength: 8,
      requireCommand: false,
      testMode: false,
      personalize: true,
      announce: true,
      autoContinue: settings.autoContinue === true,
      ...settings,
      skipEnabled: offset && typeof offset.enabled === 'boolean' ? offset.enabled : settings.skipEnabled === true,
      skipSeconds: Number(offset?.seconds || settings.skipSeconds) || 10,
      deviceTargetName: String(target?.deviceName || settings.deviceTargetName || '').trim()
    };
    this.settingsCacheAt = Date.now();
    return this.settingsCache;
  }

  async getRuloEnabled() {
    if (Date.now() - this.ruloEnabledCheckedAt < 1200) return this.ruloEnabledCache;
    if (this.ruloEnabledRequest) return this.ruloEnabledRequest;
    this.ruloEnabledRequest = this.cortexJson('/api/rulo-mascota-state', 1200).then(data => {
      this.ruloEnabledCheckedAt = Date.now();
      this.ruloEnabledCache = typeof data?.enabled === 'boolean' ? data.enabled : null;
      return this.ruloEnabledCache;
    }).finally(() => { this.ruloEnabledRequest = null; });
    return this.ruloEnabledRequest;
  }

  async getVocabulary() {
    if (this.vocabularyCache && Date.now() - this.vocabularyCacheAt < 30000) return this.vocabularyCache;
    const data = await this.cortexJson('/api/spotify-vocabulary');
    this.vocabularyCache = data?.vocabulary || data || {};
    this.vocabularyCacheAt = Date.now();
    return this.vocabularyCache;
  }

  async isMusicIntentCandidate(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    if (/^!/.test(fold(text))) return true;
    return hasPossibleMusicIntent(text, await this.getVocabulary());
  }

  async getAliases() {
    if (this.aliasesCache && Date.now() - this.aliasesCacheAt < 30000) return this.aliasesCache;
    const data = await this.cortexJson('/api/spotify-aliases');
    this.aliasesCache = data?.aliases || {};
    this.aliasesCacheAt = Date.now();
    return this.aliasesCache;
  }

  scheduleCortexPoll(delayMs) {
    clearTimeout(this.cortexPollTimer);
    this.cortexPollTimer = setTimeout(() => this.pollCortex().catch(() => {}), delayMs);
    this.cortexPollTimer.unref?.();
  }

  async pollCortex() {
    const config = this.options.getConfig();
    if (!config.forwardToCortex || config.testMode) {
      this.dashboardAlive = false;
      this.scheduleCortexPoll(10000);
      return;
    }
    const data = await this.cortexJson(`/api/spotify-client-state?alive=1&version=55&token=${this.isConnected() ? 1 : 0}`);
    if (data?.ok) {
      this.dashboardAlive = true;
      if (data.settings && typeof data.settings === 'object') {
        this.settingsCache = { ...(this.settingsCache || {}), ...data.settings };
        this.settingsCacheAt = Date.now();
      }
      if (data.vocabulary && typeof data.vocabulary === 'object') {
        this.vocabularyCache = data.vocabulary;
        this.vocabularyCacheAt = Date.now();
      }
      if (data.aliases && typeof data.aliases === 'object') {
        this.aliasesCache = data.aliases;
        this.aliasesCacheAt = Date.now();
      }
      // Control Cortex's Spotify integration is the sole command-queue consumer.
      // Claiming here would race it and could bypass its playback queue/recovery.
    } else {
      this.dashboardAlive = false;
    }
    const pollSeconds = Math.max(2, Math.min(60, Number(this.settingsCache?.pollSeconds) || 7));
    this.scheduleCortexPoll(pollSeconds * 1000);
  }

  schedulePlaybackPoll(delayMs) {
    clearTimeout(this.playbackPollTimer);
    this.playbackPollTimer = setTimeout(() => this.pollPlaybackState().catch(() => {}), delayMs);
    this.playbackPollTimer.unref?.();
  }

  async pollPlaybackState() {
    const config = this.options.getConfig();
    if (!config.forwardToCortex || !this.isConnected()) {
      this.schedulePlaybackPoll(10000);
      return;
    }

    let pollSeconds = 7;
    try {
      const settings = await this.getSettings();
      pollSeconds = Math.max(2, Math.min(15, Number(settings.pollSeconds) || pollSeconds));
    } catch (_) {}

    // Keep the overlay in sync when playback changes outside this module,
    // including Spotify Connect devices controlled from another computer.
    await this.publishPlaybackState();
    this.schedulePlaybackPoll(pollSeconds * 1000);
  }

  async claimAndRunCommand(command) {
    if (!command || !command.id) return;
    const base = this.options.getCortexBaseUrl();
    const response = await fetch(`${base}/api/spotify-command-claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: command.id })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.claimed !== true) return;
    return this.handleDashboardCommand(command);
  }

  async handleDashboardCommand(command) {
    const config = this.options.getConfig();
    if (!config.spotifyEnabled || config.testMode) return { ok: false, disabled: true };
    const type = String(command.type || '');
    const requester = String(command.requester || 'Dashboard');
    const query = String(command.query || command.uri || '').trim();
    const automatic = command.auto === true;
    const message = (chatmessage, userid = 'cortex-dashboard') => ({
      type: automatic ? 'auto' : 'dashboard',
      platform: automatic ? 'spotify-auto' : 'dashboard',
      chatname: requester,
      userid,
      chatmessage
    });
    if (type === 'play') {
      return this.handleMessage(message(`!tema ${query}`), {
        force: true,
        skipCooldown: true,
        silent: automatic,
        startAt: command.startAt,
        endAt: command.endAt,
        trackUri: command.uri || ''
      });
    }
    if (type === 'simulate') {
      if (command.parseOnly === true) {
        const settings = await this.getSettings();
        const vocabulary = await this.getVocabulary();
        const parsed = this.parseRequest(command.comment, vocabulary, settings);
        const understood = parsed ? (parsed.artist ? `artista ${parsed.artist}` : parsed.query) : 'No lo leí como pedido de música.';
        const response = await this.reply('parseDebug', { entendido: understood }, `Entendí: ${understood}`, requester);
        await this.options.logRequest({ source: 'dashboard', requester, query: command.comment, ok: !!parsed, message: response, comment: command.comment, parsed, timestamp: Date.now() });
        return { ok: !!parsed, response, parsed };
      }
      return this.handleMessage(message(String(command.comment || '')), { force: true });
    }
    if (type === 'search') {
      try {
        const settings = await this.getSettings();
        const parsed = { query, kind: 'track' };
        const tracks = await this.searchWithVariants(parsed, await this.getAliases(), await this.getVocabulary(), settings);
        const track = this.chooseTrack(tracks, parsed, settings);
        const artists = track?.artists?.map(item => item.name).join(', ') || '';
        const response = track
          ? await this.reply('analysis', { tema: track.name, artista: artists, busqueda: query }, `Encontré: ${track.name} - ${artists} (no reproduje)`, requester)
          : await this.reply('analysisFail', { busqueda: query }, `No encontré nada para "${query}".`, requester, 'warning');
        await this.options.logRequest({ source: 'dashboard', requester, query, ok: !!track, message: response, track: track ? { name: track.name, artist: artists, uri: track.uri } : null, timestamp: Date.now() });
        return { ok: !!track, response, track };
      } catch (error) { this.options.onError?.(`Búsqueda del dashboard: ${error.message}`); return { ok: false, error: error.message }; }
    }
    if (type === 'devices') {
      try {
        const devices = await this.devices();
        const list = devices.map(device => `${device.name}${device.is_active ? ' (activo)' : ''}`).join(' | ') || 'no hay dispositivos';
        const response = await this.reply(devices.length ? 'devices' : 'noDevice', { dispositivos: list }, `Dispositivos Spotify: ${list}`, requester);
        await this.options.logRequest({ source: 'dashboard', requester, query: '!spotifydevices', ok: devices.length > 0, message: response, timestamp: Date.now() });
        return { ok: devices.length > 0, response, devices };
      } catch (error) { return { ok: false, error: error.message }; }
    }
    const transport = { pause: ['PUT', '/me/player/pause'], resume: ['PUT', '/me/player/play'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] }[type];
    if (transport) {
      try {
        await this.api(transport[1], { method: transport[0] });
        const response = await this.reply('transportOk', { accion: type }, `Comando "${type}" enviado a Spotify.`, requester);
        await this.publishPlaybackState(true);
        return { ok: true, response };
      } catch (error) {
        const response = await this.reply('transportFail', { accion: type }, `No se pudo ejecutar "${type}".`, requester, 'error');
        return { ok: false, error: error.message, response };
      }
    }
    return null;
  }

  cleanQuery(value) {
    return String(value || '').replace(/https?:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]+)/ig, '$1').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  async trackByUri(value) {
    const text = String(value || '').trim();
    const id = text.match(/(?:spotify:track:|open\.spotify\.com\/track\/)([A-Za-z0-9]{22})/i)?.[1] || (/^[A-Za-z0-9]{22}$/.test(text) ? text : '');
    if (!id) return null;
    try { return (await this.api(`/tracks/${encodeURIComponent(id)}`)).body; }
    catch (_) { return null; }
  }

  parseRequest(raw, vocabulary, settings) {
    let original = String(raw || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
    if (original.length < Number(settings.minTextLength || 1)) return null;
    const commands = (vocabulary.commands || ['!playnow', '!tema', '!musica']).map(fold);
    const commandMatch = original.match(/^\s*(![a-z0-9_]+)\s*/i);
    const command = commandMatch && commands.includes(fold(commandMatch[1])) ? commandMatch[1] : '';
    if (command) original = original.slice(commandMatch[0].length).trim();
    else if (settings.requireCommand) return null;
    let text = fold(original).replace(/[–—−]/g, '-').replace(/[^\w\s"'!.-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!command && text.length < Number(settings.minTextLength || 1)) return null;
    if (!command && text.startsWith('!')) return null;
    const verbs = (vocabulary.requestVerbs || ['quiero escuchar', 'poneme', 'pone', 'pongan', 'pasame', 'quiero']).map(fold).sort((a, b) => b.length - a.length);
    const greetings = (vocabulary.greetings || []).map(fold).sort((a, b) => b.length - a.length);
    const fillers = (vocabulary.fillers || []).map(fold).sort((a, b) => b.length - a.length);
    const musicWords = (vocabulary.musicWords || ['tema', 'musica', 'cancion']).map(fold).sort((a, b) => b.length - a.length);
    const articles = (vocabulary.articles || ['un', 'una', 'el', 'la', 'los', 'las', 'algun', 'alguna', 'otro', 'otra']).map(fold).sort((a, b) => b.length - a.length);
    const genreEntries = (vocabulary.genres || []).slice().sort((a, b) => Math.max(...(b.words || ['']).map(w => fold(w).length)) - Math.max(...(a.words || ['']).map(w => fold(w).length)));
    let cleaned = text.replace(/@[\w.]+/g, ' ').replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    for (const greeting of greetings) cleaned = cleaned.replace(new RegExp(`^${escapeRegExp(greeting)}[\\s,.:;!-]*`, 'i'), '').trim();
    for (const filler of fillers) cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(filler)}\\b`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
    let starter = '';
    for (const verb of verbs) {
      if (new RegExp(`^${escapeRegExp(verb)}(?:\\s|$)`, 'i').test(cleaned)) { starter = verb; break; }
    }
    if (!command && !starter && settings.requireCommand) return null;
    if (!command && !starter && !musicWords.some(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(cleaned)) && !/\b(algo|un poco|un poquito)\b/i.test(cleaned)) return null;
    if (starter) cleaned = cleaned.replace(new RegExp(`^${escapeRegExp(starter)}\\b`, 'i'), '').trim();
    const stripMusicPrefix = value => {
      let result = String(value || '').trim();
      for (let pass = 0; pass < 3; pass++) {
        const before = result;
        result = result.replace(new RegExp(`^(?:(?:${articles.map(escapeRegExp).join('|')})\\s+)?(?:${musicWords.map(escapeRegExp).join('|')})(?:\\s+(?:de|del))?\\s+`, 'i'), '');
        result = result.replace(/^(?:de|del|al)\s+/i, '');
        if (result === before) break;
      }
      return result.replace(/^\s*(?:algo|un\s+poco|un\s+poquito)(?:\s+de)?\s+/i, '').replace(/^(?:de|del|al)\s+/i, '').trim();
    };
    const genreCandidate = stripMusicPrefix(cleaned).replace(new RegExp(`^(?:${articles.map(escapeRegExp).join('|')})\\s+`, 'i'), '').trim();
    const genreEntry = genreEntries.find(entry => (entry.words || []).some(word => fold(word) === genreCandidate));
    if (genreEntry) return { query: this.cleanQuery(genreEntry.spotify || genreEntry.id), kind: 'genre', original };

    // Preserve an explicit title/artist split such as "Los días que no estás - Barbi Recanati".
    const pair = cleaned.match(/^(.+?)\s+-\s+(.+)$/);
    if (pair) {
      const title = stripMusicPrefix(pair[1]);
      const artist = pair[2].replace(/^(?:de|del|por)\s+/i, '').trim();
      const query = `${title} ${artist}`.trim();
      if (query) return { query: this.cleanQuery(query), title, artist, kind: 'track', original };
    }

    if (starter && !musicWords.some(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(cleaned))) {
      const titleArtist = cleaned.match(/^(.+?)\s+de\s+(.+)$/i);
      if (titleArtist) {
        const title = titleArtist[1].replace(new RegExp(`^(?:${articles.map(escapeRegExp).join('|')})\\s+`, 'i'), '').trim();
        const artist = titleArtist[2].replace(new RegExp(`^(?:${articles.map(escapeRegExp).join('|')})\\s+`, 'i'), '').trim();
        if (title.length >= 3 && artist.length >= 3) return { query: this.cleanQuery(`${title} ${artist}`), title, artist, kind: 'track', original };
      }
    }

    const loose = cleaned.match(/\b(?:algo|un\s+poco|un\s+poquito)(?:\s+de)?\s+(.+)$/i);
    if (loose) {
      const artist = stripMusicPrefix(loose[1]).replace(new RegExp(`^(?:${articles.map(escapeRegExp).join('|')})\\s+`, 'i'), '').trim();
      if (artist) return { query: this.cleanQuery(artist), kind: 'artist', original };
    }

    const artistRequest = cleaned.match(new RegExp(`\\b(?:${musicWords.map(escapeRegExp).join('|')})\\s+(?:(?:de|del|la|el|los|las)\\s+)?(.+)$`, 'i'));
    if (artistRequest) {
      const artist = artistRequest[1].replace(new RegExp(`^(?:${articles.map(escapeRegExp).join('|')})\\s+`, 'i'), '').trim();
      if (artist.length >= 3) return { query: this.cleanQuery(artist), kind: 'artist', original };
    }

    const requestForArtist = starter && !musicWords.some(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(cleaned));
    let query = stripMusicPrefix(cleaned);
    query = query.replace(/^(?:un|una|de|del|al|la|el|los|las)\s+/i, '').replace(/\s+/g, ' ').trim();
    if (!query || query.length < 3) return null;
    return { query: this.cleanQuery(query), kind: requestForArtist ? 'artist' : 'track', original };
  }

  async reply(context, values, fallback, requester, mood = 'success', provisional = false, isolatedTest = false, interpretationSource = '', sourceComment = '', replyDetails = null, suppressHistory = false, metadata = {}) {
    const vocabulary = await this.getVocabulary();
    const responses = vocabulary.responses || {};
    const entry = responses.contexts?.[context] || responses[context];
    const variants = Array.isArray(entry?.variants) ? entry.variants : [];
    const usable = variants.filter(variant => [...String(variant).matchAll(/\{(\w+)\}/g)].every(([, key]) => values?.[key] !== undefined && values?.[key] !== null && String(values[key]) !== ''));
    const pool = usable.length ? usable : variants;
    const recentCount = Math.max(0, Math.min(10, Number(responses.recent) || 0));
    const history = this.replyHistory.get(context) || [];
    const available = responses.avoidRepeat !== false && recentCount ? pool.filter(item => !history.includes(item)) : pool;
    let template = responses.random === false ? pool[0] : (available.length ? available : pool)[Math.floor(Math.random() * (available.length ? available : pool).length)];
    if (!template) template = fallback;
    let message = String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(values?.[key] ?? ''));
    message = message.replace(/\{[^}]{0,60}\}/g, '').replace(/\s+([,.;:!?])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!suppressHistory && recentCount && variants.length && responses.avoidRepeat !== false) this.replyHistory.set(context, history.concat([template]).slice(-recentCount));
    if (this.activeSettings?.personalize !== false && requester && !String(template).includes('{nombre}')) {
      const name = String(requester).trim().split(/\s+/)[0];
      if (name && context !== 'searching') message = `${name}, ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
    }
    let replyAi = false, replyFallbackReason = '';
    if (!provisional && responses.aiRepliesEnabled !== false && this.options.generateAiReply && (this.activeSettings?.announce !== false || isolatedTest)) {
      try {
        const generated = await this.options.generateAiReply({
          mode: 'response', context, values, requester, comment: String(sourceComment || '').slice(0, 500), fallback: message,
          isolatedTest: isolatedTest === true
        });
        if (typeof generated === 'string' && generated.trim()) { message = generated.trim().slice(0, 220); replyAi = true; }
        else if (generated?.reply) { message = String(generated.reply).trim().slice(0, 220); replyAi = true; }
        else replyFallbackReason = 'La IA no generó una respuesta; se usó la respuesta normal guardada.';
      } catch (error) {
        replyFallbackReason = String(error?.message || 'La IA no respondió; se usó la respuesta normal guardada.').slice(0, 300);
      }
    }
    if (replyDetails && typeof replyDetails === 'object') Object.assign(replyDetails, {
      replyAi,
      replySource: replyAi ? 'ai' : 'normal',
      replyModel: replyAi ? String(vocabulary.ai?.model || '').slice(0, 80) : '',
      replyFallbackReason
    });
    if (this.activeSettings?.announce !== false || isolatedTest) {
      const delivery = await this.options.sendBotReply(message, requester, mood, provisional, isolatedTest, {
        interpretationSource,
        simulationCommentId: String(metadata?.simulationCommentId || '').slice(0, 120),
        traceId: String(metadata?.traceId || '').slice(0, 80)
      });
      if (isolatedTest) this.lastIsolatedTestReplySent = delivery?.success === true && delivery?.isolatedTest === true;
    }
    return message;
  }

  async devices() {
    const result = await this.api('/me/player/devices');
    const devices = result.body.devices || [];
    if (this.options.reportDevices) await this.options.reportDevices(devices).catch(() => {});
    return devices;
  }

  chooseDevice(devices, preferred) {
    const target = fold(preferred);
    if (target) {
      const exact = devices.find(device => fold(device.name) === target);
      if (exact) return exact;
      const partial = devices.find(device => fold(device.name).includes(target) || target.includes(fold(device.name)));
      if (partial) return partial;
      return null;
    }
    return devices.find(device => device.is_active) || devices.find(device => device.type === 'Computer') || devices[0] || null;
  }

  async search(parsed, aliases, settings = {}, options = {}) {
    const allowAliasLearning = options.allowAliasLearning !== false;
    const requestedQuery = this.cleanQuery(parsed.query);
    const alias = aliases[fold(requestedQuery)];
    const query = this.cleanQuery(alias || requestedQuery);
    if (parsed.kind === 'artist') {
      const artistResult = await this.api(`/search?${new URLSearchParams({ q: query, type: 'artist', limit: '5' })}`);
      const artists = artistResult.body.artists?.items || [];
      const wanted = fold(query);
      const artist = artists.find(item => fold(item.name) === wanted)
        || artists.find(item => fold(item.name).includes(wanted) || wanted.includes(fold(item.name)))
        || artists
          .map(item => ({ item, score: textSimilarity(item.name, query) }))
          .sort((a, b) => b.score - a.score)[0]
          ?.item;
      const artistScore = artist ? textSimilarity(artist.name, query) : 0;
      const artistIsClose = artist && (fold(artist.name) === wanted
        || fold(artist.name).includes(wanted)
        || wanted.includes(fold(artist.name))
        || artistScore >= 0.76);
      if (artistIsClose) {
        // Spotify Search now rejects limits above 10 (the old API maximum was 50).
        const poolSize = Math.max(5, Math.min(10, Number(settings.artistVarietyPool) || 10));
        const trackResult = await this.api(`/search?${new URLSearchParams({ q: artist.name, type: 'track', limit: String(poolSize) })}`);
        parsed.resolvedArtist = artist.name;
        const matching = (trackResult.body.tracks?.items || []).filter(track => track.artists?.some(item => fold(item.name) === fold(artist.name) || fold(item.name).includes(fold(artist.name))));
        if (allowAliasLearning && matching.length && requestedQuery && fold(requestedQuery) !== fold(artist.name) && textSimilarity(requestedQuery, artist.name) >= 0.76) {
          this.rememberArtistAlias(requestedQuery, artist.name);
        }
        if (matching.length) return matching;
      }
      const rawOriginal = this.cleanQuery(parsed.original || parsed.query);
      const rawQuery = this.cleanQuery(aliases[fold(rawOriginal)] || rawOriginal);
      if (rawQuery && fold(rawQuery) !== fold(query)) {
        const rawResult = await this.api(`/search?${new URLSearchParams({ q: rawQuery, type: 'track', limit: '10' })}`);
        const rawMatching = (rawResult.body.tracks?.items || []).filter(track => track.artists?.some(item =>
          fold(item.name).includes(wanted) || wanted.includes(fold(item.name)) || textSimilarity(item.name, query) >= 0.76
        ));
        if (rawMatching.length) {
          const matchedArtist = rawMatching[0].artists
            .map(item => ({ item, score: textSimilarity(item.name, query) }))
            .sort((a, b) => b.score - a.score)[0];
          parsed.resolvedArtist = matchedArtist?.score >= 0.76 ? matchedArtist.item.name : query;
          if (allowAliasLearning && matchedArtist?.score >= 0.76 && textSimilarity(requestedQuery, matchedArtist.item.name) >= 0.76) {
            this.rememberArtistAlias(requestedQuery, matchedArtist.item.name);
          }
          return rawMatching;
        }
      }
      // If the artist catalog lookup misses a regional/alternate artist name,
      // use Spotify's supported artist filter on track search.
      const filteredResult = await this.api(`/search?${new URLSearchParams({ q: `artist:${query}`, type: 'track', limit: '10' })}`);
      const matching = (filteredResult.body.tracks?.items || []).filter(track => track.artists?.some(item =>
        fold(item.name).includes(wanted) || wanted.includes(fold(item.name)) || textSimilarity(item.name, query) >= 0.76
      ));
      if (matching.length) {
        const matchedArtist = matching[0].artists
          .map(item => ({ item, score: textSimilarity(item.name, query) }))
          .sort((a, b) => b.score - a.score)[0];
        parsed.resolvedArtist = matchedArtist?.score >= 0.76 ? matchedArtist.item.name : query;
        if (allowAliasLearning && matchedArtist?.score >= 0.76 && textSimilarity(requestedQuery, matchedArtist.item.name) >= 0.76) {
          this.rememberArtistAlias(requestedQuery, matchedArtist.item.name);
        }
        return matching;
      }
      // Artist requests must not fall through to an unrestricted track search:
      // a miss can otherwise select an unrelated track with a vaguely similar title.
      return [];
    }
    const params = new URLSearchParams({ q: query, type: 'track', limit: '10' });
    const result = await this.api(`/search?${params}`);
    return result.body.tracks?.items || [];
  }

  rememberArtistAlias(from, to) {
    const source = this.cleanQuery(from);
    const target = this.cleanQuery(to);
    if (!source || !target || fold(source) === fold(target) || textSimilarity(source, target) < 0.76) return;
    const base = this.options.getCortexBaseUrl();
    fetch(`${base}/api/spotify-aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: source, to: target, artist: target })
    }).catch(() => {});
  }

  async searchWithVariants(parsed, aliases, vocabulary, settings, options = {}) {
    const original = this.cleanQuery(parsed.query);
    // Artist intent should resolve its exact parsed query before typo variants;
    // otherwise a looser spelling can find a different artist or unrelated song.
    if (parsed.kind === 'artist') {
      const exactArtistTracks = await this.search(parsed, aliases, settings, options);
      if (exactArtistTracks.length) return exactArtistTracks;
    }
    const candidates = [];
    const add = value => {
      const clean = this.cleanQuery(value);
      if (!clean || fold(clean) === fold(original) || candidates.some(item => fold(item) === fold(clean))) return;
      candidates.push(clean);
    };
    const glued = original.match(/^(la|el|los|las|un|una|del)(?=[a-z]{4,})(.+)$/i);
    if (glued) add(`${glued[1]} ${glued[2]}`);
    add(original.replace(/^(?:la|el|los|las|un|una|del|de)\s+/i, ''));
    const words = original.split(/\s+/);
    for (let index = 0; index < words.length; index++) {
      if (words[index].length < 5) continue;
      for (const pair of vocabulary.typoSwaps || []) {
        if (!Array.isArray(pair) || pair.length < 2 || !words[index].includes(pair[0])) continue;
        const variant = words.slice();
        variant[index] = variant[index].replace(pair[0], pair[1]);
        add(variant.join(' '));
      }
    }
    const maxAttempts = Math.max(1, Math.min(8, Number(vocabulary.search?.maxAttempts) || 7));
    for (const candidate of candidates.slice(0, maxAttempts - 1)) {
      const attempt = { ...parsed, query: candidate, title: parsed.title, artist: parsed.artist };
      const tracks = await this.search(attempt, aliases, settings, options);
      if (!tracks.length) continue;
      if (options.allowAliasLearning !== false && textSimilarity(original, candidate) >= 0.78
        && (parsed.kind !== 'artist' || (attempt.resolvedArtist && textSimilarity(original, attempt.resolvedArtist) >= 0.76))) {
        this.rememberArtistAlias(original, parsed.kind === 'artist' ? attempt.resolvedArtist : candidate);
      }
      parsed.query = candidate;
      parsed.resolvedArtist = attempt.resolvedArtist;
      return tracks;
    }
    return [];
  }

  async requestAiInterpretation(comment, requester, vocabulary, { isolatedSimulation = false } = {}) {
    const ai = vocabulary.ai || {};
    if (ai.enabled !== true) return { parsed: null, attempted: false, reason: 'IA desactivada.' };
    if (ai.requireSignal !== false && !hasPossibleMusicIntent(comment, vocabulary)) return { parsed: null, attempted: false, reason: 'Sin señal de pedido musical.' };
    const base = this.options.getCortexBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1500, Math.min(15000, Number(ai.timeoutMs) || 8000)));
    try {
      const response = await fetch(`${base}/api/spotify-ai-interpret`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: String(comment).slice(0, 400), requester: String(requester || '').slice(0, 80), isolatedSimulation })
      });
      const data = await response.json().catch(() => ({}));
      const result = data.interpretation;
      if (!response.ok) return { parsed: null, attempted: true, reason: String(data.error || `Error HTTP ${response.status}.`).slice(0, 180) };
      if (!result) return { parsed: null, attempted: true, reason: 'La IA devolvió una respuesta inválida.' };
      if (result.action !== 'play') return { parsed: null, attempted: true, reason: result.action === 'none' ? 'La IA no detectó un pedido musical.' : 'La IA no devolvió un pedido válido.' };
      if (typeof result.confidence === 'number' && Number.isFinite(result.confidence) && result.confidence < 0.55) {
        return { parsed: null, attempted: true, reason: 'La confianza de la IA fue baja.' };
      }
      if (result.genre) return { parsed: { query: this.cleanQuery(result.genre), kind: 'genre', original: comment, ai: true }, attempted: true, reason: '' };
      if (result.title && result.artist) return { parsed: { query: this.cleanQuery(`${result.title} ${result.artist}`), title: this.cleanQuery(result.title), artist: this.cleanQuery(result.artist), kind: 'track', original: comment, ai: true }, attempted: true, reason: '' };
      const query = this.cleanQuery(result.query || result.artist || '');
      if (!query) return { parsed: null, attempted: true, reason: 'La IA no devolvió una búsqueda válida.' };
      return { parsed: { query, kind: result.artist && !result.title ? 'artist' : 'track', original: comment, ai: true }, attempted: true, reason: '' };
    } catch (_) { return { parsed: null, attempted: true, reason: 'La IA no respondió o agotó el tiempo de espera.' }; }
    finally { clearTimeout(timer); }
  }

  aiMatchesLocalInterpretation(aiParsed, ruleParsed, comment, vocabulary) {
    if (!aiParsed) return false;
    if (!ruleParsed) {
      const foldedComment = fold(comment);
      const explicitGenre = (vocabulary.genres || []).some(entry => (entry.words || []).some(word => {
        const foldedWord = fold(word);
        return foldedWord && new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(foldedWord)}(?:$|[^a-z0-9])`, 'i').test(foldedComment);
      }));
      if (aiParsed.kind === 'genre') return explicitGenre;
      const requestName = requestContentPhrase(comment);
      const aiNames = [aiParsed.artist, aiParsed.title && aiParsed.artist ? `${aiParsed.title} ${aiParsed.artist}` : '', aiParsed.query]
        .map(requestContentPhrase).filter(Boolean);
      return !!requestName && aiNames.some(name => textSimilarity(requestName, name) >= 0.60);
    }
    if (ruleParsed.kind === 'genre') {
      return aiParsed.kind === 'genre' && textSimilarity(aiParsed.query, ruleParsed.query) >= 0.72;
    }
    if (aiParsed.kind === 'genre') return false;
    if (ruleParsed.kind === 'artist') {
      const aiArtist = aiParsed.artist || (aiParsed.kind === 'artist' ? aiParsed.query : '');
      if (aiArtist) return textSimilarity(aiArtist, ruleParsed.query) >= 0.70;
      return aiParsed.kind === 'track' && textSimilarity(aiParsed.query, ruleParsed.query) >= 0.72;
    }
    const aiQuery = aiParsed.query || `${aiParsed.title || ''} ${aiParsed.artist || ''}`;
    return textSimilarity(aiQuery, ruleParsed.query) >= 0.62;
  }

  chooseTrack(tracks, parsed, settings, options = {}) {
    const updateSelectionState = options.updateSelectionState !== false;
    const recentTrackUris = Array.isArray(options.recentTrackUris) ? options.recentTrackUris : this.recentTrackUris;
    const artistBags = options.artistBags instanceof Map ? options.artistBags : this.artistBags;
    if (!tracks.length) return null;
    const query = parsed.query;
    const kind = parsed.kind;
    const q = fold(query);
    const scored = tracks.map((track, index) => {
      const name = fold(track.name);
      const artists = track.artists.map(artist => fold(artist.name));
      let score = Math.max(0, 10 - index);
      if (name === q) score += 50;
      if (name.includes(q) || q.includes(name)) score += 20;
      if (parsed.title && name.includes(fold(parsed.title))) score += 40;
      if (parsed.artist && artists.some(artist => artist === fold(parsed.artist) || artist.includes(fold(parsed.artist)) || fold(parsed.artist).includes(artist))) score += 55;
      if (artists.some(artist => artist === fold(parsed.resolvedArtist || q) || artist.includes(fold(parsed.resolvedArtist || q)))) score += kind === 'artist' ? 45 : 12;
      if (track.is_playable === false || track.is_local) score -= 100;
      return { track, score };
    }).sort((a, b) => b.score - a.score);
    if ((kind === 'genre' || (kind === 'artist' && parsed.resolvedArtist)) && settings?.artistVariety !== false) {
      const fresh = scored.filter(item => !recentTrackUris.includes(item.track.uri));
      const candidates = fresh.length ? fresh : scored;
      const key = `${kind}:${fold(parsed.resolvedArtist || query)}`;
      let bag = artistBags.get(key) || [];
      const available = candidates.filter(item => !bag.includes(item.track.uri));
      if (!available.length) { bag = []; if (updateSelectionState) artistBags.set(key, bag); }
      const pool = available.length ? available : candidates;
      const selected = pool[Math.floor(Math.random() * pool.length)];
      if (selected?.track?.uri) {
        if (updateSelectionState) {
          bag.push(selected.track.uri);
          artistBags.set(key, bag.slice(-pool.length));
          recentTrackUris.push(selected.track.uri);
          if (recentTrackUris === this.recentTrackUris) this.recentTrackUris = recentTrackUris.slice(-30);
          else recentTrackUris.splice(0, Math.max(0, recentTrackUris.length - 30));
        }
        return selected.track;
      }
    }
    return scored[0]?.track || tracks[0];
  }

  async play(track, device, settings, options = {}) {
    const requestedStart = Number(options.startAt);
    const requestedOffset = Number.isFinite(requestedStart) && requestedStart > 0
      ? Math.min(600, requestedStart) * 1000
      : (settings.skipEnabled ? Math.max(0, Math.min(120, Number(settings.skipSeconds) || 0)) * 1000 : 0);
    const durationMs = Number(track.duration_ms) || 0;
    const startPositionMs = requestedOffset > 0 && durationMs > 0
      ? Math.min(requestedOffset, Math.max(0, durationMs - 1000))
      : requestedOffset;
    const deviceParams = new URLSearchParams({ device_id: device.id });
    const readPlaybackState = async () => (await this.api('/me/player')).body;
    const isRequestedTrackOnDevice = state => state?.item?.uri === track.uri
      && (state?.device?.id === device.id || fold(state?.device?.name) === fold(device.name));
    const confirmsPlayback = state => state?.is_playing === true && isRequestedTrackOnDevice(state);
    const waitForTrack = async (requirePlaying, attempts, intervalMs) => {
      let state = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await wait(intervalMs);
        state = await readPlaybackState();
        if (isRequestedTrackOnDevice(state) && (!requirePlaying || state.is_playing === true)) return state;
      }
      return state;
    };

    // Algunos clientes de escritorio devuelven HTTP 204 a /play aunque no
    // cambien la canción. Para pedidos manuales conservamos la playlist:
    // ponemos el tema al principio de la cola, lo confirmamos y recién ahí
    // avanzamos. El éxito depende de confirmar el tema reproduciéndose.
    if (device.is_active === false) {
      await this.api('/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [device.id], play: false })
      });
      await wait(400);
    }

    let currentState = await readPlaybackState();
    if (confirmsPlayback(currentState)) {
      this.lastTrackUri = track.uri;
      this.lastSkippedUri = '';
      this.trackEndAt = Number.isFinite(Number(options.endAt)) && Number(options.endAt) > 0 ? Math.min(3600, Number(options.endAt)) : 0;
      return { ok: true, alreadyPlaying: true };
    }

    // Si el mismo pedido está pausado, reanudarlo evita duplicarlo en la cola.
    if (isRequestedTrackOnDevice(currentState) && currentState?.is_playing !== true) {
      if (startPositionMs > 0) {
        await this.api(`/me/player/seek?position_ms=${startPositionMs}&${deviceParams}`, { method: 'PUT' });
      }
      await this.api(`/me/player/play?${deviceParams}`, { method: 'PUT', body: '{}' });
      currentState = await waitForTrack(true, 12, 250);
      if (!confirmsPlayback(currentState)) throw new Error(`Spotify aceptó reanudar, pero no confirmó "${track.name}" sonando en ${device.name}.`);
      this.lastTrackUri = track.uri;
      this.lastSkippedUri = '';
      this.trackEndAt = Number.isFinite(Number(options.endAt)) && Number(options.endAt) > 0 ? Math.min(3600, Number(options.endAt)) : 0;
      return { ok: true, resumed: true };
    }

    const queuePath = `/me/player/queue?${new URLSearchParams({ uri: track.uri, device_id: device.id })}`;
    const readQueue = async () => (await this.api('/me/player/queue')).body;
    let queue = await readQueue();
    let firstInQueue = queue?.queue?.[0]?.uri === track.uri;
    const alreadyQueued = () => Array.isArray(queue?.queue) && queue.queue.some(item => item?.uri === track.uri);
    if (!firstInQueue && !alreadyQueued()) {
      await this.api(queuePath, { method: 'POST' });
      for (let attempt = 0; attempt < 4 && !firstInQueue; attempt += 1) {
        await wait(450);
        queue = await readQueue();
        firstInQueue = queue?.queue?.[0]?.uri === track.uri;
      }
    }
    if (!firstInQueue) {
      const blockingTrack = String(queue?.queue?.[0]?.name || '').trim();
      throw new Error(blockingTrack
        ? `"${blockingTrack}" está antes en la cola de Spotify. No salté para no omitir esa canción; quítala de la cola si quieres que "${track.name}" suene ahora.`
        : `Spotify no confirmó "${track.name}" como siguiente tema; no avancé la playlist para evitar saltar otra canción.`);
    }

    const advanceQueuedTrack = async () => {
      let previousTrackUri = '';
      let pausedPreviousTrack = false;
      let advanced = false;
      let completed = false;
      let originalVolume = null;
      let restoreVolume = false;
      const readDevice = async () => {
        const result = await this.api('/me/player/devices');
        return (result.body?.devices || []).find(item => item.id === device.id) || null;
      };
      const waitForVolume = async target => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if ((await readDevice())?.volume_percent === target) return true;
          await wait(150);
        }
        return false;
      };
      const setVolume = value => this.api(`/me/player/volume?volume_percent=${value}&${deviceParams}`, { method: 'PUT' });

      try {
        // /next no acepta position_ms. Si hay offset, silenciamos el dispositivo
        // durante el salto y seek para que no se escuche la introducción.
        if (startPositionMs > 0) {
          const deviceState = await readDevice();
          originalVolume = deviceState?.volume_percent;
          if (deviceState?.supports_volume === false || !Number.isInteger(originalVolume) || originalVolume < 0 || originalVolume > 100) {
            throw new Error('No puedo confirmar el volumen del dispositivo Spotify para aplicar el inicio configurado; no avancé la cola.');
          }
          if (originalVolume > 0) {
            restoreVolume = true;
            await setVolume(0);
            if (!await waitForVolume(0)) throw new Error('Spotify no confirmó el silencio previo; no avancé la cola.');
          }

          const beforeAdvance = await readPlaybackState();
          if (beforeAdvance?.is_playing === true) {
            previousTrackUri = beforeAdvance.item?.uri || '';
            await this.api(`/me/player/pause?${deviceParams}`, { method: 'PUT' });
            let pauseConfirmed = false;
            for (let attempt = 0; attempt < 12; attempt += 1) {
              await wait(100);
              const state = await readPlaybackState();
              if (state?.device?.id === device.id && state.is_playing === false) { pauseConfirmed = true; break; }
            }
            if (!pauseConfirmed) throw new Error('Spotify no confirmó la pausa previa; no avancé la cola.');
            pausedPreviousTrack = true;
          }
        }

        await this.api(`/me/player/next?${deviceParams}`, { method: 'POST' });
        advanced = true;
        let state = await waitForTrack(startPositionMs === 0, startPositionMs > 0 ? 20 : 6, startPositionMs > 0 ? 150 : 500);
        if (!isRequestedTrackOnDevice(state)) {
          throw new Error(`Spotify recibió Siguiente, pero no confirmó "${track.name}" en ${device.name}.`);
        }

        if (startPositionMs > 0) {
          if (state.progress_ms == null || Number(state.progress_ms) < startPositionMs) {
            await this.api(`/me/player/seek?position_ms=${startPositionMs}&${deviceParams}`, { method: 'PUT' });
            let seekConfirmed = false;
            for (let attempt = 0; attempt < 12; attempt += 1) {
              await wait(150);
              state = await readPlaybackState();
              if (isRequestedTrackOnDevice(state) && Number(state.progress_ms) >= startPositionMs) { seekConfirmed = true; break; }
            }
            if (!seekConfirmed) throw new Error('Spotify no confirmó el salto inicial; dejé el tema pausado para proteger la introducción.');
          }
          if (state.is_playing !== true) {
            await this.api(`/me/player/play?${deviceParams}`, { method: 'PUT', body: '{}' });
            state = await waitForTrack(true, 12, 100);
          }
          if (!confirmsPlayback(state) || Number(state.progress_ms) < startPositionMs) {
            throw new Error('Spotify no confirmó la reproducción desde el segundo configurado; revisa el dispositivo.');
          }
        } else if (state.is_playing !== true) {
          await this.api(`/me/player/play?${deviceParams}`, { method: 'PUT', body: '{}' });
          state = await waitForTrack(true, 12, 250);
          if (!confirmsPlayback(state)) throw new Error(`Spotify cambió de tema, pero no confirmó "${track.name}" reproduciéndose.`);
        }

        completed = true;
        return state;
      } finally {
        if (!completed) {
          const state = await readPlaybackState().catch(() => null);
          if (advanced && isRequestedTrackOnDevice(state) && state?.is_playing === true) {
            await this.api(`/me/player/pause?${deviceParams}`, { method: 'PUT' }).catch(() => {});
          } else if (!advanced && pausedPreviousTrack && state?.device?.id === device.id && state?.item?.uri === previousTrackUri && state?.is_playing === false) {
            await this.api(`/me/player/play?${deviceParams}`, { method: 'PUT', body: '{}' }).catch(() => {});
          }
        }
        if (restoreVolume && originalVolume !== null) {
          let restored = false;
          for (let attempt = 0; attempt < 2 && !restored; attempt += 1) {
            try {
              await setVolume(originalVolume);
              restored = await waitForVolume(originalVolume);
            } catch (_) { /* Reintentar para no dejar el volumen silenciado. */ }
          }
          if (!restored) throw new Error(`Spotify no confirmó la restauración del volumen a ${originalVolume}%. Revisa el volumen de la aplicación.`);
        }
      }
    };

    currentState = await advanceQueuedTrack();
    if (!confirmsPlayback(currentState)) throw new Error(`Spotify no confirmó "${track.name}" reproduciéndose en ${device.name}.`);
    this.lastTrackUri = track.uri;
    this.lastSkippedUri = '';
    this.trackEndAt = Number.isFinite(Number(options.endAt)) && Number(options.endAt) > 0 ? Math.min(3600, Number(options.endAt)) : 0;
    return { ok: true, track, device: device.name, state: currentState };
  }

  async previewComment(text, requester = 'Chat', options = {}) {
    const comment = String(text || '').trim();
    const folded = fold(comment);
    if (!comment) return { ok: false, ignored: true, interpretationSource: 'none' };

    // Commands that can change Spotify state are visible in the replay, but
    // must never reach the transport handlers during a search-only preview.
    if (/^!(?:spotifydevices|spotifyoffset|skip|siguiente|pause|pausa|resume|reanudar|next|previous|anterior)\b/.test(folded)) {
      return { ok: true, transportPreview: true, response: 'La vista previa detectó un comando de control; no lo ejecutó.', interpretationSource: 'rules' };
    }

    const vocabulary = await this.getVocabulary();
    if (!await this.isMusicIntentCandidate(comment)) return { ok: false, ignored: true, interpretationSource: 'none' };
    const settings = await this.getSettings();
    const aiFirst = vocabulary.ai?.enabled === true && vocabulary.ai?.onlyWhenNotUnderstood === false;
    let parsed;
    let interpretationSource = 'none';
    let aiAttempted = false;
    let aiFallbackReason = '';

    if (aiFirst) {
      const ruleParsed = this.parseRequest(comment, vocabulary, settings);
      const aiResult = await this.requestAiInterpretation(comment, requester, vocabulary, { isolatedSimulation: true });
      aiAttempted = aiResult.attempted;
      if (aiResult.parsed && this.aiMatchesLocalInterpretation(aiResult.parsed, ruleParsed, comment, vocabulary)) {
        parsed = aiResult.parsed;
        interpretationSource = 'ai';
      } else {
        parsed = ruleParsed;
        if (parsed) interpretationSource = aiAttempted ? 'rules-fallback' : 'rules';
        if (aiAttempted) aiFallbackReason = aiResult.parsed
          ? 'La respuesta de IA no coincide con el artista, tema o género escrito; usé la interpretación local.'
          : aiResult.reason;
      }
    } else {
      parsed = this.parseRequest(comment, vocabulary, settings);
      if (parsed) interpretationSource = 'rules';
      else {
        const aiResult = await this.requestAiInterpretation(comment, requester, vocabulary, { isolatedSimulation: true });
        aiAttempted = aiResult.attempted;
        parsed = aiResult.parsed;
        if (parsed) interpretationSource = 'ai';
        else if (aiAttempted) aiFallbackReason = aiResult.reason;
      }
    }

    const interpretationDetails = {
      interpretationSource, aiInterpreted: parsed?.ai === true, aiAttempted,
      aiModel: aiAttempted || parsed?.ai === true ? String(vocabulary.ai?.model || '').slice(0, 120) : '',
      aiFallbackReason
    };
    if (!parsed) return { ok: false, ignored: true, ...interpretationDetails };

    const globalWaitMs = Math.min(3600000, Math.max(0, Number(options.virtualCooldown?.globalWaitMs) || 0));
    const userWaitMs = Math.min(3600000, Math.max(0, Number(options.virtualCooldown?.userWaitMs) || 0));
    if (globalWaitMs > 0) {
      const seconds = Math.ceil(globalWaitMs / 1000);
      return { ok: false, cooldown: true, cooldownType: 'global-cooldown', response: `Espera ${seconds}s para pedir otro tema.`, ...interpretationDetails };
    }
    if (userWaitMs > 0) {
      const seconds = Math.ceil(userWaitMs / 1000);
      return { ok: false, cooldown: true, cooldownType: 'user-cooldown', response: `${String(requester || 'Espectador').split(/\s+/)[0]}, ya pediste un tema hace poco. Espera ${seconds}s.`, ...interpretationDetails };
    }

    // This path deliberately does not call handleMessage(): that method owns
    // live queue, cooldown, inFlight, playback, and reply state.
    const tracks = await this.searchWithVariants(parsed, await this.getAliases(), vocabulary, settings, { allowAliasLearning: false });
    const track = this.chooseTrack(tracks, parsed, settings, { updateSelectionState: false, recentTrackUris: [], artistBags: new Map() });
    if (!track) {
      return {
        ok: false, notFound: true,
        response: `No encontré "${parsed.query}" en Spotify.`,
        query: parsed.query, ...interpretationDetails
      };
    }
    const artists = (track.artists || []).map(artist => artist.name).join(', ');
    return {
      ok: true, analysis: true, track,
      response: `Encontré: ${track.name} - ${artists} (no reproduje)`,
      ...interpretationDetails
    };
  }

  async handleMessage(message, options = {}) {
    const isolatedPlayback = options.explicitTestPlayback === true || options.isolatedLiveSimulation === true;
    const traceId = String(message?.meta?.traceId || message?.traceId || '').slice(0, 80);
    if (isolatedPlayback) this.lastIsolatedTestReplySent = false;
    const text = String(message.chatmessage || '').trim();
    const replyDetails = {};
    const respond = (context, values, fallback, requester, mood, provisional, isolatedTest = false, interpretationSource) =>
      this.reply(context, values, fallback, requester, mood, provisional, isolatedTest || isolatedPlayback, interpretationSource, text, replyDetails, options.suppressReplyHistory === true, { simulationCommentId: options.simulationCommentId, traceId });
    if (!text) return { ok: false, ignored: true };
    const vocabulary = await this.getVocabulary();
    const hasQuickIntent = /^!/.test(fold(text)) || hasPossibleMusicIntent(text, vocabulary);
    if (!hasQuickIntent) return { ok: false, ignored: true };
    const settings = await this.getSettings();
    this.activeSettings = options.silent ? { ...settings, announce: false } : settings;
    if (!options.explicitTestPlayback && !options.analysis && !options.manualTransport && (await this.getRuloEnabled()) === false) {
      return { ok: false, ignored: true, disabled: true, ruloDisabled: true, reason: 'Rulo está apagado; los pedidos de música del chat no se procesan.' };
    }
    // Dashboard analysis is search-only and does not play a track, so it stays
    // available even while real chat requests are disabled.
    if (settings.enabled === false && !options.explicitTestPlayback && !options.analysis && !options.manualTransport) return { ok: false, ignored: true, reason: 'Pedidos Spotify apagados en los ajustes.' };
    const folded = fold(text);
    if (options.analysis === true && /^!(?:spotifydevices|spotifyoffset|skip|siguiente|pause|pausa|resume|reanudar|next|previous|anterior)\b/.test(folded)) {
      return { ok: true, analysis: true, transportPreview: true, response: 'La vista previa detectó un comando de control; no lo ejecutó.' };
    }
    if (/^!spotifydevices\b/.test(folded)) {
      if (!this.isConnected()) {
        const response = await respond('noToken', {}, 'Spotify no está conectado.', message.chatname, 'error');
        return { ok: false, response, error: 'Spotify no está conectado.' };
      }
      try {
        const devices = await this.devices();
        const list = devices.map(device => `${device.name}${device.is_active ? ' (activo)' : ''}`).join(', ') || 'no hay dispositivos';
        const response = await respond('devices', { dispositivos: list }, `Dispositivos Spotify: ${list}`, message.chatname);
        return { ok: true, response, devices };
      } catch (error) { return { ok: false, error: error.message }; }
    }
    if (/^!spotifyoffset\b/.test(folded)) {
      const response = await respond('transportOk', { accion: `offset ${settings.skipEnabled ? `${settings.skipSeconds} segundos` : 'apagado'}` }, `Offset: ${settings.skipEnabled ? `${settings.skipSeconds}s` : 'apagado'}.`, message.chatname);
      return { ok: true, response };
    }
    if (/^!skip\b/.test(folded) || /^!siguiente\b/.test(folded)) {
      if (!this.isConnected()) {
        const response = await respond('noToken', {}, 'Spotify no está conectado.', message.chatname, 'error');
        return { ok: false, response, error: 'Spotify no está conectado.' };
      }
      try {
        await this.api('/me/player/next', { method: 'POST' });
        const response = await respond('transportOk', { accion: 'pasar al siguiente tema' }, 'Pasando al siguiente tema.', message.chatname);
        return { ok: true, response };
      } catch (error) { return { ok: false, error: error.message }; }
    }
    const chatTransport = {
      '!pause': ['PUT', '/me/player/pause', 'pausar'],
      '!pausa': ['PUT', '/me/player/pause', 'pausar'],
      '!resume': ['PUT', '/me/player/play', 'reanudar'],
      '!reanudar': ['PUT', '/me/player/play', 'reanudar'],
      '!next': ['POST', '/me/player/next', 'pasar al siguiente tema'],
      '!previous': ['POST', '/me/player/previous', 'volver al tema anterior'],
      '!anterior': ['POST', '/me/player/previous', 'volver al tema anterior']
    }[folded];
    if (chatTransport) {
      if (!this.isConnected()) {
        const response = await respond('noToken', {}, 'Spotify no está conectado.', message.chatname, 'error');
        return { ok: false, response, error: 'Spotify no está conectado.' };
      }
      try {
        await this.api(chatTransport[1], { method: chatTransport[0] });
        if ((folded === '!next' || folded === '!previous' || folded === '!anterior') && settings.skipEnabled) {
          await wait(500);
          await this.api(`/me/player/seek?position_ms=${Math.max(0, Number(settings.skipSeconds) || 0) * 1000}`, { method: 'PUT' }).catch(() => {});
        }
        const response = await respond('transportOk', { accion: chatTransport[2] }, `Comando "${chatTransport[2]}" enviado a Spotify.`, message.chatname);
        await this.publishPlaybackState(true);
        return { ok: true, response };
      } catch (error) {
        const response = await respond('transportFail', { accion: chatTransport[2] }, `No se pudo ejecutar "${chatTransport[2]}".`, message.chatname, 'error');
        return { ok: false, error: error.message, response };
      }
    }
    const aiFirst = vocabulary.ai?.enabled === true && vocabulary.ai?.onlyWhenNotUnderstood === false;
    let parsed, interpretationSource = 'none', aiAttempted = false, aiFallbackReason = '';
    if (options.resolvedInterpretation?.parsed) {
      ({ parsed, interpretationSource = 'rules', aiAttempted = false, aiFallbackReason = '' } = options.resolvedInterpretation);
    } else if (options.forceQuery) {
      parsed = { query: this.cleanQuery(options.forceQuery), kind: 'track', original: text };
      interpretationSource = 'manual';
    } else if (aiFirst) {
      const ruleParsed = this.parseRequest(text, vocabulary, settings);
      const aiResult = await this.requestAiInterpretation(text, message.chatname, vocabulary);
      aiAttempted = aiResult.attempted;
      if (aiResult.parsed && this.aiMatchesLocalInterpretation(aiResult.parsed, ruleParsed, text, vocabulary)) {
        parsed = aiResult.parsed;
        interpretationSource = 'ai';
      } else {
        parsed = ruleParsed;
        if (parsed) interpretationSource = aiAttempted ? 'rules-fallback' : 'rules';
        if (aiAttempted) {
          aiFallbackReason = aiResult.parsed
            ? 'La respuesta de IA no coincide con el artista, tema o género escrito; usé la interpretación local.'
            : aiResult.reason;
        }
      }
    } else {
      parsed = this.parseRequest(text, vocabulary, settings);
      if (parsed) interpretationSource = 'rules';
      else {
        const aiResult = await this.requestAiInterpretation(text, message.chatname, vocabulary);
        aiAttempted = aiResult.attempted;
        parsed = aiResult.parsed;
        if (parsed) interpretationSource = 'ai';
        else if (aiAttempted) aiFallbackReason = aiResult.reason;
      }
    }
    const interpretationDetails = {
      interpretationSource,
      aiInterpreted: parsed?.ai === true,
      aiAttempted,
      aiModel: aiAttempted || parsed?.ai === true ? String(vocabulary.ai?.model || '').slice(0, 120) : '',
      aiFallbackReason
    };
    if (!parsed) {
      if (!options.suppressLog && (aiAttempted || hasPossibleMusicIntent(text, vocabulary))) {
        await this.options.logRequest({
          traceId, source: message.type, platform: message.platform, requester: message.chatname, requesterId: message.userid,
          comment: text, status: 'not_understood', result: 'not_understood', isRequest: true, ok: false,
          message: aiFallbackReason || 'No se pudo interpretar este comentario como un pedido de música.',
          timestamp: Date.now(), ...interpretationDetails
        });
      }
      return { ok: false, ignored: true, ...interpretationDetails };
    }
    const sourcePlatform = String(message.platform || message.type || '').toLowerCase();
    if (sourcePlatform === 'facebook' && !options.analysis && !options.explicitTestPlayback && !options.localQueueDrained) {
      const queuedBefore = this.localRequestQueueSize;
      if (queuedBefore >= 20) {
        const response = await respond('queueFull', {}, 'La lista de pedidos está llena. Intenta de nuevo en unos segundos.', message.chatname, 'warning');
        return { ok: false, queued: false, error: 'La lista de pedidos de Spotify está llena.', response, ...interpretationDetails };
      }
      this.localRequestQueueSize += 1;
      const prior = this.localRequestQueue;
      let release;
      this.localRequestQueue = new Promise(resolve => { release = resolve; });
      try {
        await prior.catch(() => {});
        return await this.handleMessage(message, { ...options, localQueueDrained: true, resolvedInterpretation: { parsed, ...interpretationDetails } });
      } finally {
        this.localRequestQueueSize = Math.max(0, this.localRequestQueueSize - 1);
        release();
      }
    }
    if (!this.isConnected()) {
      const response = await respond('noToken', {}, 'Spotify no está conectado.', message.chatname, 'error');
      return { ok: false, response, error: 'Spotify no está conectado.', ...interpretationDetails };
    }
    if (this.inFlight && !options.force) {
      const response = await respond('busy', { nombre: message.chatname }, 'Ya estoy procesando un pedido musical. Espera un momento.', message.chatname, 'thinking', true);
      return { ok: false, response, busy: true, ...interpretationDetails };
    }
    const requester = String(message.chatname || '');
    const userKey = String(message.userid || requester).toLowerCase();
    const simulationCooldownState = options.isolatedLiveSimulation === true
      ? this.getLiveSimulationCooldownState(options.simulationKey, options.timeScale)
      : null;
    const now = simulationCooldownState ? simulationCooldownState.virtualNow : Date.now();
    if (simulationCooldownState) {
      const userCooldownMs = Math.max(0, Number(settings.userCooldownSeconds) * 1000 || 0);
      for (const [key, requestedAt] of simulationCooldownState.userRequestAt) {
        if (now - Number(requestedAt || 0) >= userCooldownMs) simulationCooldownState.userRequestAt.delete(key);
      }
    }
    const lastGlobalRequestAt = simulationCooldownState ? simulationCooldownState.lastGlobalRequestAt : this.lastGlobalRequestAt;
    const lastUserRequestAt = simulationCooldownState
      ? (simulationCooldownState.userRequestAt.get(userKey) || 0)
      : (this.userRequestAt.get(userKey) || 0);
    // Test mode normally disables cooldowns. A historical live replay keeps
    // the production limits in its own per-program memory state instead.
    const shouldEnforceCooldowns = options.isolatedLiveSimulation === true
      || (!options.skipCooldown && !options.analysis && !settings.testMode);
    if (shouldEnforceCooldowns) {
      const globalWait = Number(settings.cooldownSeconds) * 1000 - (now - lastGlobalRequestAt);
      if (globalWait > 0) {
        const seconds = Math.ceil(globalWait / 1000);
        const response = await respond('waitGlobal', { nombre: requester.split(/\s+/)[0], segundos: seconds }, `Espera ${seconds}s para pedir otro tema.`, requester);
        return { ok: false, cooldown: true, response, ...interpretationDetails };
      }
      const userWait = Number(settings.userCooldownSeconds) * 1000 - (now - lastUserRequestAt);
      if (userWait > 0) {
        const seconds = Math.ceil(userWait / 1000);
        const response = await respond('waitUser', { nombre: requester.split(/\s+/)[0], segundos: seconds }, `${requester.split(/\s+/)[0]}, ya pediste un tema hace poco. Espera ${seconds}s.`, requester);
        return { ok: false, cooldown: true, userCooldown: true, response, ...interpretationDetails };
      }
    }
    this.inFlight = true;
    try {
      await respond('searching', { busqueda: parsed.query, genero: parsed.query }, `Buscando "${parsed.query}" en Spotify...`, requester, 'thinking', true);
      let tracks;
      let requestedTrack = null;
      try {
        if (options.trackUri) requestedTrack = await this.trackByUri(options.trackUri);
        tracks = requestedTrack ? [requestedTrack] : await this.searchWithVariants(parsed, await this.getAliases(), vocabulary, settings, {
          allowAliasLearning: options.allowAliasLearning !== false
        });
      }
      catch (error) {
        const response = await respond(error.status === 429 ? 'throttled' : 'sinRespuesta', { pedido: parsed.query, busqueda: parsed.query, nombre: requester.split(/\s+/)[0], segundos: error.retryAfter || 30 }, error.message, requester, 'error');
        return { ok: false, error: error.message, response, ...interpretationDetails };
      }
      const track = this.chooseTrack(tracks, parsed, settings, { updateSelectionState: options.updateSelectionState !== false });
      if (!track) {
        const response = await respond('notFound', { pedido: parsed.query, busqueda: parsed.query, nombre: requester.split(/\s+/)[0] }, `No encontré "${parsed.query}" en Spotify.`, requester, 'error');
        if (!options.suppressLog) await this.options.logRequest({ traceId, source: message.type, platform: message.platform, requester, requesterId: message.userid, query: parsed.query, comment: text, result: 'not_found', status: 'notfound', isRequest: true, message: response, ok: false, timestamp: Date.now(), ...interpretationDetails, ...replyDetails, replyText: response });
        return { ok: false, notFound: true, response, ...interpretationDetails };
      }
      if (options.analysis) {
        const artists = track.artists.map(a => a.name).join(', ');
        const response = await respond('analysis', { tema: track.name, artista: artists }, `Encontré: ${track.name} - ${artists} (no reproduje)`, requester);
        return { ok: true, analysis: true, track, response, ...interpretationDetails };
      }
      const devices = await this.devices();
      const device = this.chooseDevice(devices, settings.deviceTargetName);
      if (!device) {
        const context = settings.deviceTargetName ? 'noDeviceConfigured' : 'noDevice';
        const fallback = settings.deviceTargetName
          ? `No encuentro el dispositivo configurado "${settings.deviceTargetName}". Envia !spotifydevices para ver los nombres disponibles.`
          : 'No veo dispositivos de Spotify. Abre Spotify y reproduce algo una vez.';
        const response = await respond(context, { dispositivo: settings.deviceTargetName }, fallback, requester, 'error');
        return { ok: false, noDevice: true, response, ...interpretationDetails };
      }
      await this.play(track, device, settings, options);
      if (simulationCooldownState) {
        simulationCooldownState.lastGlobalRequestAt = now;
        simulationCooldownState.userRequestAt.set(userKey, now);
        simulationCooldownState.updatedAt = Date.now();
      } else if (message.type !== 'auto' && !options.explicitTestPlayback) {
        this.lastGlobalRequestAt = now;
        this.userRequestAt.set(userKey, now);
      }
      const first = requester.trim().split(/\s+/)[0] || requester;
      const artists = track.artists.map(a => a.name).join(', ');
      const response = await respond('ok', { nombre: first, tema: track.name, artista: artists }, `Listo ${first}, ya se está reproduciendo: ${track.name} - ${artists}`, requester, 'success', false, isolatedPlayback, interpretationDetails.interpretationSource);
      if (!options.suppressLog) await this.options.logRequest({ traceId, source: message.type, platform: message.platform, requester, requesterId: message.userid, query: parsed.query, comment: text, track: { name: track.name, artist: artists, uri: track.uri }, device: device.name, result: 'played', status: 'played', isRequest: true, message: response, ok: true, timestamp: Date.now(), ...interpretationDetails, ...replyDetails, replyText: response });
      await this.publishPlaybackState(true);
      return {
        ok: true, track, device: device.name, response, ...interpretationDetails,
        ...(isolatedPlayback ? { ruloNotified: this.lastIsolatedTestReplySent === true } : {})
      };
    } catch (error) {
      const response = await respond('playbackError', { nombre: requester.split(/\s+/)[0], tema: parsed.query }, error.message || 'No pude cambiar el tema.', requester, 'error');
      if (!options.suppressLog) await this.options.logRequest({ traceId, source: message.type, platform: message.platform, requester, requesterId: message.userid, query: parsed.query, comment: text, result: 'error', status: 'error', isRequest: true, error: error.message, message: response, ok: false, timestamp: Date.now(), ...interpretationDetails, ...replyDetails, replyText: response });
      return { ok: false, error: error.message, response, ...interpretationDetails };
    } finally {
      this.inFlight = false;
    }
  }

  async publishPlaybackState(force = false) {
    if (!this.isConnected()) return;
    if (!force && Date.now() - this.lastPublishAt < 4000) return;
    this.lastPublishAt = Date.now();
    try {
      const { body } = await this.api('/me/player');
      const item = body?.item;
      const track = item ? {
        name: item.name || '',
        artist: (item.artists || []).map(artist => artist.name).join(', '),
        album: item.album?.name || '',
        imageUrl: item.album?.images?.[0]?.url || '',
        uri: item.uri || '',
        duration: Number(item.duration_ms) || 0
      } : null;
      const payload = {
        track,
        status: body ? (body.is_playing ? 'playing' : 'paused') : 'inactive',
        isPlaying: body?.is_playing === true,
        progressMs: Number(body?.progress_ms) || 0,
        durationMs: Number(item?.duration_ms) || 0,
        receivedAt: Date.now(),
        device: body?.device?.name || ''
      };
      const signature = JSON.stringify([track?.uri, payload.status, Math.floor(payload.progressMs / 5000), payload.device]);
      if (force || signature !== this.lastOverlaySignature) {
        this.lastOverlaySignature = signature;
        const base = this.options.getCortexBaseUrl();
        await fetch(`${base}/api/spotify-overlay`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        }).catch(() => {});
      }
      const settings = await this.getSettings();
      if ((settings.skipEnabled || this.trackEndAt > 0) && body?.is_playing && item?.uri && item.uri !== this.lastSkippedUri) {
        const leftMs = Number(item.duration_ms) - Number(body.progress_ms || 0);
        const threshold = Math.max(1, Number(settings.skipSeconds) || 10) * 1000;
        const customEndReached = this.trackEndAt > 0 && Number(body.progress_ms || 0) >= this.trackEndAt * 1000;
        const configuredSkipReached = settings.skipEnabled && leftMs > 0 && leftMs <= threshold;
        if ((customEndReached || configuredSkipReached) && this.lastTrackUri === item.uri) {
          this.lastSkippedUri = item.uri;
          await this.api('/me/player/next', { method: 'POST' });
        }
      }
    } catch (error) {
      if (error.status === 401) this.token = this.readToken();
    }
  }
}

module.exports = SpotifyBot;
