'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEvaluationPayload, runEvaluationSuite } = require('../../frontend/rulo-evaluation-suite');

test('la suite conserva programa y participante, y fuerza vista previa sin OBS', () => {
  const payload = buildEvaluationPayload({ id: 'case-001', programNumber: '42', participantCommentId: '17', question: '¿Qué pasó con el sorteo?' }, true);
  assert.equal(payload.program, '42');
  assert.equal(payload.participantCommentId, '17');
  assert.equal(payload.spotifyMode, 'preview');
  assert.deepEqual(payload.disabledModules, ['obs']);
  assert.equal(payload.timeScale, 1);
  assert.equal(payload.simulationCaseId, 'case-001');
  assert.deepEqual(payload.messages, [{ role: 'user', content: '¿Qué pasó con el sorteo?' }]);
});

test('ejecuta casos en orden, continúa ante un fallo y conserva resultados pendientes de revisión', async () => {
  const cases = [
    { id: 'case-001', title: 'Primero', programNumber: '42', question: 'Pregunta 1' },
    { id: 'case-002', title: 'Segundo', programNumber: '42', question: 'Pregunta 2' },
    { id: 'case-003', title: 'Otro programa', programNumber: '43', question: 'Pregunta 3' }
  ];
  const payloads = [], progress = [];
  const results = await runEvaluationSuite(cases, {
    program: '42',
    simulate: async payload => {
      payloads.push(payload);
      if (payload.simulationCaseId === 'case-002') throw new Error('proveedor no disponible');
      return { ok: true, answer: 'Respuesta de prueba', provider: 'openai', model: 'modelo-test' };
    },
    onProgress: item => progress.push(item.index)
  });
  assert.deepEqual(results.map(item => item.ok), [true, false]);
  assert.deepEqual(progress, [1, 2]);
  assert.deepEqual(payloads.map(item => item.simulationCaseId), ['case-001', 'case-002']);
  assert.ok(payloads.every(item => item.spotifyMode === 'preview' && item.disabledModules.includes('obs')));
  assert.equal(results[0].provider, 'openai');
  assert.match(results[1].error, /proveedor no disponible/);
});

test('rechaza casos incompletos y suites por encima del límite', async () => {
  assert.throws(() => buildEvaluationPayload({ id: 'case-1', programNumber: 'x', question: 'Pregunta' }), /válidos/);
  await assert.rejects(runEvaluationSuite(Array.from({ length: 3 }, (_, index) => ({ id: `case-${index}`, programNumber: '42', question: 'Pregunta' })), { program: '42', maxCases: 2, simulate: async () => ({ ok: true, answer: 'ok' }) }), /supera el límite/);
});
