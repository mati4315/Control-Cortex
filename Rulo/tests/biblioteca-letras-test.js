/**
 * Pruebas del resolvedor de letras (Control Cortex/backend/biblioteca/letras.js + lrclib.js).
 * Usa un LRCLIB simulado (fetch inyectado) con respuestas con la forma real.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.resolve(__dirname, '..', '..');
const ESQUEMA = path.join(RAIZ, 'Rulo', 'Spotify', 'canciones automatic', 'esquema-music.sql');
const { createLrclib, parsearLRC } = require(path.join(RAIZ, 'Control Cortex', 'backend', 'biblioteca', 'lrclib.js'));
const { createLetras } = require(path.join(RAIZ, 'Control Cortex', 'backend', 'biblioteca', 'letras.js'));

let ok = 0, fallas = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { ok += 1; console.log('OK    ' + nombre); }
  else { fallas += 1; console.log('FALLA ' + nombre + (detalle !== undefined ? ' -- ' + detalle : '')); }
};

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rulo-letras-'));
const db = new DatabaseSync(path.join(TEMP, 'prueba.db'));
db.exec(fs.readFileSync(ESQUEMA, 'utf8'));

function agregarTrack(titulo, artista, duracionMs, spotifyId) {
  const info = db.prepare(`INSERT INTO tracks (title, artist, album, duration_ms, offline, spotify_track_id)
    VALUES (?, ?, 'Album', ?, 1, ?)`).run(titulo, artista, duracionMs, spotifyId || null);
  return Number(info.lastInsertRowid);
}

const idTema = agregarTrack('En El Muelle De San Blas', 'Maná', 352000, 'AAAABBBBCCCCDDDDEEEEFF');
const idSin = agregarTrack('Tema Inexistente', 'Nadie', 200000, null);
const idCorta = agregarTrack('Version Corta', 'Maná', 500000, null);
const idRed = agregarTrack('Tema De Red Caida', 'Nadie', 210000, null);
const idInstr = agregarTrack('Instrumental Test', 'Varios', 180000, null);

// --- LRC ---------------------------------------------------------------
{
  const lineas = parsearLRC('[00:25.53] Ella despidió a su amor\n[00:28.680] Él partió en un barco\n\n[01:05.39] ');
  check('lrc: convierte minutos, segundos y centesimas a ms', lineas[0].startMs === 25530, JSON.stringify(lineas[0]));
  check('lrc: admite milisegundos de 3 cifras', lineas[1].startMs === 28680, JSON.stringify(lineas[1]));
  check('lrc: arma endMs con la linea siguiente', lineas[1].endMs === 65390, String(lineas[1].endMs));
  check('lrc: la ultima linea dura 4 s', lineas[2].endMs === lineas[2].startMs + 4000, JSON.stringify(lineas[2]));
  const varias = parsearLRC('[00:10.00][00:20.00] repetida');
  check('lrc: admite varias marcas en la misma linea', varias.length === 2 && varias[1].startMs === 20000, JSON.stringify(varias));
}

// --- LRCLIB simulado ----------------------------------------------------
const RESPUESTA_LARGA = {
  id: 1049576, trackName: 'En El Muelle De San Blas', artistName: 'Maná', duration: 352,
  instrumental: false, language: 'es',
  syncedLyrics: '[00:25.53] Ella despidió a su amor\n[00:28.68] Él partió en un barco\n[00:35.55] Él juró que volvería',
  plainLyrics: 'Ella despidió a su amor'
};
let llamadas = [];
function fetchSimulado(respuestas) {
  return async (url) => {
    llamadas.push(url);
    const ruta = url.replace('https://lrclib.net', '');
    for (const [patron, respuesta] of respuestas) {
      if (ruta.indexOf(patron) === 0) {
        if (respuesta === 'error-red') throw new Error('sin internet');
        return { status: respuesta.status || 200, ok: (respuesta.status || 200) === 200, json: async () => respuesta.cuerpo };
      }
    }
    return { status: 404, ok: false, json: async () => ({ message: 'Not Found', statusCode: 404 }) };
  };
}

async function conRespuestas(respuestas, fn) {
  llamadas = [];
  const letras = createLetras({ db, fetch: fetchSimulado(respuestas), log: () => {} });
  return fn(letras);
}

(async () => {
  // 1) letra encontrada y guardada
  await conRespuestas([['/api/get', { cuerpo: RESPUESTA_LARGA }]], async letras => {
    const letra = await letras.resolver({ id: idTema, titulo: 'En El Muelle De San Blas', artista: 'Maná', duracionMs: 352000 });
    check('resolver: trae la letra de LRCLIB', !!letra && letra.source === 'lrclib' && letra.synced === true, JSON.stringify(letra && letra.source));
    check('resolver: normaliza las lineas con tiempos', letra.lines.length === 3 && letra.lines[0].startMs === 25530, JSON.stringify(letra.lines[0]));
    check('resolver: guarda la letra en SQLite', db.prepare('SELECT COUNT(*) n FROM lyrics WHERE track_id = ?').get(idTema).n === 1);
    check('resolver: la cancion queda con letras ok', db.prepare('SELECT lyrics_status FROM tracks WHERE id = ?').get(idTema).lyrics_status === 'ok');

    // 2) la segunda vez sale de SQLite: cero red (esa es la optimizacion)
    const antes = llamadas.length;
    const repetida = await letras.resolver({ id: idTema, titulo: 'En El Muelle De San Blas', artista: 'Maná', duracionMs: 352000 });
    check('optimizacion: la segunda vez no consulta LRCLIB', llamadas.length === antes, 'llamadas nuevas: ' + (llamadas.length - antes));
    check('optimizacion: devuelve la misma letra desde la base', repetida && repetida.lines.length === 3 && repetida.source === 'lrclib');
    check('estado: informa las letras guardadas y su tamaño', letras.estado().guardadas === 1 && letras.estado().porFuente.lrclib === 1, JSON.stringify(letras.estado()));
  });

  // 3) sin letra en ningun lado: se recuerda y no se vuelve a preguntar
  await conRespuestas([['/api/get', { status: 404, cuerpo: { message: 'Not Found' } }], ['/api/search', { cuerpo: [] }]], async letras => {
    const nada = await letras.resolver({ id: idSin, titulo: 'Tema Inexistente', artista: 'Nadie', duracionMs: 200000 });
    check('resolver: sin resultados devuelve null', nada === null, JSON.stringify(nada));
    check('resolver: anota que no tiene letra', db.prepare('SELECT lyrics_status FROM tracks WHERE id = ?').get(idSin).lyrics_status === 'none');

    const antes = llamadas.length;
    await letras.resolver({ id: idSin, titulo: 'Tema Inexistente', artista: 'Nadie', duracionMs: 200000 });
    check('optimizacion: no vuelve a preguntar por la que no tiene letra', llamadas.length === antes, 'llamadas nuevas: ' + (llamadas.length - antes));

    const forzada = await letras.resolver({ id: idSin, titulo: 'Tema Inexistente', artista: 'Nadie', duracionMs: 200000 }, { reintentarVacios: true });
    check('resolver: se puede forzar la busqueda otra vez', forzada === null && llamadas.length > antes);
  });

  // 4) la duracion no coincide: se descarta la letra de otra version
  await conRespuestas([['/api/get', { cuerpo: { ...RESPUESTA_LARGA, duration: 250 } }], ['/api/search', { cuerpo: [] }]], async letras => {
    const letra = await letras.resolver({ id: idCorta, titulo: 'Version Corta', artista: 'Maná', duracionMs: 500000 });
    check('validacion: descarta la letra si la duracion no coincide', letra === null, JSON.stringify(letra && letra.lines && letra.lines.length));
  });

  // 5) error de red: no explota y no marca la cancion
  await conRespuestas([['/api/get', 'error-red']], async letras => {
    const letra = await letras.resolver({ id: idRed, titulo: 'Tema De Red Caida', artista: 'Nadie', duracionMs: 210000 });
    check('red: si no hay internet devuelve null sin romper', letra === null);
    check('red: no marca la cancion como sin letra', db.prepare('SELECT lyrics_status FROM tracks WHERE id = ?').get(idRed).lyrics_status !== 'none');
  });

  // 6) instrumental
  await conRespuestas([['/api/get', { cuerpo: { id: 9, instrumental: true, duration: 180, syncedLyrics: '', plainLyrics: '' } }]], async letras => {
    const letra = await letras.resolver({ id: idInstr, titulo: 'Instrumental Test', artista: 'Varios', duracionMs: 180000 });
    check('instrumental: se guarda como instrumental', !!letra && letra.instrumental === true && letra.lines.length === 0, JSON.stringify(letra));
  });

  // 7) si /api/get no la tiene, busca y elige el mejor candidato
  await conRespuestas([
    ['/api/get', { status: 404, cuerpo: { message: 'Not Found' } }],
    ['/api/search', {
      cuerpo: [
        { id: 1, trackName: 'Otra Cosa', artistName: 'Varios', duration: 120, syncedLyrics: '[00:01.00] nope' },
        { id: 2, trackName: 'Tema Buscado', artistName: 'Nadie', duration: 210, syncedLyrics: '[00:02.00] si, esta es\n[00:05.00] segunda linea' }
      ]
    }]
  ], async letras => {
    // idSin ya esta marcada como 'none' del caso 3: se usa una fila nueva
    const idBuscar = agregarTrack('Tema Buscado', 'Nadie', 210000, null);
    const letra = await letras.resolver({ id: idBuscar, titulo: 'Tema Buscado', artista: 'Nadie', duracionMs: 210000 });
    check('busqueda: elige el candidato correcto', !!letra && letra.lines.length === 2 && letra.lines[0].text === 'si, esta es', JSON.stringify(letra && letra.lines));
  });

  // 8) la cache local de Spotify esta apagada por defecto
  {
    let llamadaCache = 0;
    const letras = createLetras({
      db,
      fetch: fetchSimulado([['/api/get', { status: 404, cuerpo: {} }]]),
      leerCacheLocal: async () => { llamadaCache += 1; return null; },
      log: () => {}
    });
    const idCache = agregarTrack('Tema Cache', 'Nadie', 200000, null);
    await letras.resolver({ id: idCache, titulo: 'Tema Cache', artista: 'Nadie', duracionMs: 200000 });
    check('cache local: apagada por defecto no se consulta', llamadaCache === 0, String(llamadaCache));

    const conCache = createLetras({
      db,
      fetch: fetchSimulado([['/api/get', { status: 404, cuerpo: {} }]]),
      cacheLocal: true,
      leerCacheLocal: async () => ({ source: 'spotify_local', provider: 'Musixmatch', synced: true, lines: [{ startMs: 1000, endMs: 2000, text: 'desde la cache' }] }),
      log: () => {}
    });
    const idCache2 = agregarTrack('Tema Cache 2', 'Nadie', 200000, null);
    const deCache = await conCache.resolver({ id: idCache2, titulo: 'Tema Cache 2', artista: 'Nadie', duracionMs: 200000 });
    check('cache local: si se habilita, se usa antes que LRCLIB', !!deCache && deCache.source === 'spotify_local', JSON.stringify(deCache && deCache.source));
    check('cache local: y queda guardada en la base', db.prepare("SELECT COUNT(*) n FROM lyrics WHERE track_id = ? AND source = 'spotify_local'").get(idCache2).n === 1);
  }

  // 9) traer de a poco las que faltan
  {
    // Una cancion nueva, pendiente, para que el lote tenga que hacer algo.
    agregarTrack('Pendiente De Letra', 'Maná', 352000, null);
    const letras = createLetras({ db, fetch: fetchSimulado([['/api/get', { cuerpo: RESPUESTA_LARGA }]]), log: () => {} });
    const pendientes = db.prepare("SELECT COUNT(*) n FROM tracks WHERE lyrics_status = 'pending'").get().n;
    const traidas = await letras.traerFaltantes(5, { esperaMs: 0 });
    check('lote: intenta las pendientes', traidas.intentadas === Math.min(5, pendientes), JSON.stringify({ pendientes, traidas }));
    check('lote: encuentra letras cuando existen', traidas.encontradas >= 1, JSON.stringify(traidas));
  }

  // 10) un tema que NO esta en la biblioteca: se le crea la ficha y se cachea igual
  {
    let llamadasTema = 0;
    const contando = async (url) => { llamadasTema += 1; return fetchSimulado([['/api/get', { cuerpo: RESPUESTA_LARGA }]])(url); };
    const sueltas = createLetras({ db, fetch: contando, log: () => {} });
    const antes = db.prepare('SELECT COUNT(*) n FROM tracks').get().n;

    const letra = await sueltas.resolver({ spotifyId: 'ZZZZYYYYXXXXWWWWVVVV99', titulo: 'Tema Suelto Del Chat', artista: 'Nadie', duracionMs: 352000 });
    check('tema suelto: consigue la letra igual', !!letra && letra.lines.length === 3, JSON.stringify(letra && letra.lines.length));
    check('tema suelto: se le creo la ficha en la base', db.prepare('SELECT COUNT(*) n FROM tracks').get().n === antes + 1);
    check('tema suelto: la ficha guarda el id de Spotify', db.prepare("SELECT spotify_track_id FROM tracks WHERE title = 'Tema Suelto Del Chat'").get().spotify_track_id === 'ZZZZYYYYXXXXWWWWVVVV99');

    const repetida = await sueltas.resolver({ spotifyId: 'ZZZZYYYYXXXXWWWWVVVV99', titulo: 'Tema Suelto Del Chat', artista: 'Nadie', duracionMs: 352000 });
    check('tema suelto: la segunda vez sale de la base (cero red)', llamadasTema === 1 && !!repetida, 'llamadas: ' + llamadasTema);
  }

  // 11) sin base no explota
  {
    const vacio = createLetras({ fetch: fetchSimulado([]), log: () => {} });
    check('sin base: disponible() es false y resolver no rompe', vacio.disponible() === false && (await vacio.resolver({ titulo: 'X', artista: 'Y' })) === null);
  }

  console.log('\n' + ok + '/' + (ok + fallas) + ' pruebas de letras OK');
  db.close();
  try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) { /* nada */ }
  process.exit(fallas ? 1 : 0);
})();
