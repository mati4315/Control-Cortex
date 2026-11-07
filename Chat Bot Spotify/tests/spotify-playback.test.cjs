'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const SpotifyBot = require('../src/spotify');

const TRACK = { uri: 'spotify:track:requested', name: 'Tema pedido', duration_ms: 180000 };
const DEVICE = { id: 'device-1', name: 'Spotify Desktop', is_active: true };

function makeBot({ queue = [], state = null, volume = 55, addQueueItem = true } = {}) {
  const playback = state || {
    is_playing: true,
    item: { uri: 'spotify:track:previous' },
    device: { id: DEVICE.id, name: DEVICE.name },
    progress_ms: 1000
  };
  const device = { ...DEVICE, volume_percent: volume, supports_volume: true };
  const queueItems = queue.map(item => ({ ...item }));
  const calls = [];
  const bot = new SpotifyBot({
    tokenFile: path.join(os.tmpdir(), 'spotify-playback-regression-no-token.json'),
    getCortexBaseUrl: () => 'http://127.0.0.1:4000',
    getConfig: () => ({ forwardToCortex: false }),
    publish: () => {},
    sendBotReply: async () => {}
  });
  bot.api = async (route, options = {}) => {
    calls.push({ route, method: options.method || 'GET' });
    if (route === '/me/player') return { body: { ...playback, item: playback.item && { ...playback.item }, device: playback.device && { ...playback.device } } };
    if (route === '/me/player/queue') return { body: { queue: queueItems.map(item => ({ ...item })) } };
    if (route.startsWith('/me/player/queue?') && options.method === 'POST') {
      if (addQueueItem) queueItems.push({ ...TRACK });
      return { body: null };
    }
    if (route.startsWith('/me/player/next?') && options.method === 'POST') {
      playback.item = { uri: TRACK.uri };
      playback.device = { id: DEVICE.id, name: DEVICE.name };
      playback.progress_ms = 0;
      playback.is_playing = true;
      queueItems.shift();
      return { body: null };
    }
    if (route === '/me/player/devices') return { body: { devices: [{ ...device }] } };
    if (route.startsWith('/me/player/volume?')) {
      const volumeMatch = route.match(/volume_percent=(\d+)/);
      if (volumeMatch) device.volume_percent = Number(volumeMatch[1]);
      return { body: null };
    }
    if (route.startsWith('/me/player/pause?')) { playback.is_playing = false; return { body: null }; }
    if (route.startsWith('/me/player/seek?')) {
      playback.progress_ms = Number(new URL(`http://local${route}`).searchParams.get('position_ms'));
      return { body: null };
    }
    if (route.startsWith('/me/player/play?')) { playback.is_playing = true; return { body: null }; }
    throw new Error(`Ruta inesperada en la prueba: ${route}`);
  };
  return { bot, calls, playback, queueItems, device };
}

function closeTimers(bot) {
  clearTimeout(bot.cortexPollTimer);
  clearTimeout(bot.playbackPollTimer);
}

test('agrega una sola vez, verifica la cola y recién entonces avanza y confirma la pista', async t => {
  const fixture = makeBot();
  t.after(() => closeTimers(fixture.bot));

  const result = await fixture.bot.play(TRACK, DEVICE, { skipEnabled: false });

  assert.equal(result.ok, true);
  assert.equal(result.state.item.uri, TRACK.uri);
  assert.equal(result.state.device.id, DEVICE.id);
  assert.equal(result.state.is_playing, true);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('/me/player/queue?') && call.method === 'POST').length, 1);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('/me/player/next?')).length, 1);
  assert.ok(fixture.calls.findIndex(call => call.route === '/me/player/queue') < fixture.calls.findIndex(call => call.route.startsWith('/me/player/next?')));
});

test('si otra pista bloquea el pedido, no agrega duplicados ni avanza la cola', async t => {
  const fixture = makeBot({ queue: [{ uri: 'spotify:track:blocker', name: 'Tema que bloquea' }, { ...TRACK }] });
  t.after(() => closeTimers(fixture.bot));

  await assert.rejects(fixture.bot.play(TRACK, DEVICE, { skipEnabled: false }), /Tema que bloquea.*No salté/);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('/me/player/queue?') && call.method === 'POST').length, 0);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('/me/player/next?')).length, 0);
});

test('si la pista ya está sonando en el dispositivo elegido, no la agrega otra vez', async t => {
  const fixture = makeBot({ state: {
    is_playing: true,
    item: { uri: TRACK.uri },
    device: { id: DEVICE.id, name: DEVICE.name },
    progress_ms: 1000
  } });
  t.after(() => closeTimers(fixture.bot));

  const result = await fixture.bot.play(TRACK, DEVICE, { skipEnabled: false });

  assert.equal(result.alreadyPlaying, true);
  assert.equal(fixture.calls.some(call => call.route === '/me/player/queue'), false);
  assert.equal(fixture.calls.some(call => call.route.startsWith('/me/player/next?')), false);
});

test('si Spotify no pone el pedido primero en la cola, no ejecuta Siguiente', async t => {
  const fixture = makeBot({ addQueueItem: false });
  t.after(() => closeTimers(fixture.bot));

  await assert.rejects(fixture.bot.play(TRACK, DEVICE, { skipEnabled: false }), /no avancé la playlist/);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('/me/player/queue?') && call.method === 'POST').length, 1);
  assert.equal(fixture.calls.filter(call => call.route.startsWith('/me/player/next?')).length, 0);
});

test('el offset silencia antes del salto y restaura el volumen original al finalizar', async t => {
  const fixture = makeBot();
  t.after(() => closeTimers(fixture.bot));

  const result = await fixture.bot.play(TRACK, DEVICE, { skipEnabled: true, skipSeconds: 5 });

  assert.equal(result.ok, true);
  assert.equal(result.state.progress_ms, 5000);
  assert.equal(fixture.device.volume_percent, 55);
  const silence = fixture.calls.findIndex(call => call.route.includes('/me/player/volume?volume_percent=0'));
  const advance = fixture.calls.findIndex(call => call.route.startsWith('/me/player/next?'));
  const restore = fixture.calls.findIndex(call => call.route.includes('/me/player/volume?volume_percent=55'));
  assert.ok(silence >= 0 && silence < advance && advance < restore);
});
