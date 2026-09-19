// Pruebas del historial de analisis en SQLite (Control Cortex/backend/spotify-analytics.js):
// que guarde las preguntas y las respuestas con todos los datos (incluido si uso IA),
// que el resumen sirva para buscar mejoras y que el CSV salga bien.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAnalytics, CAMPOS } = require('D:/plugins para mi OBS/Control Cortex/backend/spotify-analytics.js');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rulo-analytics-'));
const dbPath = path.join(tempDir, 'spotify-analytics.db');
const avisos = [];
const analytics = createAnalytics({ filePath: dbPath, session: 'SESION-1', log: m => avisos.push(m) });

check('sqlite: se abre y queda habilitado', analytics.enabled === true, analytics.enabled);
check('sqlite: crea el archivo', fs.existsSync(dbPath), dbPath);

// ---------- A) una interaccion completa: pedido + respuesta ----------
{
  const guardado = analytics.recordInteraction({
    source: 'chat',
    platform: 'youtube',
    requester: 'Mati',
    requesterId: 'u123',
    comment: 'che poneme un temita de la beriso',
    isRequest: true,
    parsedSource: 'natural',
    artist: 'la beriso',
    query: 'artist:la beriso',
    status: 'played',
    reason: 'Listo Mati, ya se esta reproduciendo: Como Olvidarme - La Beriso',
    aiInterpreted: false,
    replyText: 'Listo Mati, ya se esta reproduciendo: Como Olvidarme - La Beriso',
    replyContext: 'ok',
    replyVariant: 'Listo {nombre}, ya se esta reproduciendo: {tema} - {artista}',
    replyRandom: true,
    replyAi: false,
    trackName: 'Como Olvidarme',
    trackArtist: 'La Beriso',
    trackUri: 'spotify:track:abc',
    durationMs: 620
  });
  check('sqlite: guarda la interaccion', guardado === true, guardado);

  // ---------- B) una rechazada y una que uso la IA ----------
  analytics.recordInteraction({
    source: 'chat',
    requester: 'Ana',
    comment: 'un tema de gladis',
    isRequest: true,
    status: 'wait_user',
    ok: false,
    seconds: 42,
    replyContext: 'waitUser',
    replyText: 'Ana, ya te puse uno hace un rato: espera 42s mas.',
    replyAi: false
  });
  analytics.recordInteraction({
    source: 'chat',
    requester: 'Leo',
    comment: 'pasame lo del tano',
    status: 'played',
    ok: true,
    aiInterpreted: true,
    aiModel: 'deepseek-flash',
    replyContext: 'ok',
    replyVariant: 'Toma {nombre}, ahi te lo puse: {tema} - {artista}',
    replyAi: true,
    trackName: 'Yo Tomo Licor'
  });
  analytics.recordInteraction({
    source: 'chat',
    requester: 'Sofi',
    comment: 'un tema de los palmeras',
    isRequest: true,
    status: 'notfound',
    ok: false,
    replyContext: 'notFound',
    query: 'palmeras',
    replyText: 'No me aparece "un tema de los palmeras" en Spotify...'
  });
  analytics.recordEvent('ai_replies', { context: 'ok', variants: 3 }, 'deepseek-flash');
  analytics.recordEvent('vocabulary_saved', { respuestas: 20, variantes: 75 });
  analytics.recordEvent('alias_learned', { from: 'laberiso', to: 'la beriso' });
}

// ---------- C) resumen ----------
{
  const stats = analytics.stats(7);
  check('resumen: cuenta todas las interacciones', stats.total === 4, stats.total);
  check('resumen: cuenta los pedidos de musica', stats.pedidos === 3, stats.pedidos);
  check('resumen: cuenta las reproducidas', stats.reproducidas === 2, stats.reproducidas);
  check('resumen: cuenta las no encontradas', stats.noEncontradas === 1, stats.noEncontradas);
  check('resumen: cuenta las rechazadas por espera', stats.rechazadas === 1, stats.rechazadas);
  check('resumen: cuenta las interpretadas por la IA', stats.conIaInterpretando === 1, stats.conIaInterpretando);
  check('resumen: cuenta las respondidas con texto de IA', stats.conIaRespondiendo === 1, stats.conIaRespondiendo);
  // Leo es una sola interaccion en la que la IA interpreto y ademas la respuesta era de IA.
  check('resumen: cuenta las que usaron IA de una u otra forma', stats.conIaCualquiera === 1, stats.conIaCualquiera);
  check('resumen: estados agrupados', stats.porEstado.length === 3 && stats.porEstado.some(e => e.status === 'played' && e.n === 2), JSON.stringify(stats.porEstado));
  check('resumen: plataformas', stats.porPlataforma.some(p => p.platform === 'youtube' && p.n === 1), JSON.stringify(stats.porPlataforma));
  check('resumen: artistas pedidos', stats.topArtistas.some(a => /beriso/i.test(a.artist || '')), JSON.stringify(stats.topArtistas));
  check('resumen: que pidieron y no se encontro (lo mas util para entrenar)', stats.noEncontradasDetalle.length === 1 && /palmeras/.test(stats.noEncontradasDetalle[0].comment), JSON.stringify(stats.noEncontradasDetalle));
  check('resumen: eventos registrados', stats.eventos.length === 3 && stats.eventos.some(e => e.type === 'ai_replies' && e.n === 1), JSON.stringify(stats.eventos));
  check('resumen: horas del dia', stats.porHora.length >= 1, JSON.stringify(stats.porHora));
  check('resumen: ultima actividad marcada', typeof stats.ultimaActividad === 'number' && stats.ultimaActividad > 0, stats.ultimaActividad);
  check('resumen: el filtro de dias no rompe', analytics.stats(0).total === 4 && analytics.stats(99999).total === 4, 'raro');
}

// ---------- D) filas para inspeccionar ----------
{
  const filas = analytics.rows({ dias: 7, limite: 10 });
  check('filas: devuelve lo guardado con el comentario', filas.length === 4 && filas[0].comment, JSON.stringify(filas[0] && filas[0].comment));
  check('filas: trae la respuesta y su contexto', filas.some(f => f.reply_context === 'notFound' && f.reply_text), 'falta la respuesta');
  check('filas: el flag de IA quedo guardado', filas.some(f => f.ai_interpreted === 1 && f.ai_model === 'deepseek-flash'), 'falta el flag');
  check('filas: el flag de respuesta de IA quedo guardado', filas.some(f => f.reply_ai === 1), 'falta reply_ai');
  check('filas: se puede filtrar por estado', analytics.rows({ dias: 7, estado: 'notfound' }).length === 1, analytics.rows({ dias: 7, estado: 'notfound' }).length);
  check('filas: respeta el limite', analytics.rows({ dias: 7, limite: 2 }).length === 2, 'no respeto el limite');
}

// ---------- E) CSV ----------
{
  const csv = analytics.csv(7);
  const lineas = csv.trim().split('\r\n');
  check('csv: tiene encabezado con todas las columnas', lineas[0] === CAMPOS.join(','), lineas[0].slice(0, 60));
  check('csv: una linea por interaccion', lineas.length === 5, lineas.length);
  check('csv: escapa las comas y las comillas', csv.indexOf('"Listo Mati, ya se esta reproduciendo') !== -1, 'no escapo');
  check('csv: incluye la columna reply_ai', lineas[0].indexOf('reply_ai') !== -1, 'falta');
}

// ---------- F) no se pierde nada al reabrir ----------
{
  analytics.close();
  const otra = createAnalytics({ filePath: dbPath, session: 'SESION-2', log: m => avisos.push(m) });
  check('sqlite: al reabrir sigue todo', otra.stats(7).total === 4, otra.stats(7).total);
  otra.recordInteraction({ comment: 'otra mas', status: 'played', ok: true });
  check('sqlite: se puede seguir escribiendo en la misma base', otra.stats(7).total === 5, otra.stats(7).total);
  otra.close();
}

// ---------- G) sin base disponible no rompe ----------
{
  const sinBase = createAnalytics({ filePath: path.join(tempDir, 'no', 'existe', 'x.db'), session: 'S', log: m => avisos.push(m) });
  check('sqlite: si el archivo no se puede abrir, no rompe', sinBase.recordInteraction({ comment: 'x' }) === false || sinBase.enabled === true, 'rompio');
  const resumenSinBase = sinBase.stats(7);
  check('sqlite: sin base el resumen no explota', resumenSinBase === null || typeof resumenSinBase.total === 'number', 'rompio');
  check('sqlite: sin base el csv no explota', typeof sinBase.csv(7) === 'string', 'rompio');
  sinBase.close();
}

try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (error) { /* sqlite puede tardar en soltar el archivo */ }

const failed = results.filter(item => !item.ok);
results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
console.log(`\n${results.length - failed.length}/${results.length} pruebas del historial SQLite OK`);
process.exit(failed.length ? 1 : 0);
