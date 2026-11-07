'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { streamId, parse, count } = require('../extension/facebook-stats');
const Store = require('../src/facebook-stats');
test('video y Producer identifican la misma transmisión; rechaza otros dominios', () => {
  const id = '2476672296192801';
  for (const url of ['https://www.facebook.com/mati4315/videos/' + id,
    'https://www.facebook.com/live/producer/v2/' + id + '/insights',
    'https://www.facebook.com/watch/?v=' + id]) assert.equal(streamId(url), id);
  assert.equal(streamId('https://facebook.com.evil.test/videos/' + id), '');
  assert.equal(streamId('https://www.facebook.com/live/producer/'), '');
});
test('la captura suministrada distingue cero actuales, máximo 1 y comentarios 21', () => {
  const m = parse('Estadísticas\nEspectadores actuales\n0\nNúmero máximo de espectadores\n1\nIngresos estimados\n--\nReacciones totales\n0\nTotal de comentarios\n21\nTotal de veces compartido\n0\nReproducciones de 3 segundos\n5\nReproducciones de 15 segundos\n2\nReproducciones de 60 segundos\n1\nEstrellas enviadas\n0\nRemitentes únicos\n0');
  assert.deepEqual(m, { currentViewers: 0, peakViewers: 1, reactions: 0, comments: 21, shares: 0, views3s: 5, views15s: 2, views60s: 1, stars: 0, starSenders: 0 });
  assert.deepEqual(parse('Espectadores actuales\n--\nNúmero máximo de espectadores\n8'), { peakViewers: 8 });
  assert.equal(count('2476672296192801'), null);
});
test('Insights tiene prioridad; no duplica pestañas, expira y conserva el cero', () => {
  const store = new Store();
  const id = '2476672296192801';
  store.update(id, 'video', { currentViewers: 3, tabId: 123, streamId: 999 }, 'Cuenta', 100);
  store.update(id, 'insights', { currentViewers: 0, peakViewers: 3 }, 'Cuenta', 200);
  store.update(id, 'video', { currentViewers: 4 }, 'Cuenta', 300);
  assert.equal(store.snapshot(400).length, 1);
  assert.equal(store.snapshot(400)[0].metrics.currentViewers, 0);
  assert.equal(store.snapshot(400)[0].metrics.tabId, undefined);
  assert.equal(store.snapshot(90250)[0].metrics.currentViewers, 4);
  assert.equal(store.snapshot(90400)[0].fresh, false);
});
test('suma transmisiones distintas, no identificadores ni máximos', () => {
  const store = new Store();
  store.update('11111111', 'insights', { currentViewers: 1, peakViewers: 100, comments: 4 });
  store.update('11111111', 'video', { currentViewers: 5 });
  store.update('22222222', 'insights', { currentViewers: 2, comments: 3, tabId: 900000 });
  assert.deepEqual(store.totals(), { currentViewers: 3, comments: 7 });
});
