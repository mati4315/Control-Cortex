/**
 * Prueba del esquema de la biblioteca musical.
 *
 *   node "Rulo/Spotify/canciones automatic/probar-esquema.js"
 *
 * Corre TODO sobre una base temporal (no toca spotify-analytics.db):
 *   1. aplica esquema-music.sql dos veces (tiene que ser idempotente);
 *   2. carga 3.000 canciones de prueba: mide el costo real de las consultas clave;
 *   3. verifica la regla "en automático no se repite el mismo día" (y que manual sí puede);
 *   4. comprueba que las consultas usan índices y no recorren toda la tabla.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SQL = path.join(__dirname, 'esquema-music.sql');
const TEMPORAL = path.join(os.tmpdir(), 'rulo-esquema-prueba.db');
for (const sufijo of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(TEMPORAL + sufijo); } catch (_) { /* no existía */ }
}

let ok = 0, fallas = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { ok += 1; console.log('OK    ' + nombre); }
  else { fallas += 1; console.log('FALLA ' + nombre + (detalle ? ' -- ' + detalle : '')); }
};
const medir = fn => { const t = process.hrtime.bigint(); const r = fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, r }; };

const db = new DatabaseSync(TEMPORAL);
const esquema = fs.readFileSync(SQL, 'utf8');

db.exec(esquema);
const tablas1 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tracks','lyrics','play_history','analysis_jobs')").all().length;
db.exec(esquema);   // segunda vez: no debe fallar ni duplicar nada
const tablas2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tracks','lyrics','play_history','analysis_jobs')").all().length;
const indices = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all().length;

check('esquema: se aplica y crea las 4 tablas', tablas1 === 4, String(tablas1));
check('esquema: aplicarlo dos veces no duplica nada (idempotente)', tablas2 === 4, String(tablas2));
check('esquema: crea los índices', indices >= 9, String(indices));
check('esquema: las vistas existen', !!db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='v_biblioteca_resumen'").get());

// ---- 3.000 canciones de prueba --------------------------------------------
const TOTAL = 3000;
// Letra de ejemplo con forma realista (60 líneas de largo real, como las que
// devuelve LRCLIB o la caché de Spotify): sirve para medir el espacio real.
const LETRA_EJEMPLO = JSON.stringify(Array.from({ length: 60 }, (_, i) => ({
  startMs: i * 4200,
  endMs: i * 4200 + 3900,
  text: 'Y el tiempo se escurrió cantando esta canción de amor (' + i + ')'
})));
const insertarTrack = db.prepare(`INSERT INTO tracks (spotify_track_id, title, artist, album, duration_ms, offline, local_path, file_size, file_mtime, start_at, end_at, analysis_status)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`);
const insertarLetra = db.prepare(`INSERT INTO lyrics (track_id, source, language, synced, provider, duration_ms, lines_json) VALUES (?, 'lrclib', 'es', 1, 'LRCLIB', ?, ?)`);
const marcarReproducida = db.prepare(`INSERT OR IGNORE INTO play_history (track_id, played_date, play_mode) VALUES (?, ?, 'auto')`);
const hoy = new Date().toISOString().slice(0, 10);

const carga = medir(() => {
  db.exec('BEGIN');
  for (let i = 1; i <= TOTAL; i += 1) {
    const info = insertarTrack.run('id' + String(i).padStart(20, '0'), 'Cancion ' + i, 'Artista ' + (i % 400), 'Album ' + (i % 900),
      180000 + (i % 60) * 1000, 'C:/musica/tema' + i + '.mp3', 3_500_000 + i, 1_700_000_000 + i, 0, 185.5,
      i % 4 === 0 ? 'pending' : 'completed');
    if (i % 3 === 0) insertarLetra.run(info.lastInsertRowid, 180000, LETRA_EJEMPLO);
  }
  for (let i = 1; i <= 300; i += 1) marcarReproducida.run(i, hoy);
  db.exec('COMMIT');
});
check('datos: 3.000 canciones cargadas', db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n === TOTAL);
check('datos: carga masiva en un solo BEGIN/COMMIT (' + carga.ms.toFixed(0) + ' ms)', carga.ms < 20000, carga.ms.toFixed(0) + ' ms');

// ---- consultas clave ------------------------------------------------------
const plan = sql => db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(fila => fila.detail).join(' | ');

const leerLetra = db.prepare('SELECT source, synced, lines_json FROM lyrics WHERE track_id = ?');
const t1 = medir(() => { for (let i = 0; i < 500; i += 1) leerLetra.get((i % 1000) + 1); });
check('consulta: 500 lecturas de letra en ' + t1.ms.toFixed(1) + ' ms (1 fila por canción)', t1.ms < 500, t1.ms.toFixed(1) + ' ms');
check('consulta: la letra se busca por clave primaria', /SEARCH lyrics USING (INTEGER )?PRIMARY KEY/.test(plan('SELECT * FROM lyrics WHERE track_id = 5')), plan('SELECT * FROM lyrics WHERE track_id = 5'));

const candidatas = medir(() => db.prepare('SELECT COUNT(*) AS n FROM v_candidatos_auto').get());
check('consulta: candidatas de hoy en ' + candidatas.ms.toFixed(1) + ' ms', candidatas.ms < 250, candidatas.ms.toFixed(1) + ' ms');
check('consulta: la vista usa el índice parcial del historial', /idx_play_auto_ciclo|idx_play_auto_dia|idx_play_track|idx_play_fecha/.test(plan('SELECT * FROM v_candidatos_auto')), plan('SELECT * FROM v_candidatos_auto'));

const alAzar = medir(() => db.prepare('SELECT id FROM v_candidatos_auto ORDER BY RANDOM() LIMIT 1').get());
check('consulta: elegir una al azar en ' + alAzar.ms.toFixed(1) + ' ms', alAzar.ms < 300, alAzar.ms.toFixed(1) + ' ms');

const resumen = db.prepare('SELECT * FROM v_biblioteca_resumen').get();
check('consulta: el resumen del dashboard sale de un solo SELECT', resumen.tracks === TOTAL && resumen.reproducidas_hoy === 300, JSON.stringify(resumen));

// ---- regla del ciclo diario ----------------------------------------------
const libre = TOTAL;                     // una canción que NO se marcó en el bucle
const primera = marcarReproducida.run(libre, hoy);
const repetida = marcarReproducida.run(libre, hoy);
check('regla: el automático no registra dos veces la misma canción el mismo día', primera.changes === 1 && repetida.changes === 0, JSON.stringify({ primera: primera.changes, repetida: repetida.changes }));
const manual = db.prepare("INSERT INTO play_history (track_id, played_date, play_mode) VALUES (?, ?, 'manual')").run(libre, hoy);
const manual2 = db.prepare("INSERT INTO play_history (track_id, played_date, play_mode) VALUES (?, ?, 'manual')").run(libre, hoy);
check('regla: el manual sí puede repetir el mismo día', manual.changes === 1 && manual2.changes === 1);

// ---- trabajos -------------------------------------------------------------
const job1 = db.prepare("INSERT OR IGNORE INTO analysis_jobs (track_id, kind) VALUES (10, 'offset')").run();
const job2 = db.prepare("INSERT OR IGNORE INTO analysis_jobs (track_id, kind) VALUES (10, 'offset')").run();
check('trabajos: no se encola dos veces el mismo trabajo pendiente', job1.changes === 1 && job2.changes === 0, JSON.stringify({ uno: job1.changes, dos: job2.changes }));
const tomar = db.prepare(`UPDATE analysis_jobs SET status='processing', started_at=datetime('now'), attempts=attempts+1
  WHERE id = (SELECT id FROM analysis_jobs WHERE status='pending' ORDER BY id LIMIT 1) AND status='pending'`).run();
check('trabajos: se toma uno y sólo uno', tomar.changes === 1, JSON.stringify(tomar));

// ---- validaciones ---------------------------------------------------------
db.prepare('UPDATE tracks SET start_at = 99, end_at = 10 WHERE id = 2').run();
const invalidos = db.prepare(`SELECT COUNT(*) AS n FROM tracks WHERE duration_ms IS NOT NULL AND (start_at < 0 OR start_at > 15)`).get();
check('validación: la consulta detecta offsets fuera de rango', invalidos.n >= 1, JSON.stringify(invalidos));

const borrado = db.prepare('DELETE FROM tracks WHERE id = 3').run();
const letrasHuerfanas = db.prepare('SELECT COUNT(*) AS n FROM lyrics WHERE track_id = 3').get();
check('integridad: al borrar la canción se borra su letra (ON DELETE CASCADE)', borrado.changes === 1 && letrasHuerfanas.n === 0, JSON.stringify(letrasHuerfanas));

// ---- espaciado ------------------------------------------------------------
const espacio = db.prepare('SELECT COUNT(*) AS canciones, ROUND(SUM(LENGTH(lines_json))/1024.0, 1) AS kb FROM lyrics').get();
console.log('\nLetras de prueba: ' + espacio.canciones + ' canciones, ' + espacio.kb + ' KB en total (' +
  (espacio.kb / espacio.canciones).toFixed(1) + ' KB por canción -> 3.000 reales ≈ ' +
  Math.round((espacio.kb / espacio.canciones) * 3000 / 1024) + ' MB)');

console.log('\n' + ok + '/' + (ok + fallas) + ' pruebas del esquema OK');
db.close();
for (const sufijo of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(TEMPORAL + sufijo); } catch (_) { /* nada */ }
}
process.exit(fallas ? 1 : 0);
