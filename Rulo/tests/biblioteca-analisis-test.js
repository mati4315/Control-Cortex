/**
 * Pruebas del analisis de inicio/final (Control Cortex/backend/biblioteca/analisis.js).
 * Genera audios REALES con ffmpeg (silencio + tono) y verifica que ffmpeg mida
 * lo que tiene que medir y que la cola de trabajos se comporte bien.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.resolve(__dirname, '..', '..');
const ESQUEMA = path.join(RAIZ, 'Rulo', 'Spotify', 'canciones automatic', 'esquema-music.sql');
const { createAnalisis, calcular } = require(path.join(RAIZ, 'Control Cortex', 'backend', 'biblioteca', 'analisis.js'));

let ok = 0, fallas = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { ok += 1; console.log('OK    ' + nombre); }
  else { fallas += 1; console.log('FALLA ' + nombre + (detalle !== undefined ? ' -- ' + detalle : '')); }
};
const cerca = (valor, esperado, tolerancia) => Math.abs(Number(valor) - esperado) <= (tolerancia === undefined ? 0.25 : tolerancia);

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rulo-analisis-'));
const BASE = path.join(TEMP, 'prueba.db');

function generar(archivo, filtro) {
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', filtro, '-b:a', '128k', archivo], { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.log('  (no se pudo generar ' + path.basename(archivo) + ': ' + error.message + ')');
    return false;
  }
}

// 6 s: silencio (0-1) + tono (1-5) + silencio (5-6)
const conSilencio = path.join(TEMP, 'con-silencio.mp3');
const sinSilencio = path.join(TEMP, 'sin-silencio.mp3');
const todoSilencio = path.join(TEMP, 'todo-silencio.mp3');
const corta = path.join(TEMP, 'corta.mp3');
const rota = path.join(TEMP, 'rota.mp3');
const hayFfmpeg = generar(conSilencio, "aevalsrc='if(gt(t,1)*lt(t,5),0.6*sin(2*PI*440*t),0)':d=6:s=44100");
generar(sinSilencio, 'sine=frequency=440:duration=6');
generar(todoSilencio, "aevalsrc='0':d=6:s=44100");
generar(corta, 'sine=frequency=440:duration=3');
fs.writeFileSync(rota, 'esto no es un mp3');

// Copia aparte: `local_path` es unico, no puede repetirse en dos filas.
const manualArchivo = path.join(TEMP, 'manual.mp3');
try { fs.copyFileSync(conSilencio, manualArchivo); } catch (_) { fs.writeFileSync(manualArchivo, ''); }

const db = new DatabaseSync(BASE);
db.exec(fs.readFileSync(ESQUEMA, 'utf8'));

function agregar(titulo, ruta, duracionMs, estado) {
  const info = db.prepare(`INSERT INTO tracks (title, artist, duration_ms, offline, local_path, analysis_status)
    VALUES (?, 'Prueba', ?, 1, ?, ?)`).run(titulo, duracionMs, ruta, estado || 'pending');
  return Number(info.lastInsertRowid);
}

const idCon = agregar('Con silencio', conSilencio, hayFfmpeg ? 6100 : 0);
const idSin = agregar('Sin silencio', sinSilencio, hayFfmpeg ? 6100 : 0);
const idTodo = agregar('Todo silencio', todoSilencio, hayFfmpeg ? 6100 : 0);
const idCorta = agregar('Corta', corta, hayFfmpeg ? 3100 : 0);
const idRota = agregar('Rota', rota, 60000);
const idManual = agregar('Manual', manualArchivo, hayFfmpeg ? 6100 : 0, 'manual');

const analisis = createAnalisis({ db, puntaSeg: 2, minimoMs: 1000, log: () => {} });

// --- reglas de calculo (sin ffmpeg) ---------------------------------------
{
  const cabeza = { silencios: [{ desde: 0, hasta: 1.03, duracion: 1.03 }], medioDb: -20, maxDb: -3 };
  const cola = { silencios: [{ desde: 1.0, hasta: 2, duracion: 1.0 }], medioDb: -20, maxDb: -3 };
  const r = calcular(6, cabeza, cola, 2);
  check('calculo: salta el silencio inicial', cerca(r.startAt, 1.03), JSON.stringify(r));
  check('calculo: corta en el silencio final', cerca(r.endAt, 5.0), JSON.stringify(r));
  check('calculo: queda valido y sin ambiguedad', r.valido === true && r.ambiguo === false, JSON.stringify(r));

  const sinNada = calcular(6, { silencios: [], medioDb: -12, maxDb: -1 }, { silencios: [], medioDb: -12, maxDb: -1 }, 2);
  check('calculo: sin silencios usa 0 y la duracion', sinNada.startAt === 0 && cerca(sinNada.endAt, 6), JSON.stringify(sinNada));

  const raro = calcular(6, { silencios: [{ desde: 0, hasta: 4, duracion: 4 }], medioDb: -30, maxDb: -5 },
    { silencios: [], medioDb: -30, maxDb: -5 }, 2);
  check('calculo: si el inicio queda raro lo marca ambiguo', raro.ambiguo === true, JSON.stringify(raro));
}

(async () => {
  // --- un analisis real por cancion ---------------------------------------
  const primero = await analisis.analizar(idCon);
  check('analisis: mide el inicio real (' + primero.startAt + ' s)', primero.ok && cerca(primero.startAt, 1, 0.35), JSON.stringify(primero));
  check('analisis: mide el final real (' + primero.endAt + ' s)', primero.ok && cerca(primero.endAt, 5, 0.4), JSON.stringify(primero));
  const filaCon = db.prepare('SELECT * FROM tracks WHERE id = ?').get(idCon);
  check('analisis: guarda start_at/end_at en la base', cerca(filaCon.start_at, 1, 0.35) && cerca(filaCon.end_at, 5, 0.4), JSON.stringify([filaCon.start_at, filaCon.end_at]));
  check('analisis: deja el detalle crudo de ffmpeg', !!filaCon.detalle_analisis && filaCon.detalle_analisis.indexOf('silencios') !== -1, String(filaCon.detalle_analisis).slice(0, 80));
  check('analisis: la cancion queda como completada', filaCon.analysis_status === 'completed', filaCon.analysis_status);

  const segundo = await analisis.analizar(idSin);
  check('analisis: sin silencio no toca nada (0 a duracion)', segundo.ok && segundo.startAt === 0 && cerca(segundo.endAt, 6.1, 0.3), JSON.stringify(segundo));

  const tercero = await analisis.analizar(idTodo);
  const filaTodo = db.prepare('SELECT * FROM tracks WHERE id = ?').get(idTodo);
  check('analisis: una cancion toda muda se marca ambigua', tercero.ok && tercero.ambiguo === true, JSON.stringify(tercero));
  check('analisis: y no deja la cancion vacia', filaTodo.end_at > filaTodo.start_at, JSON.stringify([filaTodo.start_at, filaTodo.end_at]));

  const manual = await analisis.analizar(idManual);
  check('analisis: no pisa lo definido a mano', manual.ok === false && manual.motivo === 'manual', JSON.stringify(manual));

  // Con el minimo bajo (1 s) la cancion corta SI se analiza: no tiene silencios, queda 0 a duracion.
  const cortaResultado = await analisis.analizar(idCorta);
  check('analisis: con el minimo bajo se analiza igual', cortaResultado.ok && cortaResultado.startAt === 0 && cerca(cortaResultado.endAt, 3.1, 0.3), JSON.stringify(cortaResultado));

  const conMinimoNormal = createAnalisis({ db, log: () => {} }).analizar(idCorta);
  check('analisis: con el minimo real (30 s) la corta tampoco se analiza', (await conMinimoNormal).motivo.indexOf('corta') !== -1);

  // --- cola de trabajos ---------------------------------------------------
  db.prepare("UPDATE tracks SET analysis_status = 'pending', start_at = NULL, end_at = NULL WHERE id IN (?, ?, ?)").run(idCon, idSin, idTodo);
  const encolados = analisis.encolarPendientes();
  check('cola: encola las pendientes (una vez cada una)', encolados === 4, String(encolados));
  check('cola: no duplica si se encola de nuevo', analisis.encolarPendientes() === 0);

  const lote = await analisis.procesarLote(10);
  check('cola: procesa el lote sin quemar los reintentos', lote.procesados === 4 && lote.ok === 3 && lote.fallados === 1, JSON.stringify({ procesados: lote.procesados, ok: lote.ok, fallados: lote.fallados }));
  check('cola: la rota vuelve a la cola para el proximo lote', analisis.estado().trabajos.pending === 1, JSON.stringify(analisis.estado()));

  await analisis.procesarLote(1);
  await analisis.procesarLote(1);
  const estadoFinal = analisis.estado();
  check('cola: despues de 3 intentos pasa a revision manual', estadoFinal.trabajos.manual_review === 1, JSON.stringify(estadoFinal));
  const filaRota = db.prepare('SELECT * FROM tracks WHERE id = ?').get(idRota);
  check('cola: la rota queda marcada como fallada en la cancion', filaRota.analysis_status === 'failed', filaRota.analysis_status);

  const filaManual = db.prepare('SELECT analysis_status FROM tracks WHERE id = ?').get(idManual);
  check('cola: la manual no entra en la cola', filaManual.analysis_status === 'manual', filaManual.analysis_status);

  check('estado: cuenta canciones por estado', estadoFinal.canciones.completed === 4 && estadoFinal.canciones.failed === 1 && estadoFinal.canciones.manual === 1, JSON.stringify(estadoFinal.canciones));

  console.log('\n' + ok + '/' + (ok + fallas) + ' pruebas del analisis OK' + (hayFfmpeg ? '' : ' (sin ffmpeg)'));
  db.close();
  try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) { /* nada */ }
  process.exit(fallas ? 1 : 0);
})();
