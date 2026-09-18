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
  cooldownSeconds: 40,
  userCooldownSeconds: 120,
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
    cortexCalls: [],
    skipCalls: 0,
    aliases: opts.aliases || null,
    lastSearch: []
  };

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1:4000/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
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
      return jsonResponse(payload);
    }
    if (target.indexOf('/api/spotify-device-target') !== -1) {
      return jsonResponse({ deviceName: state.settings.deviceTargetName });
    }
    if (target.indexOf('/api/spotify-playback-offset') !== -1) {
      return jsonResponse({ enabled: state.settings.skipEnabled, seconds: state.settings.skipSeconds });
    }
    if (target.indexOf('http://127.0.0.1:4000/') === 0) {
      state.cortexCalls.push({ url: target, body });
      return jsonResponse({ ok: true, success: true });
    }

    // --- Spotify Web API simulada ---
    if (target.indexOf('/v1/search') !== -1) {
      const q = decodeURIComponent((target.split('q=')[1] || '').split('&')[0]);
      state.lastSearch.push(q);
      const resolver = opts.search;
      const found = typeof resolver === 'function' ? resolver(q) : TRACK;
      return jsonResponse({ tracks: { items: found ? [found] : [] } });
    }
    if (target.indexOf('/me/player/devices') !== -1) {
      return jsonResponse({ devices: [DEVICE] });
    }
    if (target.indexOf('/me/player/play') !== -1) {
      state.lastPlayedUri = TRACK.uri;
      state.lastPlayBody = body;
      return emptyResponse(204);
    }
    if (target.indexOf('/me/player/queue') !== -1) return emptyResponse(204);
    if (target.indexOf('/me/player/seek') !== -1) return emptyResponse(204);
    if (target.indexOf('/me/player/next') !== -1) return emptyResponse(204);
    if (target.indexOf('/recommendations') !== -1) return jsonResponse({ tracks: [CONTINUATION] });
    if (target.indexOf('/me/player') !== -1) {
      return jsonResponse({
        is_playing: true,
        progress_ms: 12000,
        item: { uri: state.lastPlayedUri || TRACK.uri },
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
    async getCurrentTrack() { return null; }
    async skip() { state.skipCalls += 1; return { success: true }; }
    async previous() { return { success: true }; }
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

(async () => {
  // ---------- A) parser y limites del dashboard ----------
  {
    const { dom, integration, state } = loadModule({});
    check('modulo: version declarada expuesta', integration.__cortexModuleVersion === DECLARED_VERSION, integration.__cortexModuleVersion + ' vs ' + DECLARED_VERSION);

    const parsed = integration.parseAutoMusicRequest('quiero escuchar Ke Personajes');
    check('parser: artista por lenguaje natural', parsed && parsed.query === 'ke personajes' && parsed.source === 'natural', JSON.stringify(parsed));
    const byArtist = integration.parseAutoMusicRequest('quiero un tema de Damas Gratis');
    check('parser: artista explicito', byArtist && byArtist.query === 'artist:damas gratis', JSON.stringify(byArtist));

    const command = integration.parseAutoMusicRequest('!tema Damas Gratis');
    check('parser: comando', command && command.query === 'damas gratis' && command.source === 'command', JSON.stringify(command));

    await integration.syncSpotifySettings();
    check('sync: ajustes del dashboard cargados', integration.getCortexSpotifySettings() && integration.getCortexSpotifySettings().deviceTargetName === 'NOTEBOOK-MATI', JSON.stringify(integration.getCortexSpotifySettings()));
    check('sync: limites efectivos por defecto', JSON.stringify(integration.describeAutoMusicLimits()) === '{"minTextLength":8,"requireCommand":false}', JSON.stringify(integration.describeAutoMusicLimits()));

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
    const { dom, integration, state } = loadModule({});
    await integration.syncSpotifySettings();

    const first = await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati', type: 'youtube' });
    check('chat: primer pedido se reproduce', /Yo Tomo Licor/.test(String(first)), first);

    const second = await integration.handleCommand('!tema Damas Gratis', { chatname: 'Mati', type: 'youtube' });
    check('chat: segundo pedido espera (40s)', /espera \d+s/i.test(String(second)), second);

    const log = cortexCall(state, '/api/spotify-request-log').map(call => call.body);
    check('registro: pedido exitoso reportado', log.some(entry => entry.ok === true && /Yo Tomo Licor/.test(entry.message)), JSON.stringify(log[0]));
    check('registro: pedido rechazado tambien se reporta', log.some(entry => entry.ok === false && /espera/i.test(entry.message)), 'faltaba el rechazo');
    check('registro: source chat', log[0] && log[0].source === 'chat', JSON.stringify(log[0] && log[0].source));
    check('registro: guarda el tema elegido', log[0] && log[0].track && log[0].track.name === 'Yo Tomo Licor', JSON.stringify(log[0] && log[0].track));

    const devicesReport = cortexCall(state, '/api/spotify-devices-report');
    check('dispositivos: la extension reporta la lista', devicesReport.length > 0 && devicesReport[0].body.devices[0].name === 'NOTEBOOK-MATI', JSON.stringify(devicesReport[0] && devicesReport[0].body));

    // Modo prueba encendido desde el dashboard: sin esperas.
    state.settings = { ...state.settings, testMode: true };
    await integration.syncSpotifySettings();
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
    const { dom, integration, state } = loadModule({ remote: { personalize: true, announce: true, skipEnabled: true, skipSeconds: 10 } });
    await integration.syncSpotifySettings();
    await integration.handleCommand('!tema Amar Azul', { chatname: 'Mati Perez', type: 'tiktok' });
    const announced = cortexCall(state, '/api/rulo-bot-message').map(call => call.body.message);
    check('overlay: aviso thinking enviado', announced.some(message => /Buscando/.test(message)), JSON.stringify(announced));
    check('overlay: respuesta personalizada', announced.some(message => /^Listo Mati,/.test(message)), JSON.stringify(announced));
    check('salto: arranca en el segundo 10', state.lastPlayBody && state.lastPlayBody.position_ms === 10000, JSON.stringify(state.lastPlayBody));
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
    check('dashboard: la prueba no consume la espera del chat', /Yo Tomo Licor/.test(String(chatAfter)), chatAfter);

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
    check('ws: se abre el enlace con el dashboard', sockets.length === 1 && /\/api\/spotify-ws$/.test(sockets[0].url), JSON.stringify(sockets.map(socket => socket.url)));

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

  // ---------- Resultado ----------
  const failed = results.filter(item => !item.ok);
  results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
  console.log(`\n${results.length - failed.length}/${results.length} pruebas del modulo de Spotify OK`);
  process.exit(failed.length ? 1 : 0);
})();
