/**
 * Pruebas del scanner de la biblioteca local (Control Cortex/backend/biblioteca/scanner.js).
 * Usa audios REALES generados con ffmpeg en una carpeta temporal y una base temporal.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.resolve(__dirname, '..', '..');
const ESQUEMA = path.join(RAIZ, 'Rulo', 'Spotify', 'canciones automatic', 'esquema-music.sql');
const { createBiblioteca, desdeNombreArchivo } = require(path.join(RAIZ, 'Control Cortex', 'backend', 'biblioteca', 'scanner.js'));

let ok = 0, fallas = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { ok += 1; console.log('OK    ' + nombre); }
  else { fallas += 1; console.log('FALLA ' + nombre + (detalle !== undefined ? ' -- ' + detalle : '')); }
};

// --- escenario temporal ----------------------------------------------------
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rulo-biblioteca-'));
const MUSICA = path.join(TEMP, 'musica');
const SUB = path.join(MUSICA, 'cumbia');
fs.mkdirSync(SUB, { recursive: true });
const BASE = path.join(TEMP, 'prueba.db');

function ffmpeg(args) {
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.log('  (no se pudo generar el audio de prueba: ' + error.message + ')');
    return false;
  }
}

const hayFfmpeg = ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
  '-metadata', 'title=Tema Uno', '-metadata', 'artist=Artista Uno', '-metadata', 'album=Album Uno',
  path.join(MUSICA, 'Artista Uno - Tema Uno.mp3')]);
ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', path.join(MUSICA, 'sin-etiquetas - Tema Dos.mp3')]);
ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-metadata', 'title=Cumbia Tres', '-metadata', 'artist=Artista Tres', path.join(SUB, 'tres.mp3')]);
fs.writeFileSync(path.join(MUSICA, 'notas.txt'), 'esto no es audio');
fs.writeFileSync(path.join(MUSICA, 'portada.jpg'), 'tampoco');

const db = new DatabaseSync(BASE);
db.exec(fs.readFileSync(ESQUEMA, 'utf8'));
// Historial previo del chat: sirve para completar el Track ID sin salir a internet.
// (La tabla `interactions` la crea el modulo de analitica; aca se arma lo minimo.)
db.exec(`CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, iso TEXT, comment TEXT,
  track_name TEXT, track_artist TEXT, track_uri TEXT)`);
db.exec(`INSERT INTO interactions (ts, iso, comment, track_name, track_artist, track_uri)
  VALUES (1, '2026-09-19T10:00:00', 'poneme tema uno', 'Tema Uno', 'Artista Uno', 'spotify:track:AAAABBBBCCCCDDDDEEEEFF')`);

let llamadasFfprobe = 0;
// Envuelve ffprobe real para poder contar cuantas veces se ejecuta (eso demuestra
// que el segundo escaneo no vuelve a medir lo que no cambio).
const ejecutarContando = (comando, argumentos) => {
  llamadasFfprobe += 1;
  return new Promise(resolve => {
    execFile(comando, argumentos, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, error: error ? String(error.message || error) : '', stdout: stdout || '', stderr: stderr || '' });
    });
  });
};
const biblioteca = createBiblioteca({ db, carpeta: MUSICA, ejecutar: ejecutarContando });

// --- nombres de archivo (sin etiquetas) ------------------------------------
{
  const normal = desdeNombreArchivo('D:/x/Artista Uno - Tema Uno.mp3');
  check('nombre: separa artista y titulo', normal.artista === 'Artista Uno' && normal.titulo === 'Tema Uno', JSON.stringify(normal));
  const raro = desdeNombreArchivo('D:/x/Cumbias Recuerdo (95 - 2000).mp3');
  check('nombre: si el titulo queda pobre usa el nombre completo', raro.artista === '' && raro.titulo === 'Cumbias Recuerdo (95 - 2000)', JSON.stringify(raro));
  const largo = desdeNombreArchivo('D:/x/Pibes de Barrio - La Cumbia Del Barrio (En Vivo).mp3');
  check('nombre: los guiones del titulo se conservan', largo.artista === 'Pibes de Barrio' && largo.titulo === 'La Cumbia Del Barrio (En Vivo)', JSON.stringify(largo));
  const sinGuion = desdeNombreArchivo('D:/x/Enganchado Villero 2000.mp3');
  check('nombre: sin guion queda como titulo', sinGuion.artista === '' && sinGuion.titulo === 'Enganchado Villero 2000', JSON.stringify(sinGuion));
}

(async () => {
  check('scanner: la biblioteca queda disponible', biblioteca.disponible() === true);

  // --- primer escaneo -----------------------------------------------------
  const primero = await biblioteca.escanear();
  check('primer scan: ve los 3 audios e ignora el resto', primero.vistos === 3, JSON.stringify(primero.vistos));
  check('primer scan: los 3 entran como nuevos', primero.nuevos === 3, JSON.stringify(primero));
  check('primer scan: leyo los 3 con ffprobe', llamadasFfprobe === 3, String(llamadasFfprobe));

  const filas = db.prepare('SELECT * FROM tracks ORDER BY artist').all();
  check('metadata: titulo y artista salen de las etiquetas', filas.some(f => f.title === 'Tema Uno' && f.artist === 'Artista Uno'), JSON.stringify(filas.map(f => [f.title, f.artist])));
  check('metadata: la duracion la saca de ffprobe (~2 s)', filas.every(f => f.duration_ms >= 1800 && f.duration_ms <= 2300), JSON.stringify(filas.map(f => f.duration_ms)));
  check('metadata: sin etiquetas usa el nombre del archivo', filas.some(f => f.title === 'Tema Dos' && f.artist === 'sin-etiquetas'), JSON.stringify(filas.map(f => [f.title, f.artist])));
  check('metadata: guarda la ruta absoluta y el tamaño', filas.every(f => f.local_path && f.file_size > 0 && f.file_mtime > 0), JSON.stringify(filas[0]));
  check('scan: todas quedan offline y pendientes de analisis', filas.every(f => f.offline === 1 && f.analysis_status === 'pending'));
  check('scan: el Track ID se completa con el historial del chat', filas.some(f => f.spotify_track_id === 'AAAABBBBCCCCDDDDEEEEFF'), JSON.stringify(filas.map(f => f.spotify_track_id)));

  // --- segundo escaneo: nada cambio --------------------------------------
  const antes = llamadasFfprobe;
  const segundo = await biblioteca.escanear();
  check('segundo scan: no hay nuevos ni actualizados', segundo.nuevos === 0 && segundo.actualizados === 0, JSON.stringify(segundo));
  check('segundo scan: los 3 se saltean sin cambios', segundo.saltados === 3, JSON.stringify(segundo.saltados));
  check('optimizacion: no volvio a llamar a ffprobe', llamadasFfprobe === antes, 'llamadas: ' + (llamadasFfprobe - antes));

  // --- archivo modificado -------------------------------------------------
  fs.appendFileSync(path.join(SUB, 'tres.mp3'), Buffer.alloc(1024, 7));   // cambia tamaño y fecha
  const tercero = await biblioteca.escanear();
  check('tercer scan: detecta el archivo modificado', tercero.actualizados === 1 && tercero.nuevos === 0, JSON.stringify(tercero));
  check('tercer scan: solo midio ese archivo', llamadasFfprobe === antes + 1, String(llamadasFfprobe - antes));

  // --- archivo borrado ----------------------------------------------------
  fs.unlinkSync(path.join(MUSICA, 'Artista Uno - Tema Uno.mp3'));
  const cuarto = await biblioteca.escanear();
  const borrada = db.prepare("SELECT * FROM tracks WHERE title = 'Tema Uno'").get();
  check('cuarto scan: la cancion borrada queda registrada pero offline', cuarto.offline === 1 && borrada && borrada.offline === 0, JSON.stringify(cuarto));
  check('cuarto scan: no se borro ninguna fila', db.prepare('SELECT COUNT(*) n FROM tracks').get().n === 3);

  // --- carpeta inexistente -----------------------------------------------
  const otra = createBiblioteca({ db, carpeta: path.join(TEMP, 'no-existe') });
  const quinto = await otra.escanear();
  check('carpeta inexistente: no explota y devuelve ceros', quinto.existe === false && quinto.vistos === 0, JSON.stringify(quinto));

  // --- adopcion: una ficha sin archivo (creada por el cancelador de letras) ---
  {
    // Cancion nueva en el disco + ficha previa sin archivo con el mismo titulo/artista.
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=500:duration=2', path.join(MUSICA, 'Nadie - Tema Nuevo.mp3')]);
    db.prepare(`INSERT INTO tracks (title, artist, album, duration_ms, offline, enabled, lyrics_status)
      VALUES ('Tema Nuevo', 'Nadie', '', 2000, 0, 0, 'ok')`).run();
    const scan = await biblioteca.escanear();
    const filas = db.prepare("SELECT * FROM tracks WHERE title = 'Tema Nuevo'").all();
    check('adopcion: no duplica la ficha del mismo tema', filas.length === 1, JSON.stringify(filas.map(f => [f.id, f.local_path])));
    check('adopcion: la ficha adoptada queda con archivo y offline', !!filas[0] && filas[0].local_path !== null && filas[0].offline === 1, JSON.stringify(filas[0]));
    check('adopcion: conserva lo que ya sabiamos (su letra)', !!filas[0] && filas[0].lyrics_status === 'ok', filas[0] && filas[0].lyrics_status);
    check('adopcion: el contador de adoptados lo informa', scan.adoptados === 1, JSON.stringify(scan));
  }

  // --- listado y resumen --------------------------------------------------
  const listado = biblioteca.listar({ offline: true, limite: 10 });
  check('listar: devuelve solo las offline', listado.length === 3 && listado.every(f => f.offline === 1), JSON.stringify(listado.map(f => f.title)));
  const buscado = biblioteca.listar({ buscar: 'cumbia' });
  check('listar: busca por titulo o artista', buscado.length === 1 && buscado[0].title === 'Cumbia Tres', JSON.stringify(buscado.map(f => f.title)));
  const resumen = biblioteca.resumen();
  check('resumen: cuenta las de la biblioteca', resumen.tracks === 4 && resumen.offline === 3 && resumen.sin_spotify_id === 3, JSON.stringify(resumen));

  // --- edicion manual -----------------------------------------------------
  const id = listado[0].id;
  biblioteca.actualizar(id, { start_at: 8.2, end_at: 237.5, analysis_status: 'manual' });
  const editada = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
  check('edicion: guarda start_at/end_at y marca manual', editada.start_at === 8.2 && editada.end_at === 237.5 && editada.analysis_status === 'manual');
  check('edicion: ignora campos que no existen', biblioteca.actualizar(id, { inventado: 1 }) === false);

  console.log('\n' + ok + '/' + (ok + fallas) + ' pruebas del scanner OK' + (hayFfmpeg ? '' : ' (sin ffmpeg: se usaron archivos vacios)'));
  db.close();
  try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) { /* nada */ }
  process.exit(fallas ? 1 : 0);
})();
