import io

p = 'D:/plugins para mi OBS/Rulo/tests/spotify-dashboard-test.js'
s = io.open(p, encoding='utf-8', newline='').read()

# 1) mock del resumen de analisis
old = """        if (target.indexOf('/api/spotify-status') !== -1) {"""
new = """        if (target.indexOf('/api/spotify-analytics-reviewed') !== -1) {
          return json({ ok: true, marcadas: 12 });
        }
        if (target.indexOf('/api/spotify-analytics') !== -1) {
          return json({
            ok: true,
            analytics: {
              enabled: true,
              filePath: 'D:/rulo/spotify-analytics.db',
              total: 40,
              pedidos: 30,
              reproducidas: 22,
              noEncontradas: 6,
              rechazadas: 2,
              conIaInterpretando: 4,
              conIaRespondiendo: 6,
              conIaCualquiera: 8,
              porEstado: [],
              noEncontradasDetalle: [{ comment: 'un tema de los palmeras', query: 'palmeras', iso: new Date().toISOString() }],
              topPedidosRepetidos: [{ comment: 'un tema de los palmeras', n: 3 }],
              topArtistas: [{ artist: 'La Beriso', n: 5 }],
              topCanciones: [{ track_name: 'Como Olvidarme', track_artist: 'La Beriso', veces: 5, puestas: 4, continuaciones: 1, saltadas: 1 }],
              saltadas: [{ track_name: 'Otra', status: 'skipped', since_play_ms: 42000, iso: new Date().toISOString() }],
              tasaSalteo: { puestas: 4, saltadas: 1, porcentaje: 25 },
              respuestas: [],
              eventos: [],
              avisos: [{ nivel: 'warn', codigo: 'tasa_no_encontradas', mensaje: 'No se encontro el 20% de los pedidos.' }],
              recordatorio: { pendientes: 12, nuevosNoEncontrados: 4, ultimaRevision: Date.now() - 86400000, diasEsperando: 3 }
            }
          });
        }
        if (target.indexOf('/api/spotify-ai-suggest') !== -1) {
          if (opts.suggestError) return json({ ok: false, error: 'El cerebro (IA) esta apagado. Activalo en Entrenamiento -> Cerebro (IA).' });
          return json({ ok: true, analizados: 3, sugerencias: [
            { comentario: 'un tema de los palmeras', problema: 'esta mal escrito el grupo', tipo: 'alias', de: 'los palmeras', a: 'palmeras', confianza: 0.8 },
            { comentario: 'poneme un temita', problema: 'no conoce la palabra', tipo: 'palabra', de: 'temita', a: '', confianza: 0.6 }
          ] });
        }
        if (target.indexOf('/api/spotify-aliases') !== -1 && (config.method || 'GET') === 'POST') {
          return json({ success: true, entry: { from: body && body.from, to: body && body.to } });
        }
        if (target.indexOf('/api/spotify-status') !== -1) {"""
assert old in s, 'mock analytics'
s = s.replace(old, new, 1)

# 2) el estado trae el recordatorio
old2 = """          return json({ ok: true, settings: {}, client: state.client, devices: { devices: [] }, log: state.log,"""
new2 = """          return json({ ok: true, analytics: { pendientes: 12, nuevosNoEncontrados: 4 }, settings: {}, client: state.client, devices: { devices: [] }, log: state.log,"""
assert old2 in s, 'mock status'
s = s.replace(old2, new2, 1)

# 3) pruebas nuevas
old3 = """  // ---------- Resultado ----------"""
new3 = """  // ---------- N) analisis: recordatorio, avisos, canciones y sugerencias de IA ----------
  {
    const { dom, doc, calls } = makePage({});
    await wait(400);
    check('analisis: consulta el resumen', calls.some(call => call.url.indexOf('/api/spotify-analytics?dias=') !== -1), calls.map(call => call.url).filter(u => u.indexOf('analytics') !== -1).slice(0, 2).join(' | '));
    check('analisis: chip con lo que falta revisar', /12 sin revisar/.test(doc.getElementById('stAnalisis').textContent) && doc.getElementById('stAnalisis').className.indexOf('is-warn') !== -1, doc.getElementById('stAnalisis').textContent);
    check('analisis: recordatorio en la tarjeta', /Recordatorio:/.test(doc.getElementById('anAvisos').innerHTML) && /12 interacciones nuevas/.test(doc.getElementById('anAvisos').innerHTML), doc.getElementById('anAvisos').textContent.slice(0, 90));
    check('analisis: muestra los avisos', /20% de los pedidos/.test(doc.getElementById('anAvisos').innerHTML), doc.getElementById('anAvisos').textContent.slice(0, 80));
    check('analisis: chips con numeros', /Reproducidas: <strong>22/.test(doc.getElementById('anPlayed').innerHTML), doc.getElementById('anPlayed').textContent);
    check('analisis: dice cuantas usaron IA', /4 \\/ respondio 6|4 \\/ respondi\u00f3 6/.test(doc.getElementById('anIa').innerHTML), doc.getElementById('anIa').textContent);
    check('analisis: canciones que puso Rulo', /Como Olvidarme/.test(doc.getElementById('anCanciones').textContent) && /1 saltadas/.test(doc.getElementById('anCanciones').textContent), doc.getElementById('anCanciones').textContent);
    check('analisis: lo que se salto', /Otra/.test(doc.getElementById('anSaltadas').textContent) && /a los 42s/.test(doc.getElementById('anSaltadas').textContent), doc.getElementById('anSaltadas').textContent);
    check('analisis: tasa de salteo', /se saltaron 1 \\(25%\\)/.test(doc.getElementById('anTasaSalteo').textContent), doc.getElementById('anTasaSalteo').textContent);

    doc.getElementById('btnAnSugerir').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(300);
    const sugerir = calls.filter(call => call.url.indexOf('/api/spotify-ai-suggest') !== -1);
    check('analisis: pide sugerencias con los dias elegidos', sugerir.length === 1 && sugerir[0].body.dias === 7, JSON.stringify(sugerir[0] && sugerir[0].body));
    const lista = doc.getElementById('anSugerencias');
    check('analisis: muestra las sugerencias', /los palmeras/.test(lista.textContent) && /correcci/.test(lista.textContent), lista.textContent.slice(0, 100));
    check('analisis: las dos se pueden aplicar', lista.querySelectorAll('[data-aplicar]').length === 2, lista.querySelectorAll('[data-aplicar]').length);

    doc.querySelector('[data-aplicar="0"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(200);
    const alias = calls.filter(call => call.url.indexOf('/api/spotify-aliases') !== -1 && call.method === 'POST');
    check('analisis: aplicar manda la correccion', alias.length === 1 && alias[0].body.from === 'los palmeras' && alias[0].body.to === 'palmeras', JSON.stringify(alias[0] && alias[0].body));

    doc.getElementById('btnAnReviewed').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(200);
    check('analisis: se puede marcar como revisado', calls.some(call => call.url.indexOf('/api/spotify-analytics-reviewed') !== -1 && call.method === 'POST'), 'faltaba');
    dom.window.close();
  }

  {
    const { dom, doc } = makePage({ suggestError: true });
    await wait(300);
    doc.getElementById('btnAnSugerir').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(300);
    check('analisis: avisa si el cerebro esta apagado', /cerebro/.test(doc.getElementById('anSugerencias').textContent), doc.getElementById('anSugerencias').textContent.slice(0, 90));
    dom.window.close();
  }

  // ---------- Resultado ----------"""
assert old3 in s, 'pruebas'
s = s.replace(old3, new3, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('pruebas del dashboard de analisis agregadas')
