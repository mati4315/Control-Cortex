/**
 * Pruebas del modo automatico (Control Cortex/backend/biblioteca/auto.js):
 * eleccion en RAM, ciclo diario, no repetir y registro en play_history.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.resolve(__dirname, '..', '..');
const ESQUEMA = path.join(RAIZ, 'Rulo', 'Spotify', 'canciones automatic', 'esquema-music.sql');
const { createAuto } = require(path.join(RAIZ, 'Control Cortex', 'backend', 'biblioteca', 'auto.js'));

let ok = 0, fallas = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { ok += 1; console.log('OK    ' + nombre); }
  else { fallas += 1; console.log('FALLA ' + nombre + (detalle !== undefined ? ' -- ' + detalle : '')); }
};

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rulo-auto-'));
const db = new DatabaseSync(path.join(TEMP, 'prueba.db'));
db.exec(fs.readFileSync(ESQUEMA, 'utf8'));

const agregar = (titulo, spotifyId, opciones) => {
  const o = opciones || {};
  const info = db.prepare(`INSERT INTO tracks (title, artist, duration_ms, offline, enabled, spotify_track_id, start_at, end_at)
    VALUES (?, 'Prueba', 200000, ?, ?, ?, ?, ?)`).run(titulo, o.offline === 0 ? 0 : 1, o.enabled === 0 ? 0 : 1,
    spotifyId === undefined ? null : spotifyId,
    o.startAt === undefined ? null : o.startAt,
    o.endAt === undefined ? null : o.endAt);
  return Number(info.lastInsertRowid);
};

const id1 = agregar('Uno', 'AAAABBBBCCCCDDDDEEEE01', { startAt: 3.5, endAt: 196 });
const id2 = agregar('Dos', 'AAAABBBBCCCCDDDDEEEE02');
const id3 = agregar('Tres', 'AAAABBBBCCCCDDDDEEEE03');
const idApagada = agregar('Apagada', 'AAAABBBBCCCCDDDDEEEE04', { enabled: 0 });
const idSinArchivo = agregar('Sin archivo', 'AAAABBBBCCCCDDDDEEEE05', { offline: 0 });
const idSinSpotify = agregar('Sin spotify id', null);

let hoy = '2026-09-19';
const auto = createAuto({ db, fechaLogica: () => hoy, log: () => {} });

const carga = auto.cargar();
check('carga: solo entran las elegibles (offline + habilitadas + con Track ID)', carga.candidatas === 3, JSON.stringify(carga));
check('carga: retoma el ciclo guardado', carga.ciclo === 1, JSON.stringify(carga));
check('carga: deja afuera la apagada, la sin archivo y la sin Track ID',
  !auto.candidatas().some(t => [idApagada, idSinArchivo, idSinSpotify].indexOf(t.id) !== -1));

const eleccion = auto.elegir();
check('elegir: devuelve un tema con uri de Spotify', !!eleccion.tema && /^spotify:track:/.test(eleccion.tema.uri), JSON.stringify(eleccion.tema));
check('elegir: trae start_at/end_at de la cancion', eleccion.tema.id !== id1 || (eleccion.tema.startAt === 3.5 && eleccion.tema.endAt === 196), JSON.stringify(eleccion.tema));

// --- ciclo diario -------------------------------------------------------
// Primer tema: se reproduce y se registra.
const primero = auto.elegir();
auto.registrar(primero.tema.id, { modo: 'auto', origen: 'spotify' });
check('ciclo: arranca en el ciclo 1', auto.estado().ciclo === 1 && primero.ciclo === 1, JSON.stringify([primero.ciclo, auto.estado().ciclo]));

// Repetir en automatico dentro del mismo ciclo: la base lo rechaza.
check('regla: la base rechaza repetir en automatico dentro del ciclo', auto.registrar(primero.tema.id, { modo: 'auto' }) === false);
check('regla: el pedido manual si puede repetir', auto.registrar(primero.tema.id, { modo: 'manual' }) === true);

// Se completa el ciclo 1 (3 canciones) y el cuarto pedido arranca el ciclo 2.
const vistas = [primero.tema.titulo];
for (let i = 0; i < 3; i += 1) {
  const r = auto.elegir();
  vistas.push(r.tema && r.tema.titulo);
  if (r.tema) auto.registrar(r.tema.id, { modo: 'auto', origen: 'spotify' });
}
check('ciclo: las tres del ciclo 1 son distintas', new Set(vistas.slice(0, 3)).size === 3, JSON.stringify(vistas));
check('ciclo: el cuarto tema reinicia el ciclo en vez de bloquearse', auto.estado().ciclo === 2 && !!vistas[3], JSON.stringify({ vistas, ciclo: auto.estado().ciclo }));
check('ciclo: se registraron las 4 automaticas (3 del ciclo 1 + 1 del 2)', auto.estado().historial.auto === 4, JSON.stringify(auto.estado().historial));
check('historial: quedan 4 automaticas y 1 manual', JSON.stringify(auto.estado().historial) === '{"auto":4,"manual":1}', JSON.stringify(auto.estado().historial));

// --- cambio de dia -------------------------------------------------------
hoy = '2026-09-20';
const recargado = auto.recargar();
check('dia nuevo: todas vuelven a estar disponibles', recargado.reproducidasHoy === 0 && auto.candidatas().length === 3, JSON.stringify(recargado));
check('dia nuevo: el historial de hoy arranca vacio', !auto.estado().historial.auto, JSON.stringify(auto.estado().historial));

// --- sin biblioteca ------------------------------------------------------
{
  const vacia = createAuto({ db: null, log: () => {} });
  check('sin base: disponible() es false', vacia.disponible() === false);
  check('sin base: elegir no rompe', vacia.elegir().tema === null);
}
{
  const soloVacias = createAuto({ db, fechaLogica: () => hoy, log: () => {} });
  db.prepare('UPDATE tracks SET offline = 0').run();
  check('biblioteca vacia: avisa el motivo', soloVacias.elegir().motivo.indexOf('vacia') !== -1);
  db.prepare('UPDATE tracks SET offline = 1').run();
}

// --- idempotencia de la carga -------------------------------------------
{
  const otra = createAuto({ db, fechaLogica: () => hoy, log: () => {} });
  otra.cargar();
  otra.elegir();
  const antes = otra.estado().reproducidasHoy;
  otra.cargar();
  check('carga: recargar no pierde lo registrado', otra.estado().reproducidasHoy === antes, JSON.stringify([antes, otra.estado().reproducidasHoy]));
}

// --- planificador: cuando corresponde poner musica solo -------------------
{
  let reloj = 1000000;                      // reloj falso, en ms
  const plan = createAuto({ db, fechaLogica: () => hoy, ahora: () => reloj, log: () => {} });
  plan.cargar();

  check('planificador: apagado no elige', plan.puedeElegir().si === false && /apagado/.test(plan.puedeElegir().motivo), JSON.stringify(plan.puedeElegir()));

  plan.configurar({ habilitado: true, esperaSegundos: 240 });
  check('planificador: encendido y sin actividad elige ya', plan.puedeElegir().si === true, JSON.stringify(plan.puedeElegir()));

  plan.marcarActividad();
  const reciente = plan.puedeElegir();
  check('planificador: si hubo pedidos hace poco espera', reciente.si === false && reciente.faltanMs > 200000, JSON.stringify(reciente));

  reloj += 241000;                          // pasa la espera
  check('planificador: pasada la espera vuelve a elegir', plan.puedeElegir().si === true, JSON.stringify(plan.puedeElegir()));

  const tema = plan.elegir();
  plan.programarSiguiente(tema.tema.durationMs);
  const mientras = plan.puedeElegir();
  check('planificador: mientras suena una cancion no encola otra', mientras.si === false && mientras.faltanMs > 100000, JSON.stringify(mientras));

  plan.adelantarSiguiente(5000);
  check('planificador: si la cancion termina antes, adelanta la siguiente (5 s)', plan.puedeElegir().faltanMs <= 5000, JSON.stringify(plan.puedeElegir()));
  reloj += 6000;
  check('planificador: pasados esos 5 s ya elige la siguiente', plan.puedeElegir().si === true, JSON.stringify(plan.puedeElegir()));

  plan.marcarActividad();
  check('planificador: un pedido de una persona vuelve a frenar el automatico', plan.puedeElegir().si === false, JSON.stringify(plan.puedeElegir()));
  check('planificador: la espera se puede configurar', plan.configurar({ esperaSegundos: 30 }).esperaSegundos === 30);
  check('planificador: informa el estado en el resumen', plan.estado().habilitado === true && typeof plan.estado().puede.si === 'boolean', JSON.stringify(plan.estado().puede));
}

console.log('\n' + ok + '/' + (ok + fallas) + ' pruebas del modo automatico OK');
db.close();
try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) { /* nada */ }
process.exit(fallas ? 1 : 0);
