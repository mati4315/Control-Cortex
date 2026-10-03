// Pruebas de la logica del modulo spotify-auto-music.js (v19) con jsdom:
// ajustes en vivo del dashboard, modo prueba sin esperas, parser y comandos remotos.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const MODULE_PATH = 'D:/plugins para mi OBS/Control Cortex/integrations/spotify-auto-music/spotify-auto-music.js';
const MODULE_SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');
const DECLARED_VERSION = Number((/const MODULE_VERSION = (\d+)/.exec(MODULE_SOURCE) || [0, 0])[1]);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

const TRACK = {
  id: 't1',
  uri: 'spotify:track:t1',
  name: 'Yo Tomo Licor',
  duration_ms: 200000,
  artists: [{ name: 'Amar Azul' }],
  album: { name: 'Album', images: [] }
};
const CONTINUATION = { id: 'c1', uri: 'spotify:track:c1', name: 'Continuacion', duration_ms: 180000, artists: [{ name: 'Otra' }] };
const DEVICE = { id: 'd1', name: 'NOTEBOOK-MATI', type: 'Computer', is_active: true, is_restricted: false, volume_percent: 70 };

const REMOTE_DEFAULTS = {
  enabled: true,
  testMode: false,
  cooldownSeconds: 0,
  userCooldownSeconds: 0,
  minTextLength: 8,
  requireCommand: false,
  personalize: true,
  announce: true,
  autoContinue: true,
  skipEnabled: false,
  skipSeconds: 10,
  pollSeconds: 4,
  deviceTargetName: 'NOTEBOOK-MATI'
};

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function emptyResponse(status) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve({}) });
}

function loadModule(options) {
  const opts = options || {};
  const state = {
    settings: { ...REMOTE_DEFAULTS, ...(opts.remote || {}) },
    pendingCommand: opts.command || null,
    extraCommands: [],
    lastPlayedUri: null,
    lastPlayBody: null,
    lastPlayAt: 0,
    playerActions: [],
    volume: options?.initialVolume ?? 70,
    audibleStarts: [],
    seeks: [],
    speechStartRequestedAt: 0,
    plays: [],
    speechStarts: [],
    cortexCalls: [],
    skipCalls: 0,
    aliases: opts.aliases || null,
    vocabulary: opts.vocabulary || null,
    aiInterpretation: opts.aiInterpretation || null,
    lastSearch: [],
    artistSearches: [],
    lastLimits: [],
    lastOffsets: [],
    lastTrackById: [],
    nextCalls: 0,
    queue: (opts.initialQueue || []).slice(),
    claimedCommands: new Set(),
    player: opts.initialPlayer ? JSON.parse(JSON.stringify(opts.initialPlayer)) : null,
    currentTrack: null
  };

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1:4000/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (opts.timeScale) {
    const epoch = Date.now();
    window.Date.now = () => epoch + (Date.now() - epoch) * opts.timeScale;
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => schedule(callback, ms / opts.timeScale, ...args);
  }
  window.CORTEX_BASE_URL = 'http://127.0.0.1:4000';
  window.console.debug = () => {};
  // WebSocket simulado: nunca se conecta de verdad (podria tocar el backend vivo).
  const sockets = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
    send(data) { this.sent = (this.sent || []).concat([data]); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
    open() { this.readyState = 1; if (this.onopen) this.onopen(); }
    message(payload) { if (this.onmessage) this.onmessage({ data: JSON.stringify(payload) }); }
  }
  window.WebSocket = FakeWebSocket;

  window.fetch = (url, fetchOptions) => {
    const target = String(url);
    const config = fetchOptions || {};
    let body = null;
    try { body = config.body ? JSON.parse(config.body) : null; } catch (error) { body = null; }

    if (target.indexOf('/api/spotify-client-state') !== -1) {
      // El backend entrega la cola completa en una sola consulta.
      const batch = [];
      if (state.pendingCommand) { batch.push(state.pendingCommand); state.pendingCommand = null; }
      while (state.extraCommands.length) batch.push(state.extraCommands.shift());
      state.cortexCalls.push({ url: target, body: null });
      const payload = { ok: true, settings: state.settings, command: batch[0] || null, commands: batch, sessionId: 'S1', serverTime: Date.now() };
      if (state.aliases) payload.aliases = state.aliases;
      if (state.vocabulary) payload.vocabulary = state.vocabulary;
      return jsonResponse(payload);
    }
    if (target.indexOf('/api/spotify-device-target') !== -1) {
      return jsonResponse({ deviceName: state.settings.deviceTargetName });
    }
    if (target.indexOf('/api/spotify-command-claim') !== -1) {
      const id = String(body && body.id || '');
      const claimed = !state.claimedCommands.has(id);
      state.claimedCommands.add(id);
      return jsonResponse({ ok: true, claimed });
    }
    if (target.indexOf('/api/spotify-playback-offset') !== -1) {
      return jsonResponse({ enabled: state.settings.skipEnabled, seconds: state.settings.skipSeconds });
    }
    if (target.indexOf('/api/spotify-ai-interpret') !== -1) {
      state.cortexCalls.push({ url: target, body });
      if (!state.aiInterpretation) return jsonResponse({ ok: false, error: 'La IA esta desactivada.' });
      return jsonResponse({ ok: true, interpretation: state.aiInterpretation });
    }
    if (target.indexOf('/api/rulo-speech-start') !== -1) {
      state.speechStartRequestedAt = Date.now();
      state.speechStarts.push(window.Date.now());
      state.cortexCalls.push({ url: target, body });
      if (opts.onSpeechStart) return opts.onSpeechStart(state);
      return new Promise(resolve => setTimeout(() => resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ success: true, started: true, triggerId: 'sync-trigger', delayMs: opts.speechDelayMs || 0 })
      }), opts.speechStartWaitMs || 0));
    }
    if (target.indexOf('http://127.0.0.1:4000/') === 0) {
      state.cortexCalls.push({ url: target, body });
      return jsonResponse({ ok: true, success: true });
    }

    // --- Spotify Web API simulada ---
    if (target.includes('/me/player/volume')) {
      const volume = Number(new URL(target).searchParams.get('volume_percent'));
      state.playerActions.push('volume:' + volume);
      if (opts.muteFails && volume === 0) return emptyResponse(403);
      if (volume > 0 && opts.restoreFailsOnce && !state.restoreRetried) {
        state.restoreRetried = true;
        return emptyResponse(500);
      }
      state.volume = volume;
      if (state.player) state.player.device.volume_percent = volume;
      if (volume > 0 && state.player?.is_playing) state.audibleStarts.push({ uri: state.player.item.uri, position: state.player.progress_ms });
      return emptyResponse(204);
    }
    if (target.indexOf('/v1/search') !== -1 && target.indexOf('type=artist') !== -1) {
      const q = decodeURIComponent((target.split('q=')[1] || '').split('&')[0]);
      state.artistSearches.push(q);
      if (opts.artistStatus) {
        return Promise.resolve({ ok: false, status: opts.artistStatus, headers: { get: () => null }, json: () => Promise.resolve({ error: { status: opts.artistStatus } }) });
      }
      const artistas = opts.artists === undefined ? [{ id: 'a1', name: 'El Polaco' }] : opts.artists;
      return jsonResponse({ artists: { items: artistas } });
    }
    if (target.indexOf('/v1/search') !== -1) {
      const q = decodeURIComponent((target.split('q=')[1] || '').split('&')[0]);
      const limite = Number((target.split('limit=')[1] || '3').split('&')[0]) || 3;
      state.lastSearch.push(q);
      state.lastLimits.push(limite);
      const offset = Number(new URL(target).searchParams.get('offset') || 0);
      state.lastOffsets.push(offset);
      if (limite > 10) return emptyResponse(400);
      // Una app colgada: la respuesta nunca llega (o llega tarde). Con hangSegundos
      // se simula eso mismo, respetando la senal de cancelacion del modulo.
      if (opts.hangSegundos) {
        return new Promise((resolve, reject) => {
          const reloj = setTimeout(() => resolve(jsonResponse({ tracks: { items: [TRACK] } })), opts.hangSegundos * 1000);
          const senal = config.signal;
          if (senal) {
            if (senal.aborted) { clearTimeout(reloj); reject(Object.assign(new Error('abortado'), { name: 'AbortError' })); return; }
            senal.addEventListener('abort', () => { clearTimeout(reloj); reject(Object.assign(new Error('abortado'), { name: 'AbortError' })); });
          }
        });
      }
      // Spotify puede frenar las consultas (429). Con search429Primero solo la
      // primera respuesta se frena: sirve para ver que despues se recupera.
      if (opts.searchStatus && !(opts.search429Primero && state.frenazos)) {
        state.frenazos = (state.frenazos || 0) + 1;
        const status = opts.searchStatus;
        return Promise.resolve({
          ok: false,
          status,
          headers: { get: nombre => (String(nombre).toLowerCase() === 'retry-after' ? String(opts.retryAfter || 5) : null) },
          json: () => Promise.resolve({ error: { status, message: 'Too many requests' } })
        });
      }
      const resolver = opts.search;
      const found = typeof resolver === 'function' ? resolver(q) : TRACK;
      // El resolver puede devolver un tema, una lista de temas o nada.
      const all = Array.isArray(found) ? found : (found ? [found] : []);
      const items = all.slice(offset, offset + limite);
      return jsonResponse({ tracks: { items, next: offset + limite < all.length ? 'next-page' : null } });
    }
    if (target.indexOf('/v1/artists/') !== -1 && target.indexOf('/top-tracks') !== -1) {
      state.topTracksCalls = (state.topTracksCalls || 0) + 1;
      if (opts.topTracksStatus) {
        return Promise.resolve({ ok: false, status: opts.topTracksStatus, headers: { get: () => null }, json: () => Promise.resolve({ error: { status: opts.topTracksStatus } }) });
      }
      return jsonResponse({ tracks: opts.topTracks || [] });
    }
    if (target.indexOf('/me/player/devices') !== -1) {
      const dispositivo = opts.deviceActive === false ? Object.assign({}, DEVICE, { is_active: false }) : DEVICE;
      return jsonResponse({ devices: [{ ...dispositivo, volume_percent: state.volume }] });
    }
    // Traspaso de reproduccion (PUT /me/player sin /play): el modulo lo usa para
    // "despertar" el dispositivo cuando quedo inactivo.
    if (target.indexOf('/me/player') !== -1 && (config.method || '').toUpperCase() === 'PUT' && target.indexOf('/player/play') === -1 && target.indexOf('/pause') === -1 && target.indexOf('/seek') === -1) {
      state.transfers = (state.transfers || 0) + 1;
      state.transferBodies = state.transferBodies || [];
      state.transferBodies.push(body);
      if (opts.transferStatus) {
        return Promise.resolve({ ok: false, status: opts.transferStatus, headers: { get: () => null }, json: () => Promise.resolve({ error: { status: opts.transferStatus } }) });
      }
      return emptyResponse(204);
    }
    if (target.indexOf('/v1/tracks/') !== -1) {
      const id = decodeURIComponent(target.split('/v1/tracks/')[1].split('?')[0]);
      state.lastTrackById.push(id);
      const encontrado = (opts.tracks || {})[id];
      return encontrado ? jsonResponse(encontrado) : emptyResponse(404);
    }
    if (target.indexOf('/me/player/pause') !== -1) {
      state.pauseCalls = (state.pauseCalls || 0) + 1;
      state.pauseUrls = state.pauseUrls || [];
      state.pauseUrls.push(target);
      const conDispositivo = target.indexOf('device_id=') !== -1;
      const conEstado = opts.pauseStatus && (!opts.pauseStatusSoloSinDispositivo || !conDispositivo);
      if (conEstado) {
        const status = opts.pauseStatus;
        return Promise.resolve({
          ok: false,
          status,
          headers: { get: () => null },
          json: () => Promise.resolve({ error: { status, message: 'Player command failed: ' + (status === 403 ? 'Restriction violated' : 'No active device found'), reason: 'UNKNOWN' } })
        });
      }
      if (state.player) state.player.is_playing = false;
      return emptyResponse(204);
    }
    if (target.indexOf('/me/player/play') !== -1) {
      state.playerActions.push('play');
      if (opts.playStatus) {
        const mensaje = opts.playStatus === 403 ? 'Player command failed: Restriction violated' : 'Player command failed';
        return Promise.resolve({ ok: false, status: opts.playStatus, headers: { get: () => null }, json: () => Promise.resolve({ error: { status: opts.playStatus, message: mensaje, reason: 'UNKNOWN' } }) });
      }
      if (!opts.ignoreDirectPlay) state.lastPlayedUri = (body && Array.isArray(body.uris) && body.uris[0]) || TRACK.uri;
      state.lastPlayBody = body;
      state.lastPlayAt = Date.now();
      state.plays.push({ uri: state.lastPlayedUri, at: window.Date.now() });
      return emptyResponse(204);
    }
    if (target.indexOf('/me/player/queue') !== -1) {
      if ((config.method || 'GET').toUpperCase() === 'POST') {
        state.playerActions.push('queue');
        if (opts.queueStatus) return Promise.resolve({ ok: false, status: opts.queueStatus, headers: { get: () => null }, json: () => Promise.resolve({ error: { status: opts.queueStatus, message: 'Queue command failed' } }) });
        state.queue.unshift(decodeURIComponent((target.split('uri=')[1] || '').split('&')[0]));
        return emptyResponse(204);
      }
      return jsonResponse({ queue: state.queue.map(uri => ({ uri })) });
    }
    if (target.indexOf('/me/player/seek') !== -1) {
      state.seeks.push(target);
      state.playerActions.push('seek');
      if (opts.seekFails) return emptyResponse(403);
      const position = Number(new URL(target).searchParams.get('position_ms'));
      if (state.player && !opts.seekIgnored) {
        if (opts.seekDelayReads) state.pendingSeek = { position, reads: opts.seekDelayReads };
        else state.player.progress_ms = position;
      }
      return emptyResponse(204);
    }
    if (target.indexOf('/me/player/next') !== -1) {
      state.playerActions.push('next');
      state.nextCalls += 1;
      if (opts.queueWorks !== false && state.queue.length) {
        const uri = state.queue.shift();
        state.lastPlayedUri = uri;
        state.lastPlayAt = Date.now();
        state.plays.push({ uri, at: window.Date.now() });
        state.player = { ...(state.player || {}), is_playing: true, progress_ms: 0, item: { uri, name: TRACK.name }, device: { ...DEVICE, volume_percent: state.volume } };
        if (state.volume > 0) state.audibleStarts.push({ uri, position: 0 });
      }
      return emptyResponse(204);
    }
    if (target.indexOf('/recommendations') !== -1) return jsonResponse({ tracks: [CONTINUATION] });
    if (target.indexOf('/me/player') !== -1) {
      if (state.pendingSeek && --state.pendingSeek.reads <= 0) {
        state.player.progress_ms = state.pendingSeek.position;
        state.pendingSeek = null;
      }
      if (state.player) return jsonResponse(state.player);     // estado a medida para las pruebas
      return jsonResponse({
        is_playing: true,
        progress_ms: 12000,
        item: { uri: state.lastPlayedUri || 'spotify:track:anterior' },
        device: { id: DEVICE.id }
      });
    }
    return emptyResponse(404);
  };

  class FakeSpotifyIntegration {
    constructor() {
      this.settings = {};
      this.accessToken = 'fake-token';
      this.callbacks = { onTrackUpdate: () => {} };
    }
    async initialize() { return true; }
    async handleCommand() { return null; }
    async getCurrentTrack() { return state.currentTrack || null; }
    async skip() { state.skipCalls += 1; return opts.onSkip ? opts.onSkip(state) : { success: true }; }
    async previous() { state.previousCalls = (state.previousCalls || 0) + 1; return opts.onPrevious ? opts.onPrevious(state) : { success: true }; }
    async pause() { return { success: true }; }
    async resume() { return { success: true }; }
  }
  window.SpotifyIntegration = FakeSpotifyIntegration;
  window.eval(MODULE_SOURCE);

  const integration = new window.SpotifyIntegration();
  return { dom, window, integration, state, sockets };
}

function cortexCall(state, fragment) {
  return state.cortexCalls.filter(call => call.url.indexOf(fragment) !== -1);
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeoutMs, stepMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return Date.now() - start;
    await wait(stepMs || 100);
  }
  return -1;
}

module.exports = { loadModule, TRACK, cortexCall, wait, waitFor, jsonResponse };
if (require.main === module) (async () => {
  // ---------- A) parser y limites del dashboard ----------
  {
    const { dom, integration, state } = loadModule({ remote: { cooldownSeconds: 40, userCooldownSeconds: 120 } });
    check('modulo: version declarada expuesta', integration.__cortexModuleVersion === DECLARED_VERSION, integration.__cortexModuleVersion + ' vs ' + DECLARED_VERSION);

    const parsed = integration.parseAutoMusicRequest('quiero escuchar Ke Personajes');
    check('parser: artista por lenguaje natural', parsed && parsed.query === 'ke personajes' && parsed.source === 'natural', JSON.stringify(parsed));
    const byArtist = integration.parseAutoMusicRequest('quiero un tema de Damas Gratis');
    check('parser: artista explicito', byArtist && byArtist.query === 'artist:damas gratis', JSON.stringify(byArtist));

    const command = integration.parseAutoMusicRequest('!tema Damas Gratis');
    check('parser: comando', command && command.query === 'damas gratis' && command.source === 'command', JSON.stringify(command));

    await integration.syncSpotifySettings();
    check('sync: ajustes del dashboard cargados', integration.getCortexSpotifySettings() && integration.getCortexSpotifySettings().deviceTargetName === 'NOTEBOOK-MATI', JSON.stringify(integration.getCortexSpotifySettings()));
    const limites = integration.describeAutoMusicLimits();
    check('sync: limites efectivos por defecto', limites.minTextLength === 8 && limites.requireCommand === false, JSON.stringify({ minTextLength: limites.minTextLength, requireCommand: limites.requireCommand }));
    check('sync: el vocabulario viaja con los limites', !!(limites.vocab && limites.vocab.musicWords && limites.regexes), JSON.stringify(Object.keys(limites)));

    // El dashboard sube el largo minimo a 40: una frase corta deja de leerse.
    state.settings = { ...state.settings, minTextLength: 40 };
    await integration.syncSpotifySettings();
    check('limites: frase corta ignorada con minTextLength 40', integration.parseAutoMusicRequest('poneme un tema de Amar Azul', integration.describeAutoMusicLimits()) === null, 'debia ser null');
    check('limites: handleCommand tambien ignora la frase corta', await integration.handleCommand('poneme un tema de Amar Azul', { chatname: 'Mati' }) === null, 'debia ser null');
    check('limites: el comando sigue funcionando', !!integration.parseAutoMusicRequest('!tema Amar Azul'), 'comando');

    state.settings = { ...state.settings, minTextLength: 8, requireCommand: true };
    await integration.syncSpotifySettings();
    check('limites: solo comandos ignora lenguaje natural', await integration.handleCommand('poneme un tema de Amar Azul', { chatname: 'Mati' }) === null, 'debia ser null');
    check('limites: solo comandos acepta !playnow', !!integration.parseAutoMusicRequest('!playnow Amar Azul'), 'comando');
    dom.window.close();
  }

  // ---------- B) esperas normales, modo prueba y registro ----------
  {
    const { dom, integration, state } = loadModule({ timeScale: 1000, remote: { cooldownSeconds: 40, userCooldownSeconds: 120 } });
    await integration.syncSpotifySettings();

    const first = await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati', type: 'youtube' });
    check('chat: primer pedido se reproduce', /Yo Tomo Licor/.test(String(first)), first);

    // El mock de busqueda devuelve siempre el mismo tema; simula que entre pedidos
    // hubo otra pista para comprobar la espera, no el guard de reintento duplicado.
    state.player.item.uri = 'spotify:track:anterior';
    const second = await integration.handleCommand('!tema Damas Gratis', { chatname: 'Mati', type: 'youtube' });
    check('chat: segundo pedido se reproduce respetando ambas esperas', /Yo Tomo Licor/.test(String(second)) && state.plays[1].at - state.plays[0].at >= 120000, second);

    const log = cortexCall(state, '/api/spotify-request-log').map(call => call.body);
    check('registro: pedido exitoso reportado', log.some(entry => entry.ok === true && /Yo Tomo Licor/.test(entry.message)), JSON.stringify(log[0]));
    check('registro: el pedido que espero tambien se reporta', log.filter(entry => entry.ok === true && entry.source === 'chat').length === 2, log.length);
    check('registro: source chat', log[0] && log[0].source === 'chat', JSON.stringify(log[0] && log[0].source));
    check('registro: guarda el tema elegido', log[0] && log[0].track && log[0].track.name === 'Yo Tomo Licor', JSON.stringify(log[0] && log[0].track));

    const devicesReport = cortexCall(state, '/api/spotify-devices-report');
    check('dispositivos: la extension reporta la lista', devicesReport.length > 0 && devicesReport[0].body.devices[0].name === 'NOTEBOOK-MATI', JSON.stringify(devicesReport[0] && devicesReport[0].body));

    // Modo prueba encendido desde el dashboard: sin esperas.
    state.settings = { ...state.settings, testMode: true };
    await integration.syncSpotifySettings();
    state.player.item.uri = 'spotify:track:anterior';
    const third = await integration.handleCommand('!tema Damas Gratis', { chatname: 'Mati', type: 'youtube' });
    check('modo prueba: el mismo usuario pide de nuevo sin esperar', /Yo Tomo Licor/.test(String(third)), third);

    // Espera en 0 tambien desactiva la espera, sin tocar el modo prueba.
    state.settings = { ...state.settings, testMode: false, cooldownSeconds: 0, userCooldownSeconds: 0 };
    await integration.syncSpotifySettings();
    const fourth = await integration.handleCommand('!tema Damas Gratis', { chatname: 'Mati', type: 'youtube' });
    check('espera en 0: no bloquea', /Yo Tomo Licor/.test(String(fourth)), fourth);
    dom.window.close();
  }

  // ---------- C) modo prueba apagado del dashboard, personalizacion y salto ----------
  {
    const { dom, integration, state } = loadModule({ speechDelayMs: 80 });
    await integration.syncSpotifySettings();
    await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati', type: 'youtube' });
    const speech = cortexCall(state, '/api/rulo-speech-start');
    const finalReply = cortexCall(state, '/api/rulo-bot-message').find(call => call.body && !call.body.provisional);
    check('sincronizacion: espera el retraso antes de cambiar la musica', state.lastPlayAt - state.speechStartRequestedAt >= 70, `${state.lastPlayAt - state.speechStartRequestedAt} ms`);
    check('sincronizacion: reutiliza el inicio de Habla para el cartel', speech.length === 1 && finalReply && finalReply.body.triggerId === 'sync-trigger' && finalReply.body.animationStarted === true, JSON.stringify(finalReply && finalReply.body));
    dom.window.close();
  }

  {
    const { dom, integration, state } = loadModule({ speechStartWaitMs: 100, speechDelayMs: 50, search: query => /damas/i.test(query) ? CONTINUATION : TRACK });
    await integration.syncSpotifySettings();
    state.player = { is_playing: true, progress_ms: 1000, item: { uri: 'spotify:track:anterior' }, device: DEVICE };
    const firstPromise = integration.handleCommand('!tema Amar Azul', { chatname: 'Usuario 1', type: 'youtube' });
    await waitFor(() => state.speechStartRequestedAt, 500, 5);
    const secondPromise = integration.handleCommand('!tema Damas Gratis', { chatname: 'Usuario 2', type: 'youtube' });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const finalReplies = cortexCall(state, '/api/rulo-bot-message').filter(call => call.body && !call.body.provisional);
    check('concurrencia: el primer pedido termina de cambiar la musica', /reproduciendo:/i.test(String(first)) && state.plays[0]?.uri === TRACK.uri, String(first));
    check('concurrencia: el segundo se reproduce despues del primero', /Continuacion/.test(String(second)) && state.plays.length === 2 && state.lastPlayedUri === CONTINUATION.uri, String(second));
    check('concurrencia: cada pedido tiene su propia animacion', cortexCall(state, '/api/rulo-speech-start').length === 2 && finalReplies.length === 2, JSON.stringify(finalReplies.map(call => call.body.message)));
    dom.window.close();
  }

  // ---------- C) modo prueba apagado del dashboard, personalizacion y salto ----------
  {
    const { dom, integration, state } = loadModule({ remote: { personalize: true, announce: true, skipEnabled: true, skipSeconds: 10 } });
    await integration.syncSpotifySettings();
    await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati Perez', type: 'tiktok' });
    const announced = cortexCall(state, '/api/rulo-bot-message').map(call => call.body.message);
    check('overlay: aviso thinking enviado', announced.some(message => /Buscando/.test(message)), JSON.stringify(announced));
    check('overlay: respuesta personalizada', announced.some(message => /^Listo Mati,/.test(message)), JSON.stringify(announced));
    check('salto: adelanta al segundo 10 despues de encolar', state.seeks.some(url => url.includes('position_ms=10000')), JSON.stringify(state.seeks));
    dom.window.close();
  }

  {
    const { dom, integration, state } = loadModule({ remote: { announce: false, personalize: false } });
    await integration.syncSpotifySettings();
    const response = await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati', type: 'tiktok' });
    const overlayCalls = cortexCall(state, '/api/rulo-bot-message').length;
    check('overlay: avisos apagados no mandan nada', overlayCalls === 0, `${overlayCalls} mensajes`);
    check('personalizar: apagado devuelve el texto plano', String(response).indexOf('Reproduciendo:') === 0, response);
    dom.window.close();
  }

  // ---------- D) comandos del dashboard ----------
  {
    const { dom, integration, state } = loadModule({});
    await integration.syncSpotifySettings();

    const play = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Dashboard' });
    check('dashboard: prueba manual reproduce', play && play.success === true, JSON.stringify(play));
    const dashboardLog = cortexCall(state, '/api/spotify-request-log').map(call => call.body);
    check('dashboard: la prueba queda en el registro', dashboardLog.some(entry => entry.source === 'dashboard' && entry.ok === true), JSON.stringify(dashboardLog));

    const chatAfter = await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati', type: 'youtube' });
    check('dashboard: con espera cero el chat puede continuar', /Yo Tomo Licor/.test(String(chatAfter)), chatAfter);

    state.skipCalls = 0;
    await integration.runDashboardSpotifyCommand({ type: 'next' });
    check('dashboard: transporte siguiente llega a Spotify', state.skipCalls === 1, state.skipCalls);
    const transportLog = cortexCall(state, '/api/spotify-request-log').map(call => call.body);
    check('dashboard: el transporte queda registrado', transportLog.some(entry => entry.query === 'transporte:next'), 'falta transporte:next');

    const notMusic = await integration.runDashboardSpotifyCommand({ type: 'simulate', comment: 'buenas a todos como andan hoy', requester: 'Prueba' });
    check('dashboard: comentario sin pedido avisa y no reproduce', notMusic.success === false && /no se leyo como pedido/.test(notMusic.message), JSON.stringify(notMusic));

    const simulated = await integration.runDashboardSpotifyCommand({ type: 'simulate', comment: 'poneme un tema de Amar Azul', requester: 'Prueba' });
    check('dashboard: comentario simulado reproduce', simulated && simulated.success === true, JSON.stringify(simulated));
    dom.window.close();
  }

  // ---------- E) el poll (arrancado en initialize) ejecuta el comando pendiente ----------
  {
    const { dom, integration, state } = loadModule({ command: { type: 'play', query: 'Damas Gratis', requester: 'Dashboard' } });
    await integration.initialize();
    await wait(3500);
    const log = cortexCall(state, '/api/spotify-request-log').map(call => call.body);
    check('poll: el comando pendiente se ejecuta solo', log.some(entry => entry.source === 'dashboard' && /Yo Tomo Licor/.test(entry.message)), JSON.stringify(log));
    const stateCalls = cortexCall(state, '/api/spotify-client-state');
    check('poll: consulta los ajustes al backend', stateCalls.length > 0, stateCalls.length);
    check('poll: se identifica con su version y token', new RegExp('version=' + DECLARED_VERSION).test(stateCalls[0].url) && /token=1/.test(stateCalls[0].url), stateCalls[0].url);
    dom.window.close();
  }

  // ---------- F) frecuencia de consulta configurable ----------
  {
    const fresh = loadModule({});
    check('frecuencia: 4s por defecto', fresh.integration.getCortexPollMs() === 4000, fresh.integration.getCortexPollMs());
    fresh.dom.window.close();
  }

  {
    const { dom, integration, state } = loadModule({ remote: { pollSeconds: 1 } });
    await integration.initialize();
    await wait(300);
    check('frecuencia: el dashboard la baja a 1s', integration.getCortexPollMs() === 1000, integration.getCortexPollMs());
    const logBefore = cortexCall(state, '/api/spotify-request-log').length;
    state.pendingCommand = { type: 'play', query: 'Damas Gratis', requester: 'Dashboard' };
    const elapsed = await waitFor(() => cortexCall(state, '/api/spotify-request-log').length > logBefore, 6000);
    check('frecuencia: el pedido encolado suena en ~2s (no en 4s+)', elapsed >= 0 && elapsed < 3500, elapsed + 'ms');
    dom.window.close();
  }

  // ---------- G) varios comandos en una sola consulta ----------
  {
    const { dom, integration, state } = loadModule({ remote: { pollSeconds: 1 } });
    await integration.initialize();
    await wait(300);
    const seenBefore = cortexCall(state, '/api/spotify-request-log').filter(call => call.body.query === '!spotifydevices').length;
    const t0 = Date.now();
    state.extraCommands.push({ type: 'devices', requester: 'Dashboard' }, { type: 'devices', requester: 'Dashboard' });
    const elapsed = await waitFor(() => cortexCall(state, '/api/spotify-request-log').filter(call => call.body.query === '!spotifydevices').length >= seenBefore + 2, 6000);
    const entries = cortexCall(state, '/api/spotify-request-log').map(call => call.body);
    const devicesEntries = entries.filter(entry => entry.query === '!spotifydevices');
    const stamps = cortexCall(state, '/api/spotify-request-log').map(call => call.body.query).map((q, i) => q === '!spotifydevices' ? i : -1).filter(i => i >= 0);
    check('lote: los dos comandos se ejecutan en la misma consulta', elapsed >= 0 && elapsed < 2500, elapsed + 'ms');
    check('lote: los dos quedan en el registro', devicesEntries.length >= 2, devicesEntries.length);
    check('lote: no esperan una consulta cada uno', stamps.length >= 2 && (stamps[1] - stamps[0]) <= 1, 'separacion ' + (stamps[1] - stamps[0]));
    dom.window.close();
  }

  // ---------- H) enlace instantaneo por WebSocket ----------
  {
    // Poll a 15 s a proposito: si el comando llega por WebSocket, no lo espera.
    const { dom, integration, state, sockets } = loadModule({ remote: { pollSeconds: 15 } });
    await integration.initialize();
    await wait(250);
    check('ws: se abre el enlace con el dashboard', sockets.length === 1 && new RegExp('/api/spotify-ws\\?version=' + DECLARED_VERSION + '$').test(sockets[0].url), JSON.stringify(sockets.map(socket => socket.url)));

    sockets[0].open();
    await wait(80);
    const before = cortexCall(state, '/api/spotify-request-log').length;
    sockets[0].message({ type: 'spotify_command', command: { type: 'devices', requester: 'Dashboard' } });
    const elapsed = await waitFor(() => cortexCall(state, '/api/spotify-request-log').length > before, 3000);
    check('ws: el comando suena al instante (no espera el poll de 15s)', elapsed >= 0 && elapsed < 1500, elapsed + 'ms');

    sockets[0].message({ type: 'spotify_settings', settings: { ...state.settings, cooldownSeconds: 7 } });
    await wait(80);
    check('ws: los ajustes llegan en vivo', integration.getCortexSpotifySettings().cooldownSeconds === 7, JSON.stringify(integration.getCortexSpotifySettings().cooldownSeconds));

    const nextBefore = cortexCall(state, '/api/spotify-request-log').length;
    sockets[0].message({ type: 'play', query: 'no es un comando valido' });
    sockets[0].message({ type: 'spotify_command', command: { type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Dashboard' } });
    const playElapsed = await waitFor(() => cortexCall(state, '/api/spotify-request-log').length > nextBefore, 4000);
    check('ws: la prueba de tema tambien es instantanea', playElapsed >= 0 && playElapsed < 2500, playElapsed + 'ms');

    // Si se cae el enlace, se reintenta y el poll queda de respaldo.
    sockets[0].close();
    await wait(150);
    check('ws: al caerse el enlace queda el poll como respaldo', integration.getCortexPollMs() === 15000, integration.getCortexPollMs());
    dom.window.close();
  }

  {
    const { dom, integration, state, sockets } = loadModule({ remote: { pollSeconds: 1 } });
    await integration.initialize();
    await wait(200);
    sockets[0].open();
    const command = { id: 'dashboard-una-vez', type: 'devices', requester: 'Dashboard' };
    state.extraCommands.push(command);
    sockets[0].message({ type: 'spotify_command', command });
    await wait(1500);
    const reports = cortexCall(state, '/api/spotify-request-log').filter(call => call.body.query === '!spotifydevices');
    check('ws+poll: un comando con id se ejecuta una sola vez', reports.length === 1, reports.length);
    check('ws+poll: el backend recibe el reclamo del comando', state.claimedCommands.has(command.id));
    dom.window.close();
  }

  // ---------- I) tolerancia a errores de escritura (los 6 ejemplos reales) ----------
  {
    const { dom, integration } = loadModule({});
    const casos = [
      ['Un tema de laberiso', 'artist:laberiso'],
      ['Un tema de gladis la bomba tucumana', 'artist:gladis la bomba tucumana'],
      ['Un tema de la beriso', 'artist:la beriso'],
      ['Hola matias un temita de los palmeras', 'artist:los palmeras'],
      ['Pasame a ke personajes', 'ke personajes'],
      ['Poneme algun reguetón', 'genre:reggaeton']
    ];
    casos.forEach(([comentario, esperado]) => {
      const parsed = integration.parseAutoMusicRequest(comentario, { minTextLength: 8, requireCommand: false });
      check(`escritura: "${comentario}"`, parsed && parsed.query === esperado, JSON.stringify(parsed));
    });

    check('escritura: "Hola, buenas! un temita de la beriso por favor"', (() => {
      const parsed = integration.parseAutoMusicRequest('Hola, buenas! un temita de la beriso por favor', { minTextLength: 8 });
      return parsed && parsed.query === 'artist:la beriso';
    })(), JSON.stringify(integration.parseAutoMusicRequest('Hola, buenas! un temita de la beriso por favor', { minTextLength: 8 })));
    check('escritura: "ponele un temazo de los palmeras"', (() => {
      const parsed = integration.parseAutoMusicRequest('ponele un temazo de los palmeras', { minTextLength: 8 });
      return parsed && parsed.query === 'artist:los palmeras';
    })(), JSON.stringify(integration.parseAutoMusicRequest('ponele un temazo de los palmeras', { minTextLength: 8 })));
    check('escritura: "pasale a damas gratis"', (() => {
      const parsed = integration.parseAutoMusicRequest('pasale a damas gratis', { minTextLength: 8 });
      return parsed && parsed.query === 'damas gratis';
    })(), JSON.stringify(integration.parseAutoMusicRequest('pasale a damas gratis', { minTextLength: 8 })));
    check('escritura: "poneme un tema de cumbia" sigue siendo genero', (() => {
      const parsed = integration.parseAutoMusicRequest('poneme un tema de cumbia', { minTextLength: 8 });
      return parsed && parsed.query === 'genre:cumbia';
    })(), JSON.stringify(integration.parseAutoMusicRequest('poneme un tema de cumbia', { minTextLength: 8 })));

    const variantesLaberiso = integration.describeAutoMusicVariants('laberiso');
    check('variantes: "laberiso" incluye "la beriso"', variantesLaberiso.indexOf('la beriso') !== -1, JSON.stringify(variantesLaberiso));
    const variantesGladis = integration.describeAutoMusicVariants('gladis');
    check('variantes: "gladis" incluye "gladys"', variantesGladis.indexOf('gladys') !== -1, JSON.stringify(variantesGladis));
    const variantesPalmeras = integration.describeAutoMusicVariants('los palmeras');
    check('variantes: "los palmeras" incluye "palmeras"', variantesPalmeras.indexOf('palmeras') !== -1, JSON.stringify(variantesPalmeras));
    dom.window.close();
  }

  // ---------- J) busqueda tolerante y correcciones aprendidas ----------
  {
    const { dom, integration, state } = loadModule({ search: q => (/^(?:artist:)?la beriso$/i.test(q) ? TRACK : null) });
    await integration.syncSpotifySettings();

    const play = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'laberiso', requester: 'Dashboard' });
    check('busqueda: encuentra el tema probando variantes', play && play.success === true, JSON.stringify(play));
    check('busqueda: primero intenta lo que escribio la persona', state.lastSearch[0] === 'laberiso', JSON.stringify(state.lastSearch));
    check('busqueda: despues prueba "la beriso"', state.lastSearch.indexOf('la beriso') !== -1, JSON.stringify(state.lastSearch));

    const saved = cortexCall(state, '/api/spotify-aliases').map(call => call.body);
    check('busqueda: la correccion se guarda en Cortex', saved.some(item => item.from === 'laberiso' && item.to === 'la beriso'), JSON.stringify(saved));
    check('busqueda: la correccion queda en memoria', integration.getSpotifyAliases().laberiso === 'la beriso', JSON.stringify(integration.getSpotifyAliases()));
    dom.window.close();
  }

  {
    // Con la correccion ya aprendida, el segundo intento es directo.
    const { dom, integration, state } = loadModule({
      search: q => (/^(?:artist:)?la beriso$/i.test(q) ? TRACK : null),
      aliases: { laberiso: 'la beriso' }
    });
    await integration.syncSpotifySettings();
    check('correcciones: llegan en el poll', integration.getSpotifyAliases().laberiso === 'la beriso', JSON.stringify(integration.getSpotifyAliases()));
    state.lastSearch.length = 0;
    await integration.runDashboardSpotifyCommand({ type: 'play', query: 'laberiso', requester: 'Dashboard' });
    check('correcciones: la aprendida se prueba enseguida', state.lastSearch[1] === 'la beriso', JSON.stringify(state.lastSearch));
    dom.window.close();
  }

  // ---------- K) buscar sin reproducir ----------
  {
    const { dom, integration, state } = loadModule({ search: q => (/^(?:artist:)?la beriso$/i.test(q) ? TRACK : null) });
    await integration.syncSpotifySettings();
    const found = await integration.runDashboardSpotifyCommand({ type: 'search', query: 'laberiso', requester: 'Dashboard' });
    check('buscar: encuentra la variante correcta', found && found.success === true && found.track.name === 'Yo Tomo Licor', JSON.stringify(found && found.message));
    check('buscar: no toca la reproduccion', state.lastPlayBody === null, JSON.stringify(state.lastPlayBody));
    const entry = cortexCall(state, '/api/spotify-request-log').map(call => call.body).pop();
    check('buscar: queda en el registro sin reproducir', entry && entry.ok === true && /no reproduje/.test(entry.message), JSON.stringify(entry && entry.message));

    const missing = await integration.runDashboardSpotifyCommand({ type: 'search', query: 'zzzzz qqqqq', requester: 'Dashboard' });
    check('buscar: avisa cuando no encuentra nada', missing && missing.success === false && /No encontre nada/.test(missing.message), JSON.stringify(missing && missing.message));
    dom.window.close();
  }

  // ---------- L) solo analizar (sin reproducir) ----------
  {
    const { dom, integration, state } = loadModule({});
    await integration.syncSpotifySettings();
    const casos = ['Un tema de laberiso', 'Hola matias un temita de los palmeras', 'Poneme algun reguetón', 'buenas buenas que tal'];
    for (const comment of casos) {
      await integration.runDashboardSpotifyCommand({ type: 'simulate', comment, requester: 'Prueba', parseOnly: true });
    }
    const entries = cortexCall(state, '/api/spotify-request-log').map(call => call.body);
    check('analisis: dice que entendio en cada caso', entries.filter(entry => /solo analisis/.test(entry.message)).length === 4, JSON.stringify(entries.map(entry => entry.message)));
    check('analisis: reconoce el pedido con falta de ortografia', entries.some(entry => /laberiso/.test(entry.message)), JSON.stringify(entries.map(entry => entry.message)));
    check('analisis: reconoce el genero', entries.some(entry => /genero reggaeton/.test(entry.message)), JSON.stringify(entries.map(entry => entry.message)));
    check('analisis: un saludo solo no es pedido', entries.some(entry => /No lo lei como pedido/.test(entry.message)), JSON.stringify(entries.map(entry => entry.message)));
    check('analisis: no reproduce nada', state.lastPlayBody === null, JSON.stringify(state.lastPlayBody));
    dom.window.close();
  }

  // ---------- M) el vocabulario manda (entrenamiento en vivo) ----------
  {
    const { dom, integration } = loadModule({});
    await integration.syncSpotifySettings();
    check('vocabulario: "un hit de los palmeras" no se entiende por defecto', integration.parseAutoMusicRequest('un hit de los palmeras') === null, JSON.stringify(integration.parseAutoMusicRequest('un hit de los palmeras')));
    check('vocabulario: "manda damas gratis" no se entiende por defecto', integration.parseAutoMusicRequest('manda damas gratis') === null, JSON.stringify(integration.parseAutoMusicRequest('manda damas gratis')));

    // El dashboard de entrenamiento agrega "hit", "manda" y un genero nuevo.
    const base = integration.getVocabulary();
    integration.cortexSpotifyVocabulary = {
      ...base,
      musicWords: base.musicWords.concat(['hit', 'hits']),
      requestVerbs: ['manda'].concat(base.requestVerbs),
      genres: base.genres.concat([{ id: 'k-pop', spotify: 'k-pop', words: ['kpop', 'k pop'] }])
    };

    const withHit = integration.parseAutoMusicRequest('un hit de los palmeras');
    check('vocabulario: al agregar "hit" el pedido se entiende', withHit && withHit.query === 'artist:los palmeras', JSON.stringify(withHit));
    const withVerb = integration.parseAutoMusicRequest('manda damas gratis');
    check('vocabulario: al agregar "manda" se entiende sin la palabra tema', withVerb && withVerb.query === 'damas gratis', JSON.stringify(withVerb));
    const withGenre = integration.parseAutoMusicRequest('poneme un kpop');
    check('vocabulario: el genero nuevo funciona', withGenre && withGenre.query === 'genre:k-pop', JSON.stringify(withGenre));
    check('vocabulario: describe lo cargado', integration.describeVocabulary().musicWords.length === base.musicWords.length + 2, JSON.stringify(integration.describeVocabulary().musicWords.length));
    dom.window.close();
  }

  // ---------- N) cerebro (IA) para lo que las reglas no entienden ----------
  {
    const base = loadModule({});
    const vocab = base.integration.getVocabulary();
    base.dom.window.close();

    const conIa = {
      ...vocab,
      ai: { enabled: true, endpoint: 'https://ia.local/v1/chat/completions', model: 'demo', instructions: '', onlyWhenNotUnderstood: true, requireSignal: true, timeoutMs: 5000 }
    };
    const { dom, integration, state } = loadModule({
      vocabulary: conIa,
      aiInterpretation: { action: 'play', artist: 'Amar Azul', query: '', title: '', genre: '', confidence: 0.9 }
    });
    await integration.syncSpotifySettings();
    check('cerebro: queda activado desde el vocabulario', integration.getVocabulary().ai.enabled === true, JSON.stringify(integration.getVocabulary().ai.enabled));

    // "otro tema" tiene señal (palabra de musica) pero las reglas no lo pueden resolver.
    const response = await integration.handleCommand('otro tema', { chatname: 'Mati', type: 'youtube' });
    check('cerebro: la IA resuelve lo que las reglas no entienden', /Yo Tomo Licor|Amar Azul/.test(String(response)), response);
    const iaCalls = cortexCall(state, '/api/spotify-ai-interpret');
    check('cerebro: se consulta con el comentario', iaCalls.length === 1 && /otro tema/.test(iaCalls[0].body.comment), JSON.stringify(iaCalls.map(call => call.body.comment)));
    const iaLog = cortexCall(state, '/api/spotify-request-log').map(call => call.body).find(entry => entry.source === 'ia');
    check('cerebro: el pedido queda registrado como IA', !!iaLog && iaLog.ok === true, JSON.stringify(iaLog));

    // Sin señal de pedido no se molesta a la IA.
    const before = cortexCall(state, '/api/spotify-ai-interpret').length;
    await integration.handleCommand('buenas a todos, como va la noche', { chatname: 'Mati', type: 'youtube' });
    check('cerebro: sin señal de pedido no consulta', cortexCall(state, '/api/spotify-ai-interpret').length === before, cortexCall(state, '/api/spotify-ai-interpret').length - before);
    dom.window.close();
  }

  {
    const base = loadModule({});
    const vocab = base.integration.getVocabulary();
    base.dom.window.close();
    const { dom, integration, state } = loadModule({
      vocabulary: { ...vocab, ai: { ...vocab.ai, enabled: false } },
      aiInterpretation: { action: 'play', artist: 'Amar Azul' }
    });
    await integration.syncSpotifySettings();
    const response = await integration.handleCommand('otro tema', { chatname: 'Mati', type: 'youtube' });
    check('cerebro: apagado no consulta ni reproduce', response === null && cortexCall(state, '/api/spotify-ai-interpret').length === 0, JSON.stringify(response));
    dom.window.close();
  }

  // ---------- O) respuestas del bot: variantes, azar y sin repetir ----------
  {
    const RESPONSES = {
      random: true,
      avoidRepeat: true,
      recent: 2,
      contexts: {
        ok: {
          label: 'ok',
          variants: [
            'VAR-A {nombre}: {tema} - {artista}',
            'VAR-B {nombre}: {tema} - {artista}',
            'VAR-C {nombre}: {tema} - {artista}'
          ]
        },
        searching: { label: 'buscando', variants: ['BUSCO {busqueda}', 'BUSCO-GENERO {genero}'] },
        notFound: { label: 'no encontre', variants: ['NO-ESTA {pedido}'] }
      }
    };

    const { dom, integration, state } = loadModule({});
    await integration.syncSpotifySettings();
    const base = integration.getVocabulary();
    integration.cortexSpotifyVocabulary = Object.assign({}, base, { responses: RESPONSES });

    const values = { nombre: 'Mati', tema: 'Costumbres', artista: 'Damas Gratis' };
    const picks = [];
    for (let i = 0; i < 6; i += 1) picks.push(integration.describeBotReply('ok', values));
    check('respuestas: usa las variantes configuradas', picks.every(text => /^VAR-[ABC] Mati: Costumbres - Damas Gratis$/.test(text)), JSON.stringify(picks.slice(0, 3)));
    check('respuestas: devuelve mas de una variante distinta', new Set(picks).size >= 2, JSON.stringify(picks));
    check('respuestas: no repite antes de agotar (recent 2)', picks[0] !== picks[1] && picks[1] !== picks[2] && picks[0] !== picks[2], JSON.stringify(picks.slice(0, 3)));
    check('respuestas: solo salen las variantes de ese contexto', picks.every(text => text.indexOf('BUSCO') === -1 && text.indexOf('NO-ESTA') === -1), JSON.stringify(picks.slice(0, 2)));

    // Una variante que necesita un dato que no existe se saltea.
    const sinGenero = [];
    for (let i = 0; i < 5; i += 1) sinGenero.push(integration.describeBotReply('searching', { busqueda: 'amar azul' }));
    check('respuestas: saltea la variante sin datos', sinGenero.every(text => text === 'BUSCO amar azul'), JSON.stringify(sinGenero));
    const conGenero = integration.describeBotReply('searching', { busqueda: 'cumbia', genero: 'cumbia' });
    check('respuestas: con el dato usa las dos', /^BUSCO(-GENERO)? cumbia$/.test(conGenero), conGenero);

    // Y el camino real del chat usa las variantes configuradas.
    const delChat = await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati', type: 'youtube' });
    check('respuestas: el chat usa la variante configurada', /^VAR-[ABC] Mati: Yo Tomo Licor - Amar Azul$/.test(String(delChat)), delChat);

    integration.cortexSpotifyVocabulary = Object.assign({}, base, { responses: Object.assign({}, RESPONSES, {
      contexts: Object.assign({}, RESPONSES.contexts, { notFound: { label: 'no encontre', variants: ['NO-ESTA {pedido} / {busqueda}'] } })
    }) });
    const limpio = integration.describeBotReply('notFound', { pedido: 'artist:disfruto', busqueda: 'artist:nombrenuevo', nombre: 'Mati' });
    check('respuestas: oculta artist: en pedido y busqueda', !/artist:/i.test(limpio) && /disfruto/.test(limpio) && /nombrenuevo/.test(limpio), limpio);

    // Pedidos rechazados por espera: tambien salen del contexto configurado.
    state.settings = { ...state.settings, cooldownSeconds: 300 };
    integration.cortexSpotifyVocabulary = Object.assign({}, base, {
      responses: Object.assign({}, RESPONSES, { contexts: Object.assign({}, RESPONSES.contexts, { waitGlobal: { label: 'espera', variants: ['CALMA {segundos}s {nombre}'] } }) })
    });
    await integration.syncSpotifySettings();
    const espera = integration.describeBotReply('waitGlobal', { segundos: 300, nombre: 'Mati' });
    check('respuestas: el aviso de espera tambien es configurable', /^CALMA \d+s Mati$/.test(String(espera)), espera);

    // Sin respuestas configuradas vuelve el texto de siempre (compatibilidad).
    integration.cortexSpotifyVocabulary = Object.assign({}, base);
    state.settings = { ...state.settings, cooldownSeconds: 0, userCooldownSeconds: 0, testMode: true };
    await integration.syncSpotifySettings();
    integration.cortexSpotifyVocabulary = Object.assign({}, base);
    const clasico = await integration.handleCommand('!tema Damas Gratis', { chatname: 'Mati', type: 'youtube' });
    check('respuestas: sin configuracion queda el texto de siempre', /^Listo Mati, ya se esta reproduciendo: /.test(String(clasico)), clasico);

    // Variante sin {nombre}: se le agrega el nombre delante (como antes), salvo
    // que la personalizacion este apagada.
    integration.cortexSpotifyVocabulary = Object.assign({}, base, {
      responses: Object.assign({}, RESPONSES, { contexts: { ok: { label: 'ok', variants: ['SIN NOMBRE EN LA VARIANTE: {tema}'] } } })
    });
    const conNombre = integration.describeBotReply('ok', values);
    check('respuestas: si la variante no trae {nombre} se agrega delante', /^Mati, SIN NOMBRE EN LA VARIANTE: Costumbres$/.test(conNombre), conNombre);
    check('respuestas: no rompe las siglas al personalizar', /^Mati, SIN NOMBRE/.test(conNombre), conNombre);
    state.settings = { ...state.settings, personalize: false };
    await integration.syncSpotifySettings();
    integration.cortexSpotifyVocabulary = Object.assign({}, base, {
      responses: Object.assign({}, RESPONSES, { contexts: { ok: { label: 'ok', variants: ['SIN NOMBRE EN LA VARIANTE: {tema}'] } } })
    });
    const sinPersonalizar = integration.describeBotReply('ok', values);
    check('respuestas: con personalizacion apagada no agrega el nombre', sinPersonalizar === 'SIN NOMBRE EN LA VARIANTE: Costumbres', sinPersonalizar);

    // Azar apagado: siempre la primera variante.
    integration.cortexSpotifyVocabulary = Object.assign({}, base, {
      responses: { random: false, avoidRepeat: true, recent: 4, contexts: RESPONSES.contexts }
    });
    const fijas = [];
    for (let i = 0; i < 4; i += 1) fijas.push(integration.describeBotReply('ok', values));
    check('respuestas: con azar apagado repite la primera', fijas.every(text => text === fijas[0]), JSON.stringify(fijas));

    // Contexto inexistente: no rompe, devuelve lo que se le pase como respaldo.
    check('respuestas: contexto desconocido no rompe', integration.describeBotReply('no-existe', values) === '', integration.describeBotReply('no-existe', values));
    dom.window.close();
  }

  // ---------- P) lo que se reporta para el analisis (SQLite) ----------
  {
    const RESPONSES = {
      random: true,
      avoidRepeat: true,
      recent: 4,
      contexts: {
        ok: { label: 'ok', variants: ['FABRICA {nombre}: {tema}', 'DE-LA-IA {nombre}: {tema}'], aiVariants: ['DE-LA-IA {nombre}: {tema}'] },
        searching: { label: 'buscando', variants: ['Buscando {busqueda}...'] },
        notFound: { label: 'no', variants: ['NO-ESTA {pedido}'] }
      }
    };
    // El buscador simulado devuelve null para "zzz": asi se prueba el caso no encontrado.
    const { dom, integration, state } = loadModule({ search: consulta => (/zzz/i.test(consulta) ? null : TRACK) });
    await integration.syncSpotifySettings();
    const base = integration.getVocabulary();
    integration.cortexSpotifyVocabulary = Object.assign({}, base, { responses: RESPONSES });

    await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati', type: 'youtube', userid: 'u-77' });
    const reporte = cortexCall(state, '/api/spotify-request-log').pop().body;
    check('reporte: manda el comentario original', reporte.comment === '!tema Amar Azul', JSON.stringify(reporte.comment));
    check('reporte: manda la plataforma y el id del que pidio', reporte.platform === 'youtube' && reporte.requesterId === 'u-77', JSON.stringify({ platform: reporte.platform, id: reporte.requesterId }));
    check('reporte: manda el estado del pedido', reporte.status === 'played', reporte.status);
    check('reporte: manda la respuesta que dio el bot', /FABRICA|DE-LA-IA/.test(String(reporte.reply && reporte.reply.text)), JSON.stringify(reporte.reply));
    check('reporte: manda de que contexto salio la respuesta', reporte.reply && reporte.reply.context === 'ok', JSON.stringify(reporte.reply && reporte.reply.context));
    check('reporte: manda la variante usada', typeof (reporte.reply && reporte.reply.variant) === 'string' && reporte.reply.variant.length > 5, JSON.stringify(reporte.reply && reporte.reply.variant));
    check('reporte: dice si la respuesta era de la IA', reporte.reply && typeof reporte.reply.ai === 'boolean' && reporte.reply.ai === (RESPONSES.contexts.ok.aiVariants.indexOf(reporte.reply.variant) !== -1), JSON.stringify(reporte.reply));
    check('reporte: dice si lo interpreto la IA (aca no)', reporte.aiInterpreted === false, JSON.stringify(reporte.aiInterpreted));
    check('reporte: manda el pedido tal como se leyo', reporte.parsed && reporte.parsed.query === 'amar azul', JSON.stringify(reporte.parsed));

    // Un pedido que no se encuentra: estado notfound y el motivo.
    state.settings = { ...state.settings, testMode: true };
    await integration.syncSpotifySettings();
    integration.cortexSpotifyVocabulary = Object.assign({}, base, { responses: RESPONSES });
    const noEsta = await integration.handleCommand('!tema Zzz No Existe', { chatname: 'Sofi', type: 'tiktok' });
    const reporte2 = cortexCall(state, '/api/spotify-request-log').pop().body;
    check('reporte: el pedido no encontrado queda marcado', reporte2.status === 'notfound' && /NO-ESTA/.test(String(reporte2.reply.text)), JSON.stringify({ status: reporte2.status, reply: reporte2.reply.text }));
    check('reporte: avisa que el que pidio era de otra plataforma', reporte2.platform === 'tiktok', reporte2.platform);
    check('reporte: y no mezcla el comentario del pedido anterior', reporte2.comment === '!tema Zzz No Existe', JSON.stringify(reporte2.comment));
    dom.window.close();
  }

  // ---------- P2) respuestas: no repite la anterior ni con la ventana llena ----------
  {
    // Contexto "ok" con solo dos variantes y ventana de 4: la memoria corta no
    // alcanza para evitar la repeticion, la garantia tiene que venir del motor
    // (antes, al agotarse la ventana, podia repetir la ultima).
    const VOCAB = {
      responses: {
        random: true,
        avoidRepeat: true,
        recent: 4,
        contexts: {
          ok: { label: 'ok', variants: ['SALIDA-1 {tema}', 'SALIDA-2 {tema}'], aiVariants: [] }
        }
      }
    };
    const { dom, integration, state } = loadModule({ vocabulary: VOCAB });
    await integration.syncSpotifySettings();
    const bloque = integration.cortexSpotifyVocabulary.responses.contexts.ok;
    check('respuestas: el vocabulario de prueba tiene las 2 variantes', bloque.variants.length === 2, JSON.stringify(bloque));

    const salidas = [];
    for (let i = 0; i < 8; i += 1) {
      // Pedido puntual (no de artista): la rotacion de respuestas no depende de eso
      // y asi la prueba no choca con el filtro "solo temas del artista pedido".
      const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Prueba' });
      salidas.push(r && r.message);
    }
    check('respuestas: no repite la anterior aunque la ventana cubra todas', (() => { for (let i = 1; i < salidas.length; i += 1) { if (salidas[i] === salidas[i - 1]) return false; } return true; })(), JSON.stringify(salidas));
    check('respuestas: y usa las dos variantes', new Set(salidas.filter(Boolean)).size === 2, JSON.stringify(salidas));
    dom.window.close();
  }

  // ---------- Q) variedad: "un tema de X" no siempre el mismo ----------
  {
    // Spotify devuelve 5 temas del artista (uno repetido con otra URI): el bot elige al azar.
    const CATALOGO = [
      { id: 'k1', uri: 'spotify:track:k1', name: 'Uno Nunca Sabe', duration_ms: 200000, artists: [{ name: 'Ke Personajes' }], album: { name: 'A', images: [] } },
      { id: 'k2', uri: 'spotify:track:k2', name: 'Un Finde', duration_ms: 200000, artists: [{ name: 'Ke Personajes' }], album: { name: 'A', images: [] } },
      { id: 'k3', uri: 'spotify:track:k3', name: 'Como Olvidarme', duration_ms: 200000, artists: [{ name: 'Ke Personajes' }], album: { name: 'A', images: [] } },
      { id: 'k4', uri: 'spotify:track:k4', name: 'Yo Tomo', duration_ms: 200000, artists: [{ name: 'Ke Personajes' }], album: { name: 'A', images: [] } },
      { id: 'k5', uri: 'spotify:track:k5', name: 'Uno Nunca Sabe', duration_ms: 200000, artists: [{ name: 'Ke Personajes' }], album: { name: 'B', images: [] } }
    ];
    const MAS_CUMBIA = [
      { id: 'c1', uri: 'spotify:track:c1', name: 'La Cumbia Del Barrio', duration_ms: 200000, artists: [{ name: 'Amar Azul' }], album: { name: 'A', images: [] } },
      { id: 'c2', uri: 'spotify:track:c2', name: 'Yo Tomo', duration_ms: 200000, artists: [{ name: 'Amar Azul' }], album: { name: 'A', images: [] } },
      { id: 'c3', uri: 'spotify:track:c3', name: 'El Fantasma', duration_ms: 200000, artists: [{ name: 'Amar Azul' }], album: { name: 'A', images: [] } }
    ];
    const { dom, integration, state } = loadModule({
      search: consulta => (/ke personajes/i.test(consulta) ? CATALOGO : (/cumbia/i.test(consulta) ? MAS_CUMBIA : TRACK))
    });
    await integration.syncSpotifySettings();
    state.settings = { ...state.settings, testMode: true };

    // 1) el pedido se lee como artista y sin tema puntual
    await integration.runDashboardSpotifyCommand({ type: 'simulate', comment: 'pasame otro tema de ke personajes', requester: 'Prueba', parseOnly: true });
    const analisis = cortexCall(state, '/api/spotify-request-log').map(call => call.body).pop();
    check('variedad: "otro tema de X" se lee como artista', /artista\/tema de ke personajes/i.test(analisis && analisis.message), JSON.stringify(analisis && analisis.message));

    // 2) seis veces el mismo pedido -> varios temas distintos
    const nombres = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'artist:ke personajes', requester: 'Prueba' });
      nombres.push(r && r.track && r.track.name);
    }
    check('variedad: elige entre los temas del artista', new Set(nombres).size >= 3, JSON.stringify(nombres));
    check('variedad: no devuelve siempre el mismo (antes el primero)', nombres.some(n => n !== 'Uno Nunca Sabe'), JSON.stringify(nombres));
    check('variedad: nunca repite dos veces seguidas', (() => { for (let i = 1; i < nombres.length; i += 1) { if (nombres[i] === nombres[i - 1]) return false; } return true; })(), JSON.stringify(nombres));
    check('variedad: le pide mas resultados a Spotify', state.lastLimits.some(l => l >= 5), JSON.stringify(state.lastLimits.slice(0, 5)));
    check('variedad: no cuenta dos veces el mismo tema (single + disco)', new Set(nombres.filter(Boolean)).size + 1 >= 4, JSON.stringify(nombres));

    // 3) apagada -> vuelve a ser determinista (el primero de siempre)
    state.settings = { ...state.settings, artistVariety: false };
    await integration.syncSpotifySettings();
    const fijos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'artist:ke personajes', requester: 'Prueba' });
      fijos.push(r && r.track && r.track.name);
    }
    check('variedad: apagada vuelve al primero de siempre', new Set(fijos).size === 1 && fijos[0] === 'Uno Nunca Sabe', JSON.stringify(fijos));

    // 4) un pedido puntual (tema + artista) sigue exacto
    state.settings = { ...state.settings, artistVariety: true };
    await integration.syncSpotifySettings();
    const puntual = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'track:Costumbres artist:Damas Gratis', requester: 'Prueba' });
    check('variedad: un pedido puntual no se toca', puntual && puntual.track && puntual.track.name === TRACK.name, JSON.stringify(puntual && puntual.track && puntual.track.name));

    // 5) genero: mismo criterio (no siempre la misma cumbia)
    const generos = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'genre:cumbia', requester: 'Prueba' });
      generos.push(r && r.track && r.track.name);
    }
    // Ojo: la continuacion automatica pudo encolar algun tema antes, asi que puede
    // haber menos frescos. La garantia es la misma: no repite seguido.
    check('variedad: tambien en los pedidos de genero', new Set(generos).size >= 2, JSON.stringify(generos));
    check('variedad: en genero tampoco repite dos veces seguidas', (() => { for (let i = 1; i < generos.length; i += 1) { if (generos[i] === generos[i - 1]) return false; } return true; })(), JSON.stringify(generos));
    dom.window.close();
  }

  // ---------- S) modo automatico de la biblioteca (uri + start_at/end_at) ----------
  {
    const CANCION = {
      id: 'AAAABBBBCCCCDDDDEEEE01',
      uri: 'spotify:track:AAAABBBBCCCCDDDDEEEE01',
      name: 'Cumbia De La Biblioteca',
      duration_ms: 200000,
      artists: [{ name: 'Los Test' }],
      album: { name: 'Album', images: [] }
    };
    const { dom, integration, state } = loadModule({ tracks: { [CANCION.id]: CANCION } });
    await integration.syncSpotifySettings();
    state.settings = { ...state.settings, testMode: true, skipEnabled: false, skipSeconds: 10, pollSeconds: 4 };
    await integration.syncSpotifySettings();
    await integration.initialize();   // arranca la consulta periodica del estado

    const resultado = await integration.runDashboardSpotifyCommand({
      type: 'play', uri: CANCION.uri, query: CANCION.uri,
      startAt: 8.2, endAt: 190, auto: true, requester: 'Rulo'
    });
    check('auto: reproduce la cancion por su uri', resultado && resultado.success === true && state.lastTrackById[0] === CANCION.id, JSON.stringify(state.lastTrackById));
    check('auto: no pasa por el buscador de texto', state.lastSearch.length === 0, JSON.stringify(state.lastSearch));
    check('auto: arranca en el start_at de la biblioteca', state.lastPlayBody && state.lastPlayBody.position_ms === 8200, JSON.stringify(state.lastPlayBody));
    check('auto: avisa al backend que fue automatico', (() => {
      const registro = cortexCall(state, '/api/spotify-request-log').map(c => c.body).pop();
      return registro && registro.source === 'auto';
    })(), JSON.stringify(cortexCall(state, '/api/spotify-request-log').map(c => c.body.source)));

    // El corte del final: calculo puro
    const corte = integration.__cortexCorteDeCierre({ endAt: 190 }, 200000, 10000);
    check('auto: el corte del final sale del end_at (10 s)', corte === 10000, String(corte));
    check('auto: sin end_at se usa el salto de siempre', integration.__cortexCorteDeCierre(null, 200000, 10000) === 10000);
    check('auto: los limites quedaron guardados por uri', (integration.__cortexLimites().get(CANCION.uri) || {}).endAt === 190);

    // Y el corte de verdad: cuando la reproduccion llega cerca del final logico,
    // el modulo pasa al siguiente tema y avisa al backend.
    // Asi lo llama SocialStream: cada consulta del tema pasa por la regla. La
    // primera registra que el tema ya arranco, la segunda evalua el final logico.
    state.player = { is_playing: true, progress_ms: 186000, item: { uri: CANCION.uri, duration_ms: 200000 }, device: { id: 'dev1' } };
    state.currentTrack = { uri: CANCION.uri, name: CANCION.name, artist: 'Los Test', duration: 200000, progress: 186000, isPlaying: true };
    await integration.getCurrentTrack();
    await wait(150);
    await integration.getCurrentTrack();
    await wait(150);
    check('auto: al llegar al final logico pasa al siguiente', state.nextCalls >= 1, 'next: ' + state.nextCalls);
    check('auto: y le avisa al backend para que encole la proxima', cortexCall(state, '/api/biblioteca-auto-termino').length >= 1, JSON.stringify(cortexCall(state, '/api/biblioteca-auto-termino').length));
    dom.window.close();
  }

  // ---------- H) Spotify frena las consultas (429): hay que decirlo, no mentir ----------
  {
    const { dom, integration, state } = loadModule({ searchStatus: 429, retryAfter: 5 });
    await integration.initialize();
    await wait(250);

    const primero = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Mati' });
    check('frenazo: avisa que Spotify frena (no miente con "no lo encontre")',
      primero && primero.success === false && /frenando las consultas/i.test(String(primero.message)) && !/no encontre|no aparece|no existe/i.test(String(primero.message)),
      JSON.stringify(primero && primero.message));
    const registro = cortexCall(state, '/api/spotify-request-log').map(c => c.body).pop();
    check('frenazo: queda registrado con el estado throttled', registro && registro.status === 'throttled', JSON.stringify(registro && registro.status));

    // Mientras dura el frenazo no se vuelve a golpear la API de Spotify.
    const antes = state.lastSearch.length;
    const segundo = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Otro Tema Cualquiera', requester: 'Mati' });
    check('frenazo: no insiste con otra busqueda', state.lastSearch.length === antes, JSON.stringify(state.lastSearch.slice(antes)));
    check('frenazo: el segundo pedido tambien lo dice', segundo && segundo.success === false && /frenando las consultas/i.test(String(segundo.message)), JSON.stringify(segundo && segundo.message));

    const buscar = await integration.runDashboardSpotifyCommand({ type: 'search', query: 'cualquier cosa' });
    check('frenazo: el buscador del dashboard tambien avisa', buscar && buscar.success === false && /frenando las consultas/i.test(String(buscar.message)), JSON.stringify(buscar && buscar.message));
    dom.window.close();
  }

  // ---------- I) cuando el frenazo se vence, el bot vuelve a andar ----------
  {
    const { dom, integration, state } = loadModule({ searchStatus: 429, retryAfter: 1, search429Primero: true });
    await integration.initialize();
    await wait(200);
    const frenado = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul', requester: 'Mati' });
    check('frenazo: el primer pedido avisa el frenazo', frenado && frenado.success === false && /frenando las consultas/i.test(String(frenado.message)), JSON.stringify(frenado && frenado.message));

    await wait(1300);   // se vence el Retry-After de 1 segundo
    const despues = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Damas Gratis', requester: 'Mati' });
    check('frenazo: vencido el plazo, vuelve a reproducir', despues && despues.success === true, JSON.stringify(despues && despues.message));
    check('frenazo: el frenazo quedo limpio', !integration.spotifyFrenadoHasta || integration.spotifyFrenadoHasta <= Date.now(), String(integration.spotifyFrenadoHasta));
    dom.window.close();
  }

  // ---------- J) la app colgada no puede trabar al bot ----------
  {
    const { dom, integration, state } = loadModule({ hangSegundos: 30, remote: { pollSeconds: 1 } });
    integration.spotifyTimeoutMs = 400;      // para la prueba: 0,4 s en vez de 12 s
    await integration.initialize();
    await wait(200);

    const arranque = Date.now();
    const pedido = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Mati' });
    const tardo = Date.now() - arranque;
    check('app colgada: el pedido no se queda esperando para siempre', tardo < 4000, tardo + 'ms');
    check('app colgada: avisa que Spotify no responde (no miente)', pedido && pedido.success === false && /no me respondio|no contesta|no me dio bola/i.test(String(pedido.message)), JSON.stringify(pedido && pedido.message));
    const registro = cortexCall(state, '/api/spotify-request-log').map(c => c.body).pop();
    check('app colgada: queda registrado como no_response', registro && registro.status === 'no_response', JSON.stringify(registro && registro.status));

    // Y el bot sigue vivo: el pedido siguiente no queda "ocupado" para siempre.
    const siguiente = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Otra Cosa', requester: 'Mati' });
    check('app colgada: el bot no queda trabado en ocupado', siguiente && siguiente.blockedByCooldown !== true, JSON.stringify(siguiente && siguiente.message));
    dom.window.close();
  }

  // ---------- K) pausa y reanudar: codigo propio, con dispositivo y con motivo ----------
  {
    // Como pasa en la app de la Store: sin indicar dispositivo falla (404),
    // indicando la PC anda. El modulo tiene que lograr la pausa igual.
    const { dom, integration, state } = loadModule({ pauseStatus: 404, pauseStatusSoloSinDispositivo: true });
    await integration.initialize();
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'pause', requester: 'Mati' });
    check('transporte: la pausa se logra indicando el dispositivo', r && r.success === true, JSON.stringify(r && r.message));
    check('transporte: la pausa se pidio con device_id', (state.pauseUrls || []).some(u => u.indexOf('device_id=') !== -1), JSON.stringify(state.pauseUrls));

    // Y si Spotify responde 403 en todas las variantes, el registro guarda el motivo real.
    const segunda = loadModule({ pauseStatus: 403 });
    await segunda.integration.initialize();
    await wait(200);
    const fallo = await segunda.integration.runDashboardSpotifyCommand({ type: 'pause', requester: 'Mati' });
    check('transporte: si falla todo, avisa que fallo', fallo && fallo.success === false, JSON.stringify(fallo && fallo.message));
    const registro = cortexCall(segunda.state, '/api/spotify-request-log').map(c => c.body).pop();
    check('transporte: el registro guarda el motivo HTTP 403', registro && /HTTP 403/.test(String(registro.message)), JSON.stringify(registro && registro.message));
    check('transporte: probo las variantes (dispositivo, sin cuerpo)', /con el dispositivo/.test(String(registro && registro.message)) && /sin cuerpo/.test(String(registro && registro.message)), JSON.stringify(registro && registro.message));
    check('transporte: tambien probo activando la PC primero', (segunda.state.pauseCalls || 0) >= 4, String(segunda.state.pauseCalls));
    dom.window.close();
    segunda.dom.window.close();
  }

  // ---------- L) reproducir con el dispositivo inactivo y con motivo real ----------
  {
    const { dom, integration, state } = loadModule({ deviceActive: false });
    await integration.initialize();
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Mati' });
    check('reproducir: con el dispositivo inactivo se traspasa antes', (state.transfers || 0) >= 1, String(state.transfers));
    check('reproducir: y aun asi el tema suena', r && r.success === true, JSON.stringify(r && r.message));
    check('reproducir: el traspaso no arranca la musica (play:false)', ((state.transferBodies || [])[0] || {}).play === false, JSON.stringify(state.transferBodies));
    dom.window.close();
  }
  {
    const { dom, integration, state } = loadModule({ queueWorks: true, initialQueue: ['spotify:track:cola-anterior'], initialPlayer: {
      is_playing: true, progress_ms: 12000, item: { uri: 'spotify:track:anterior', name: 'Tema anterior' }, device: DEVICE,
      context: { uri: 'spotify:playlist:actual', type: 'playlist' }
    } });
    await integration.initialize();
    const result = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Mati' });
    check('pedido manual: encola como siguiente y avanza sin reemplazar la playlist',
      result && result.success === true && state.nextCalls === 1 && state.player.item.uri === TRACK.uri && state.player.context.uri === 'spotify:playlist:actual',
      JSON.stringify({ result: result && result.message, nextCalls: state.nextCalls, player: state.player }));
    check('pedido manual: usa cola y siguiente sin mandar play directo', state.playerActions.join(',') === 'queue,next', state.playerActions.join(','));
    check('pedido manual: conserva lo que ya estaba detras en la cola', state.queue.includes('spotify:track:cola-anterior'), JSON.stringify(state.queue));
    const playsBeforeDuplicate = state.playerActions.join(',');
    const duplicate = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Mati' });
    check('pedido manual duplicado: reconoce que ya suena y no lo vuelve a agregar', duplicate && duplicate.success === true && state.playerActions.join(',') === playsBeforeDuplicate && !state.queue.includes(TRACK.uri), JSON.stringify({ actions: state.playerActions, queue: state.queue }));
    dom.window.close();
  }
  {
    const { dom, integration, state } = loadModule({ queueStatus: 404 });
    await integration.initialize();
    // El reproductor esta en otro tema: el fallo no se puede confundir con "ya suena".
    state.player = { is_playing: false, item: { uri: 'spotify:track:otro' }, device: { id: DEVICE.id } };
    await wait(200);
    const f = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Damas Gratis', requester: 'Mati' });
    check('reproducir: si falla avisa', f && f.success === false, JSON.stringify(f && f.message));
    const registro = cortexCall(state, '/api/spotify-request-log').map(c => c.body).pop();
    check('reproducir: el registro guarda el motivo HTTP 404', registro && /HTTP 404/.test(String(registro.message)), JSON.stringify(registro && registro.message));
    dom.window.close();
  }

  // ---------- M) el 403 "Restriction violated" no es un error: es "ya estaba" ----------
  {
    // Pausar cuando ya esta pausado: Spotify contesta 403 y el estado lo confirma.
    const { dom, integration, state } = loadModule({ pauseStatus: 403 });
    await integration.initialize();
    state.player = { is_playing: false, item: { uri: TRACK.uri }, device: { id: DEVICE.id } };
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'pause', requester: 'Mati' });
    check('restringido: pausar algo ya pausado cuenta como exito', r && r.success === true, JSON.stringify(r && r.message));
    const registro = cortexCall(state, '/api/spotify-request-log').map(c => c.body).pop();
    check('restringido: queda registrado como transporte ok', registro && registro.ok === true && registro.query === 'transporte:pause', JSON.stringify(registro && registro.query) + ' ok=' + JSON.stringify(registro && registro.ok));
    dom.window.close();
  }
  {
    // Reanudar cuando ya esta sonando: mismo caso con /play.
    const { dom, integration, state } = loadModule({ playStatus: 403 });
    await integration.initialize();
    state.player = { is_playing: true, item: { uri: TRACK.uri }, device: { id: DEVICE.id } };
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'resume', requester: 'Mati' });
    check('restringido: reanudar algo que ya suena cuenta como exito', r && r.success === true, JSON.stringify(r && r.message));
    dom.window.close();
  }
  {
    // Pero si el estado NO coincide, el 403 si es un fallo (y queda el motivo).
    const { dom, integration, state } = loadModule({ pauseStatus: 403 });
    await integration.initialize();
    state.player = { is_playing: true, item: { uri: TRACK.uri }, device: { id: DEVICE.id } };
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'pause', requester: 'Mati' });
    check('restringido: si el estado no coincide, sigue siendo fallo', r && r.success === false, JSON.stringify(r && r.message));
    const registro = cortexCall(state, '/api/spotify-request-log').map(c => c.body).pop();
    check('restringido: y queda el motivo con el 403', registro && /restriction violated/i.test(String(registro.message)), JSON.stringify(registro && registro.message).slice(0, 120));
    dom.window.close();
  }
  {
    // Reproducir un tema que ya suena: 403 en el play, pero el estado lo confirma.
    const { dom, integration, state } = loadModule({ playStatus: 403 });
    await integration.initialize();
    state.player = { is_playing: true, item: { uri: TRACK.uri }, device: { id: DEVICE.id } };
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul Yo Tomo Licor', requester: 'Mati' });
    check('restringido: pedir el tema que ya suena cuenta como exito', r && r.success === true, JSON.stringify(r && r.message));
    dom.window.close();
  }

  // ---------- N) pedido de artista: catalogo real, filtro y fallos transitorios ----------
  {
    // El caso reportado: "un tema del polaco" devolvia "Beautiful - Tan Bionica".
    // El catalogo del artista resuelto tiene que ganar siempre.
    const EL_POLACO = { id: 'p1', uri: 'spotify:track:p1', name: 'Vengo de la casa de ella', duration_ms: 200000, artists: [{ name: 'El Polaco' }] };
    const BASURA = { id: 'b1', uri: 'spotify:track:b1', name: 'Beautiful', duration_ms: 200000, artists: [{ name: 'Tan Bionica' }] };
    const { dom, integration, state } = loadModule({
      artists: [{ id: 'a1', name: 'El Polaco' }],
      topTracks: [EL_POLACO],
      search: () => [BASURA]
    });
    await integration.initialize();
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'artist:polaco', requester: 'Mati' });
    check('artista: resuelve el nombre real con la busqueda de artistas', state.artistSearches.length >= 1, JSON.stringify(state.artistSearches));
    check('artista: usa el catalogo real del artista', (state.topTracksCalls || 0) >= 1, String(state.topTracksCalls));
    check('artista: elige un tema del artista pedido', r && r.success === true && /El Polaco/.test(String(r.track && r.track.artist)), JSON.stringify(r && r.track));
    check('artista: nunca elige basura de otro artista', !/Tan Bionica/.test(String(r.track && r.track.artist)), JSON.stringify(r && r.track));
    dom.window.close();
  }
  {
    // Si todo lo que devuelve Spotify es de otros artistas, NO se reproduce: mejor
    // decir que no se encontro que poner una cancion que nadie pidio.
    const BASURA = { id: 'b1', uri: 'spotify:track:b1', name: 'Beautiful', duration_ms: 200000, artists: [{ name: 'Tan Bionica' }] };
    const { dom, integration, state } = loadModule({
      artists: [{ id: 'a1', name: 'El Polaco' }],
      topTracks: [],
      search: () => [BASURA]
    });
    await integration.initialize();
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'artist:polaco', requester: 'Mati' });
    check('artista: con solo basura no reproduce nada (avisa)', r && r.success === false, JSON.stringify(r && r.message));
    check('artista: y no eligio la basura', !/Tan Bionica/.test(JSON.stringify(r && r.track)), JSON.stringify(r && r.track));
    dom.window.close();
  }
  {
    // Un fallo del buscador de artistas es transitorio: NO se cachea, el proximo
    // pedido lo vuelve a intentar (era el bug: quedaba roto toda la sesion).
    const TEMA = { id: 'z1', uri: 'spotify:track:z1', name: 'Un Tema', duration_ms: 200000, artists: [{ name: 'Alguien' }] };
    const { dom, integration, state } = loadModule({ artistStatus: 500, artists: [{ id: 'a1', name: 'El Polaco' }], search: () => [TEMA] });
    await integration.initialize();
    await wait(200);
    await integration.runDashboardSpotifyCommand({ type: 'play', query: 'artist:polaco', requester: 'Mati' });
    const primeraVez = state.artistSearches.length;
    await integration.runDashboardSpotifyCommand({ type: 'play', query: 'artist:polaco', requester: 'Mati' });
    check('artista: un fallo transitorio no se cachea (se reintenta)', state.artistSearches.length > primeraVez, 'antes ' + primeraVez + ', ahora ' + state.artistSearches.length);
    dom.window.close();
  }

  {
    // N) bis - El filtro del campo en la busqueda: MEDIDO CONTRA LA API REAL, Spotify
    // devuelve 0 resultados para "artist:Ke Personajes" y para "genre:cumbia", y encuentra
    // bien con el texto pelado. Por eso ningun intento puede llevar el prefijo, ni siquiera
    // el respaldo cuando el catalogo real del artista no responde (era el bug: 32 pedidos
    // de artista en la base, 0 reproducciones).
    const KE = { id: 'k1', uri: 'spotify:track:k1', name: 'Pobre Corazon - En Vivo', duration_ms: 200000, artists: [{ name: 'Ke Personajes' }] };
    const { dom, integration, state } = loadModule({
      artists: [{ id: 'a1', name: 'Ke Personajes' }],
      topTracks: [],
      search: q => (String(q).indexOf('artist:') === -1 ? [KE] : [])
    });
    await integration.initialize();
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'artist:ke personajes', requester: 'Mati' });
    check('campo: sin catalogo real igual encuentra al artista (busca el nombre, no "artist:")',
      r && r.success === true && /Ke Personajes/.test(String(r.track && r.track.artist)),
      JSON.stringify({ track: r && r.track, busquedas: state.lastSearch }));
    check('campo: ninguna busqueda se apoya en "artist:" (Spotify lo ignora)',
      state.lastSearch.length > 0 && state.lastSearch.every(q => String(q).indexOf('artist:') === -1),
      JSON.stringify(state.lastSearch));
    const r2 = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'genre:cumbia', requester: 'Mati' });
    check('campo: tampoco el genero se busca con "genre:"',
      state.lastSearch.every(q => String(q).indexOf('genre:') === -1),
      JSON.stringify(state.lastSearch));
    check('campo: y el genero encuentra tema', r2 && r2.success === true, JSON.stringify(r2 && r2.message));
    dom.window.close();
  }
  {
    // Con el vocabulario REAL del proyecto (el que edita el dashboard) el orden de intentos
    // tiene que empezar por el texto pelado: si el vocabulario crece, las variantes no
    // pueden empujar afuera al unico intento que funciona.
    const VERO = JSON.parse(require('fs').readFileSync('D:/plugins para mi OBS/Rulo/Spotify/spotify-vocabulary.json', 'utf8'));
    const KE = { id: 'k1', uri: 'spotify:track:k1', name: 'Pobre Corazon - En Vivo', duration_ms: 200000, artists: [{ name: 'Ke Personajes' }] };
    const { dom, integration, state } = loadModule({
      artists: [{ id: 'a1', name: 'Ke Personajes' }],
      topTracks: [],
      vocabulary: VERO,
      search: q => (String(q).indexOf('artist:') === -1 ? [KE] : [])
    });
    await integration.initialize();
    await wait(200);
    const r = await integration.runDashboardSpotifyCommand({ type: 'play', query: 'artist:ke personajes', requester: 'Mati' });
    check('campo: con el vocabulario real tambien encuentra', r && r.success === true, JSON.stringify(state.lastSearch));
    check('campo: y gasta una sola busqueda (no cuatro)', state.lastSearch.length <= 2, JSON.stringify(state.lastSearch));
    dom.window.close();
  }

  // La búsqueda del chat usa un grupo mayor que la prueba directa: ambas deben
  // funcionar con el límite real de diez resultados y sin acceso a top-tracks.
  {
    const songs = Array.from({length:20}, (_, i) => ({...TRACK, id:'karina-'+i, uri:'spotify:track:karina'+i, name:'Tema Karina '+i, artists:[{id:'karina',name:'Karina'}]}));
    const {dom, integration, state} = loadModule({artists:[{id:'karina',name:'Karina'}],topTracksStatus:403,search:()=>songs,remote:{autoContinue:false,artistVariety:true,artistVarietyPool:20}});
    await integration.initialize();
    const direct = await integration.runDashboardSpotifyCommand({type:'search',query:'karina',requester:'Dashboard'});
    check('regresión Karina: búsqueda directa encuentra', direct.success === true);
    await integration.handleCommand('quiero un tema de karina', {chatname:'Mati',type:'youtube'});
    check('regresión Karina: pedido natural reproduce al artista', /^spotify:track:karina/.test(state.lastPlayedUri || ''), state.lastPlayedUri);
    check('regresión Karina: todas las búsquedas respetan límite 10', state.lastLimits.every(n=>n<=10), JSON.stringify(state.lastLimits));
    check('regresión Karina: pagina para conservar variedad 20', state.lastOffsets.includes(10), JSON.stringify(state.lastOffsets));
    dom.window.close();
  }
  {
    const {dom,integration,state} = loadModule({searchStatus:400,remote:{autoContinue:false}});
    await integration.initialize();
    const result=await integration.runDashboardSpotifyCommand({type:'search',query:'karina',requester:'Dashboard'});
    check('búsqueda rechazada: informa HTTP 400 en lugar de no encontrado', !result.success && /HTTP 400/.test(result.message), result.message);
    check('búsqueda rechazada: no malgasta consultas en variantes', state.lastSearch.length===1, state.lastSearch.length);
    dom.window.close();
  }

  // ---------- Resultado ----------
  const failed = results.filter(item => !item.ok);
  results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
  console.log(`\n${results.length - failed.length}/${results.length} pruebas del modulo de Spotify OK`);
  process.exit(failed.length ? 1 : 0);
})();
