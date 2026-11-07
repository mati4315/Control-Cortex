'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventTraceStore } = require('../event-trace-store');

test('registra etapas consultables por traceId y devuelve lo más reciente primero', () => {
  const store = new EventTraceStore(20);
  store.record({ traceId: 'trace-0001', component: 'chat-bot-spotify', stage: 'capture.received', status: 'ok', details: { source: 'facebook' } });
  store.record({ traceId: 'trace-0001', component: 'cortex', stage: 'comment.archived', status: 'ok', details: { result: 'stored' } });
  store.record({ traceId: 'trace-0002', component: 'spotify', stage: 'request.result', status: 'failed', details: { result: 'no_device' } });
  assert.deepEqual(store.list({ traceId: 'trace-0001' }).map(event => event.stage), ['comment.archived', 'capture.received']);
  assert.equal(store.list({ limit: 1 })[0].traceId, 'trace-0002');
});

test('descarta texto libre para evitar que comentarios o identidades entren a la traza', () => {
  const store = new EventTraceStore();
  const event = store.record({
    traceId: 'trace-0002', component: 'cortex', stage: 'comment.received', status: 'ok',
    details: { source: 'facebook', comment: 'texto privado', requester: 'persona', userId: 'id-privado', result: 'accepted' }
  });
  assert.deepEqual(event.details, { source: 'facebook', result: 'accepted' });
  assert.equal(JSON.stringify(event).includes('texto privado'), false);
  assert.equal(JSON.stringify(event).includes('persona'), false);
  assert.equal(store.record({ traceId: 'trace-0002', component: 'admin', stage: 'comment.received', status: 'ok' }), null);
});

test('limita el búfer y rechaza filtros de traceId inválidos', () => {
  const store = new EventTraceStore(20);
  for (let index = 0; index < 25; index++) store.record({ traceId: `trace-${String(index).padStart(4, '0')}`, component: 'cortex', stage: 'comment.received', status: 'ok' });
  assert.equal(store.list({ limit: 500 }).length, 20);
  assert.deepEqual(store.list({ traceId: 'invalid spaces' }), []);
});
