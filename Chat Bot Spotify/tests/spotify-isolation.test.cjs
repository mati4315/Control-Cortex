'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const SpotifyBot = require('../src/spotify');
const { isolatedSearchOptions, isolatedPlaybackOptions, isolatedCommentOptions } = require('../src/isolation-options');

const track = { uri: 'spotify:track:isolation', name: 'Tema de prueba', artists: [{ name: 'Artista' }], duration_ms: 180000 };
const device = { id: 'device-isolation', name: 'Spotify Desktop', is_active: true };
const responses = {
  random: false,
  avoidRepeat: true,
  recent: 5,
  contexts: {
    searching: { variants: ['Buscando {busqueda}'] },
    ok: { variants: ['Listo {nombre}'] }
  }
};

function makeBot() {
  const logEntries = [];
  const replies = [];
  const bot = new SpotifyBot({
    tokenFile: path.join(os.tmpdir(), 'spotify-isolation-no-token.json'),
    getConfig: () => ({ forwardToCortex: false }),
    getCortexBaseUrl: () => 'http://127.0.0.1:4000',
    publish: () => {},
    sendBotReply: async (...args) => { replies.push(args); return { success: true, isolatedTest: true }; },
    logRequest: async entry => { logEntries.push(entry); }
  });
  bot.getVocabulary = async () => ({ musicWords: ['tema'], responses });
  bot.getSettings = async () => ({ enabled: true, testMode: true, announce: false, personalize: true, skipEnabled: false, cooldownSeconds: 0, userCooldownSeconds: 0 });
  bot.isConnected = () => true;
  bot.searchWithVariants = async () => [track];
  bot.devices = async () => [device];
  bot.play = async () => ({ ok: true, track, device: device.name, state: { is_playing: true, item: { uri: track.uri }, device } });
  bot.publishPlaybackState = async () => {};
  return { bot, logEntries, replies };
}

function closeTimers(bot) {
  clearTimeout(bot.cortexPollTimer);
  clearTimeout(bot.playbackPollTimer);
}

test('las opciones de playback y comentario de prueba silencian logs e historial de respuestas', () => {
  const search = isolatedSearchOptions('Tema de prueba');
  assert.equal(search.analysis, true);
  assert.equal(search.suppressLog, true);
  assert.equal(search.suppressReplyHistory, true);
  assert.equal(search.allowAliasLearning, false);
  assert.equal(search.updateSelectionState, false);

  const playback = isolatedPlaybackOptions();
  assert.equal(playback.explicitTestPlayback, true);
  assert.equal(playback.suppressLog, true);
  assert.equal(playback.suppressReplyHistory, true);

  const comment = isolatedCommentOptions({ parseOnly: false, liveSimulation: false });
  assert.equal(comment.explicitTestPlayback, true);
  assert.equal(comment.suppressLog, true);
  assert.equal(comment.suppressReplyHistory, true);

  const preview = isolatedCommentOptions({ parseOnly: true, liveSimulation: true, simulationKey: '12' });
  assert.equal(preview.analysis, true);
  assert.equal(preview.isolatedLiveSimulation, false);
  assert.equal(preview.allowAliasLearning, false);
  assert.equal(preview.updateSelectionState, false);
  assert.equal(preview.suppressReplyHistory, true);
});

test('la búsqueda de diagnóstico no reproduce, aprende alias ni guarda historial normal', async t => {
  const fixture = makeBot();
  t.after(() => closeTimers(fixture.bot));
  const result = await fixture.bot.handleMessage({
    type: 'facebook', platform: 'dashboard', chatname: 'Prueba',
    chatmessage: '!tema Tema de prueba', userid: 'test-search', textonly: true
  }, isolatedSearchOptions('Tema de prueba'));

  assert.equal(result.ok, true);
  assert.equal(result.analysis, true);
  assert.equal(fixture.logEntries.length, 0);
  assert.equal(fixture.bot.replyHistory.size, 0);
  assert.equal(fixture.bot.lastGlobalRequestAt, 0);
  assert.equal(fixture.bot.userRequestAt.size, 0);
});

test('una reproducción de prueba no escribe el registro, cooldown ni historial de respuestas normales', async t => {
  const fixture = makeBot();
  t.after(() => closeTimers(fixture.bot));
  const options = { forceQuery: 'Tema de prueba', ...isolatedPlaybackOptions() };
  const result = await fixture.bot.handleMessage({
    type: 'spotify-isolated-test', platform: 'dashboard', chatname: 'Prueba',
    chatmessage: '!tema Tema de prueba', userid: 'test-user', textonly: true
  }, options);

  assert.equal(result.ok, true);
  assert.equal(fixture.logEntries.length, 0);
  assert.equal(fixture.bot.lastGlobalRequestAt, 0);
  assert.equal(fixture.bot.userRequestAt.size, 0);
  assert.equal(fixture.bot.replyHistory.size, 0);
  assert.ok(fixture.replies.every(reply => reply[4] === true));
});

test('una simulación en vivo usa cooldown aislado y no registra respuestas ni interacciones normales', async t => {
  const fixture = makeBot();
  fixture.bot.getRuloEnabled = async () => true;
  t.after(() => closeTimers(fixture.bot));
  const options = isolatedCommentOptions({ liveSimulation: true, simulationCommentId: 'archived-comment', simulationKey: '12', timeScale: 10 });
  const result = await fixture.bot.handleMessage({
    type: 'facebook', platform: 'facebook', chatname: 'Persona archivada',
    chatmessage: '!tema Tema de prueba', userid: 'archived-user', textonly: true
  }, options);

  assert.equal(result.ok, true);
  assert.equal(fixture.logEntries.length, 0);
  assert.equal(fixture.bot.replyHistory.size, 0);
  assert.equal(fixture.bot.lastGlobalRequestAt, 0);
  assert.equal(fixture.bot.userRequestAt.size, 0);
  const simulation = fixture.bot.liveSimulationCooldowns.get('12');
  assert.ok(simulation);
  assert.ok(simulation.lastGlobalRequestAt > 0);
  assert.equal(simulation.userRequestAt.has('archived-user'), true);
});
