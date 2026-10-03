const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, TRACK } = require('./spotify-module-test.js');

async function request(options, inspect) {
  const fixture = loadModule({
    timeScale: 100,
    remote: { skipEnabled: true, skipSeconds: 10, autoContinue: false },
    initialQueue: ['spotify:track:playlist-next'],
    initialPlayer: {
      is_playing: true, progress_ms: 30000,
      item: { uri: 'spotify:track:previous' },
      device: { id: 'd1', name: 'NOTEBOOK-MATI', volume_percent: 70 },
      context: { uri: 'spotify:playlist:original' }
    },
    ...options
  });
  try {
    await fixture.integration.syncSpotifySettings();
    const result = await fixture.integration.runDashboardSpotifyCommand({ type: 'play', query: 'Amar Azul', requester: 'Test' });
    await inspect(fixture.state, result, fixture.integration);
  } finally {
    fixture.dom.window.close();
  }
}

test('el pedido se oye por primera vez desde el segundo configurado y conserva playlist y volumen', async () => {
  await request({}, (state, result) => {
    assert.equal(result.success, true);
    assert.deepEqual(state.audibleStarts, [{ uri: TRACK.uri, position: 10000 }]);
    assert.equal(state.volume, 70);
    assert.equal(state.player.context.uri, 'spotify:playlist:original');
    assert.deepEqual(state.queue, ['spotify:track:playlist-next']);
    assert.deepEqual(state.playerActions, ['queue', 'volume:0', 'next', 'seek', 'volume:70']);
  });
});

test('si ya estaba silenciado no sube el volumen', async () => {
  await request({ initialVolume: 0 }, (state, result) => {
    assert.equal(result.success, true);
    assert.equal(state.volume, 0);
    assert.deepEqual(state.audibleStarts, []);
    assert.equal(state.player.progress_ms, 10000);
  });
});

test('espera la posicion real aunque Spotify acepte el salto antes de aplicarlo', async () => {
  await request({ seekDelayReads: 3 }, (state, result) => {
    assert.equal(result.success, true);
    assert.deepEqual(state.audibleStarts, [{ uri: TRACK.uri, position: 10000 }]);
  });
});

test('reintenta restaurar el volumen si Spotify falla la primera vez', async () => {
  await request({ restoreFailsOnce: true }, (state, result) => {
    assert.equal(result.success, true);
    assert.equal(state.volume, 70);
    assert.equal(state.playerActions.filter(action => action === 'volume:70').length, 2);
  });
});

test('sin salto inicial no modifica el volumen ni agrega una pausa', async () => {
  await request({ remote: { skipEnabled: false, autoContinue: false } }, (state, result) => {
    assert.equal(result.success, true);
    assert.deepEqual(state.playerActions, ['queue', 'next']);
  });
});

for (const direction of ['next', 'previous']) {
  test(`${direction}: los botones de transporte esperan el salto antes de recuperar el volumen`, async () => {
    const handler = state => {
      state.player.item = { uri: TRACK.uri, name: TRACK.name, duration_ms: TRACK.duration_ms };
      state.player.progress_ms = 0;
      state.player.is_playing = true;
      return { success: true };
    };
    const { dom, integration, state } = loadModule({
      timeScale: 100,
      remote: { skipEnabled: true, skipSeconds: 10, autoContinue: false },
      initialPlayer: {
        is_playing: true, progress_ms: 30000,
        item: { uri: 'spotify:track:previous', duration_ms: 200000 },
        device: { id: 'd1', name: 'NOTEBOOK-MATI', volume_percent: 70 },
        context: { uri: 'spotify:playlist:original' }
      },
      onSkip: direction === 'next' ? handler : undefined,
      onPrevious: direction === 'previous' ? handler : undefined
    });
    try {
      await integration.syncSpotifySettings();
      const result = await integration.runDashboardSpotifyCommand({ type: direction, requester: 'Test' });
      assert.equal(result.success, true);
      assert.equal(state.volume, 70);
      assert.deepEqual(state.audibleStarts, [{ uri: TRACK.uri, position: 10000 }], JSON.stringify({ actions: state.playerActions, player: state.player, skips: state.skipCalls, prevs: state.previousCalls }));
      assert.equal(state.player.context.uri, 'spotify:playlist:original');
      assert.equal(state.skipCalls, direction === 'next' ? 1 : 0);
      assert.equal(state.previousCalls || 0, direction === 'previous' ? 1 : 0);
      assert.deepEqual(state.playerActions, ['volume:0', 'seek', 'volume:70']);
    } finally {
      dom.window.close();
    }
  });
}

test('si Spotify rechaza el silencio no avanza la cola', async () => {
  await request({ muteFails: true }, (state, result, integration) => {
    assert.equal(result.success, false);
    assert.equal(state.nextCalls, 0);
    assert.equal(state.volume, 70);
    assert.equal(integration.cortexSilentTransition, false);
  });
});

for (const failure of ['seekFails', 'seekIgnored']) {
  test(`${failure}: pausa el tema y restaura el volumen sin hacer audible la intro`, async () => {
    await request({ [failure]: true }, (state, result, integration) => {
      assert.equal(result.success, false);
      assert.equal(state.volume, 70);
      assert.equal(state.player.is_playing, false);
      assert.deepEqual(state.audibleStarts, []);
      assert.equal(integration.cortexSilentTransition, false);
    });
  });
}
