'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RuloEvaluationSuite = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function buildEvaluationPayload(item, useProjectContext = true) {
    const caseId = String(item?.id || '').trim().slice(0, 80);
    const program = String(item?.programNumber || '').trim();
    const question = String(item?.question || '').trim().slice(0, 500);
    const participantCommentId = String(item?.participantCommentId || '').trim();
    if (!caseId || !/^\d{1,30}$/.test(program) || !question) throw new Error('El caso necesita ID, programa y pregunta válidos.');
    if (participantCommentId && !/^\d{1,30}$/.test(participantCommentId)) throw new Error('La persona seleccionada para el caso no es válida.');
    return {
      program,
      participantCommentId,
      comment: question,
      messages: [{ role: 'user', content: question }],
      disabledModules: ['obs'],
      useProjectContext: useProjectContext === true,
      spotifyMode: 'preview',
      timeScale: 1,
      simulationCaseId: caseId
    };
  }

  async function runEvaluationSuite(items, { program = '', useProjectContext = true, simulate, onProgress, maxCases = 30 } = {}) {
    if (typeof simulate !== 'function') throw new Error('Falta la función para ejecutar la simulación.');
    const selectedProgram = String(program || '').trim();
    const cases = (Array.isArray(items) ? items : []).filter(item => !selectedProgram || String(item?.programNumber) === selectedProgram);
    if (!cases.length) return [];
    if (cases.length > Math.max(1, Math.min(100, Number(maxCases) || 30))) throw new Error(`La suite supera el límite de ${maxCases} casos por ejecución.`);
    const results = [];
    for (let index = 0; index < cases.length; index += 1) {
      const item = cases[index];
      let result;
      try {
        const payload = buildEvaluationPayload(item, useProjectContext);
        const response = await simulate(payload);
        if (!response || response.ok !== true || !String(response.answer || '').trim()) throw new Error(response?.error || 'Rulo no devolvió una respuesta.');
        result = { caseId: item.id, title: String(item.title || '').slice(0, 120), ok: true, answer: String(response.answer).slice(0, 4000), provider: String(response.provider || '').slice(0, 40), model: String(response.model || '').slice(0, 120), action: String(response.action || '').slice(0, 60) };
      } catch (error) {
        result = { caseId: item?.id || '', title: String(item?.title || '').slice(0, 120), ok: false, error: String(error?.message || 'No se pudo ejecutar el caso.').slice(0, 300) };
      }
      results.push(result);
      if (typeof onProgress === 'function') onProgress({ index: index + 1, total: cases.length, item, result });
    }
    return results;
  }

  return { buildEvaluationPayload, runEvaluationSuite };
});
