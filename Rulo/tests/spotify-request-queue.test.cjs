const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, TRACK, wait, waitFor, jsonResponse } = require('./spotify-module-test.js');

async function fixture(options = {}) {
  const f = loadModule({
    ...options,
    remote: { autoContinue: false, ...options.remote },
    search: query => {
      const n = Number((query.match(/\d+/) || [1])[0]);
      return { ...TRACK, id: 't' + n, uri: 'spotify:track:t' + n, name: 'Cancion ' + n };
    }
  });
  f.integration.cortexSyncTimer = -1; // No background polling in these isolated tests.
  await f.integration.syncSpotifySettings();
  return f;
}
const send = (f, n, requester = 'Usuario ' + n) => f.integration.runDashboardSpotifyCommand({
  type: 'play', query: 'Cancion ' + n, requester
});
const played = f => f.state.plays.map(p => Number(p.uri.split('t').pop()));

for (const [count, expected] of [[6, [1, 2, 3, 4, 5, 6]], [10, [1, 2, 3, 8, 9, 10]]]) {
  test(`${count} pedidos conservan la tanda y los ultimos tres`, async t => {
    const gates = [];
    const f = await fixture({ onSpeechStart: () => new Promise(resolve => {
      gates.push(() => resolve(jsonResponse({ started: true, triggerId: 'speech-' + gates.length, delayMs: 0 })));
    }) });
    t.after(() => f.dom.window.close());
    const promises = [send(f, 1)];
    assert.notEqual(await waitFor(() => gates.length === 1, 1000, 5), -1);
    for (let n = 2; n <= count; n++) promises.push(send(f, n));
    for (let index = 0; index < expected.length; index++) {
      assert.notEqual(await waitFor(() => gates.length > index, 2000, 5), -1);
      gates[index]();
    }
    const results = await Promise.all(promises);
    assert.deepEqual(played(f), expected);
    assert.equal(results.filter(r => r.skipped).length, count - expected.length);
    assert.equal(f.state.cortexCalls.filter(c => c.url.includes('/api/rulo-bot-message') && !c.body.provisional).length, expected.length);
  });
}

test('diez pedidos nuevos durante el segundo: termina 1,2,3 y sigue 14,15,16', async t => {
  const gates = [];
  const f = await fixture({ onSpeechStart: () => new Promise(resolve => {
    gates.push(() => resolve(jsonResponse({ started: true, triggerId: 'speech-' + gates.length, delayMs: 0 })));
  }) });
  t.after(() => f.dom.window.close());
  const promises = Array.from({ length: 6 }, (_, i) => send(f, i + 1));
  assert.notEqual(await waitFor(() => gates.length === 1, 1000, 5), -1);
  gates[0]();
  assert.notEqual(await waitFor(() => gates.length === 2, 2000, 5), -1);
  for (let n = 7; n <= 16; n++) promises.push(f.integration.handleCommand('!tema Cancion ' + n, { chatname: 'Usuario ' + n, type: 'youtube' }));
  for (let index = 1; index < 6; index++) {
    assert.notEqual(await waitFor(() => gates.length > index, 2000, 5), -1);
    gates[index]();
  }
  await Promise.all(promises);
  assert.deepEqual(played(f), [1, 2, 3, 14, 15, 16]);
  assert.equal(f.integration.cortexMusicQueue.running, false);
});

test('40s globales y 60s por usuario tambien para streamer y simulaciones', async t => {
  const f = await fixture({ timeScale: 1000, remote: { cooldownSeconds: 40, userCooldownSeconds: 60 } });
  t.after(() => f.dom.window.close());
  await send(f, 1);
  await f.integration.handleCommand('!tema Cancion 2', { chatname: 'Mati', type: 'youtube', host: true });
  await f.integration.handleCommand('!tema Cancion 3', { chatname: 'Mati', type: 'youtube', mod: true });
  await f.integration.runDashboardSpotifyCommand({ type: 'simulate', comment: '!tema Cancion 4', requester: 'Simulado' });
  await f.integration.runDashboardSpotifyCommand({ type: 'simulate', comment: '!tema Cancion 5', requester: 'Simulado' });
  const times = f.state.plays.map(p => p.at);
  assert.equal(times.length, 5);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 40000);
  assert.ok(times[2] - times[1] >= 60000);
  assert.ok(times[4] - times[3] >= 60000);
});

test('cambiar espera en vivo libera el pedido; modo prueba permite omitirla', async t => {
  const f = await fixture({ remote: { cooldownSeconds: 40, userCooldownSeconds: 60 } });
  t.after(() => f.dom.window.close());
  await send(f, 1, 'Mati');
  const second = send(f, 2, 'Mati');
  await wait(80);
  assert.equal(f.state.plays.length, 1);
  f.state.settings = { ...f.state.settings, testMode: true };
  await f.integration.syncSpotifySettings();
  assert.notEqual(await waitFor(() => f.state.plays.length === 2, 2000, 5), -1);
  await second;
});

test('apagar Rulo cancela los pedidos pendientes sin cambiar musica', async t => {
  let release;
  const f = await fixture({ onSpeechStart: () => new Promise(resolve => { release = () => resolve(jsonResponse({ started: true, triggerId: 'off', delayMs: 0 })); }) });
  t.after(() => f.dom.window.close());
  const promises = Array.from({ length: 10 }, (_, i) => send(f, i + 1));
  assert.notEqual(await waitFor(() => release, 1000, 5), -1);
  f.state.settings = { ...f.state.settings, ruloEnabled: false };
  await f.integration.syncSpotifySettings();
  release();
  await Promise.all(promises);
  assert.equal(f.state.plays.length, 0);
  assert.equal(f.integration.cortexMusicQueue.running, false);
});

test('la tanda 14,15,16 permanece completa cuando llegan mas pedidos', async t => {
  const gates = [];
  const f = await fixture({ timeScale: 100, onSpeechStart: () => new Promise(resolve => {
    gates.push(() => resolve(jsonResponse({ started: true, triggerId: 'speech-' + gates.length, delayMs: 0 })));
  }) });
  t.after(() => f.dom.window.close());
  const promises = Array.from({ length: 16 }, (_, i) => send(f, i + 1));
  for (let index = 0; index < 9; index++) {
    assert.notEqual(await waitFor(() => gates.length > index, 2000, 5), -1);
    if (index === 3) for (let n = 17; n <= 25; n++) promises.push(send(f, n));
    gates[index]();
  }
  await Promise.all(promises);
  assert.deepEqual(played(f), [1, 2, 3, 14, 15, 16, 23, 24, 25]);
});

test('el poll recibe nuevos pedidos mientras Habla aun espera su primer fotograma', async t => {
  let release;
  const f = loadModule({
    remote: { pollSeconds: 1, autoContinue: false },
    command: { id: 'one', type: 'play', query: 'Cancion 1' },
    onSpeechStart: () => new Promise(resolve => { release = () => resolve(jsonResponse({ started: true, triggerId: 'first', delayMs: 0 })); })
  });
  t.after(() => f.dom.window.close());
  await f.integration.initialize();
  assert.notEqual(await waitFor(() => release, 1000, 5), -1);
  f.state.pendingCommand = { id: 'two', type: 'play', query: 'Cancion 2' };
  assert.notEqual(await waitFor(() => f.state.claimedCommands.has('two'), 2500, 5), -1);
  assert.equal(f.state.plays.length, 0);
  f.state.settings = { ...f.state.settings, ruloEnabled: false };
  await f.integration.syncSpotifySettings();
  release();
  assert.notEqual(await waitFor(() => !f.integration.cortexMusicQueue.running, 1000, 5), -1);
  assert.equal(f.state.plays.length, 0);
});
