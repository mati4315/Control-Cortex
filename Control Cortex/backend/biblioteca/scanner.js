'use strict';
// Scanner de la biblioteca local: recorre la carpeta configurada, lee metadatos
// y mantiene la tabla `tracks` al dia.
//
// Optimizaciones que importan con ~3.000 canciones:
//   * Detector de cambios barato: se compara tamaño + fecha de modificacion.
//     ffprobe SOLO se ejecuta si el archivo es nuevo o cambio.
//   * Todo el lote en UNA transaccion (miles de filas en decenas de ms).
//   * Nunca borra filas: si un archivo desaparece se marca offline = 0
//     (un disco desconectado no puede vaciar la biblioteca).
//   * Los Track IDs se completan con lo que ya conocemos del historial del chat
//     (nombre + artista coincidentes), sin salir a internet.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const EXTENSIONES = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.wma'];
const MAX_PROFUNDIDAD = 6;

function correr(comando, argumentos, opciones) {
  return new Promise(resolve => {
    execFile(comando, argumentos, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...(opciones || {}) }, (error, stdout, stderr) => {
      resolve({ ok: !error, error: error ? String(error.message || error) : '', stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function esAudio(nombre) {
  return EXTENSIONES.indexOf(path.extname(nombre).toLowerCase()) !== -1;
}

// "Artista - Titulo.mp3" -> { artista, titulo }
// Si el nombre no sigue esa forma (por ejemplo "Cumbias Recuerdo (95 - 2000)"),
// se usa el nombre completo como titulo y se deja el artista vacio: mejor un
// titulo largo que un titulo cortado al azar.
function desdeNombreArchivo(ruta) {
  const base = path.basename(ruta, path.extname(ruta)).replace(/_/g, ' ').trim();
  const corte = base.split(/\s+-\s+/);
  if (corte.length >= 2) {
    const artista = corte[0].trim();
    const titulo = corte.slice(1).join(' - ').trim();
    const tituloPobre = titulo.length < 5 || !/[a-zA-Záéíóúñü]{4}/i.test(titulo);
    if (artista && !tituloPobre) {
      return { artista: artista.slice(0, 200), titulo: titulo.slice(0, 300) };
    }
  }
  return { artista: '', titulo: base.slice(0, 300) };
}

function listarArchivos(carpeta, profundidad, salida) {
  let items = [];
  try {
    items = fs.readdirSync(carpeta, { withFileTypes: true });
  } catch (_) {
    return salida;
  }
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const completo = path.join(carpeta, item.name);
    if (item.isDirectory()) {
      if (profundidad < MAX_PROFUNDIDAD) listarArchivos(completo, profundidad + 1, salida);
      continue;
    }
    if (!item.isFile() || !esAudio(item.name)) continue;
    try {
      const info = fs.statSync(completo);
      salida.push({ ruta: completo, bytes: info.size, mtime: Math.round(info.mtimeMs) });
    } catch (_) { /* archivo ilegible: se saltea */ }
  }
  return salida;
}

function createBiblioteca(opciones) {
  const config = opciones || {};
  const db = config.db;
  const log = config.log || (() => {});
  const ffprobe = config.ffprobeBin || process.env.FFPROBE_BIN || 'ffprobe';
  const ejecutar = config.ejecutar || correr;               // inyectable en las pruebas
  const carpetaPorDefecto = config.carpeta || '';

  const disponible = () => !!db;

  // --- metadatos con ffprobe ------------------------------------------------
  async function metadatos(ruta) {
    const respuesta = await ejecutar(ffprobe, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ruta
    ]);
    if (!respuesta.ok) return { ok: false, error: respuesta.error || 'ffprobe fallo' };
    let datos = null;
    try { datos = JSON.parse(respuesta.stdout); } catch (error) { return { ok: false, error: 'ffprobe devolvio algo ilegible' }; }
    const formato = (datos && datos.format) || {};
    const etiquetas = formato.tags || {};
    const flujo = (datos.streams || []).find(s => s.codec_type === 'audio') || {};
    const duracion = Number(formato.duration || flujo.duration || 0);
    const delNombre = desdeNombreArchivo(ruta);
    return {
      ok: true,
      titulo: String(etiquetas.title || '').trim() || delNombre.titulo,
      artista: String(etiquetas.artist || etiquetas.album_artist || '').trim() || delNombre.artista,
      album: String(etiquetas.album || '').trim(),
      duracionMs: Number.isFinite(duracion) && duracion > 0 ? Math.round(duracion * 1000) : null
    };
  }

  // --- escaneo --------------------------------------------------------------
  async function escanear(opcionesEscaneo) {
    const opciones2 = opcionesEscaneo || {};
    const carpeta = path.resolve(opciones2.carpeta || carpetaPorDefecto || '');
    const salida = { carpeta, existe: !!carpeta && fs.existsSync(carpeta), vistos: 0, nuevos: 0, actualizados: 0, adoptados: 0, saltados: 0, sinLeer: 0, offline: 0, ids: 0, ms: 0, errores: [] };
    const arranque = Date.now();
    if (!carpeta || !salida.existe) {
      salida.ms = Date.now() - arranque;
      return salida;
    }
    if (!disponible()) { salida.errores.push('sin base de datos'); salida.ms = Date.now() - arranque; return salida; }

    const archivos = listarArchivos(carpeta, 0, []);
    salida.vistos = archivos.length;

    const buscar = db.prepare('SELECT id, file_size, file_mtime FROM tracks WHERE local_path = ?');
    // Ficha creada por el cancelador de letras (sin archivo todavia): se adopta
    // en vez de insertar una fila nueva, asi no quedan dos fichas del mismo tema.
    const buscarSinArchivo = db.prepare(`SELECT id FROM tracks
      WHERE local_path IS NULL AND LOWER(title) = LOWER(?) AND LOWER(COALESCE(artist,'')) = LOWER(?) ORDER BY id LIMIT 1`);
    const adoptar = db.prepare(`UPDATE tracks SET title = ?, artist = ?, album = COALESCE(NULLIF(?, ''), album), duration_ms = COALESCE(?, duration_ms),
      offline = 1, enabled = 1, local_path = ?, file_size = ?, file_mtime = ? WHERE id = ?`);
    const insertar = db.prepare(`INSERT INTO tracks (title, artist, album, duration_ms, offline, enabled, local_path, file_size, file_mtime, analysis_status)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, 'pending')`);
    const actualizarDatos = db.prepare('UPDATE tracks SET title = ?, artist = ?, album = ?, duration_ms = ?, offline = 1, file_size = ?, file_mtime = ? WHERE id = ?');
    const marcarFecha = db.prepare('UPDATE tracks SET file_size = ?, file_mtime = ?, offline = 1 WHERE id = ?');

    db.exec('BEGIN');
    try {
      for (const archivo of archivos) {
        const previo = buscar.get(archivo.ruta);
        if (previo) {
          if (previo.file_size === archivo.bytes && previo.file_mtime === archivo.mtime) {
            if (opciones2.forzar) {
              marcarFecha.run(archivo.bytes, archivo.mtime, previo.id);
              salida.actualizados += 1;
            } else {
              salida.saltados += 1;
              marcarFecha.run(archivo.bytes, archivo.mtime, previo.id);
            }
            continue;
          }
          const meta = await metadatos(archivo.ruta);
          if (!meta.ok) { salida.sinLeer += 1; salida.errores.push(archivo.ruta + ': ' + meta.error); continue; }
          actualizarDatos.run(meta.titulo, meta.artista, meta.album, meta.duracionMs, archivo.bytes, archivo.mtime, previo.id);
          salida.actualizados += 1;
          continue;
        }
        const meta = await metadatos(archivo.ruta);
        if (!meta.ok) { salida.sinLeer += 1; salida.errores.push(archivo.ruta + ': ' + meta.error); continue; }
        const ficha = buscarSinArchivo.get(meta.titulo, meta.artista);
        if (ficha) {
          adoptar.run(meta.titulo, meta.artista, meta.album, meta.duracionMs, archivo.ruta, archivo.bytes, archivo.mtime, ficha.id);
          salida.adoptados += 1;
          continue;
        }
        insertar.run(meta.titulo, meta.artista, meta.album, meta.duracionMs, archivo.ruta, archivo.bytes, archivo.mtime);
        salida.nuevos += 1;
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) { /* nada */ }
      salida.errores.push('transaccion: ' + error.message);
    }

    // Archivos que ya no estan: offline = 0 (no se borra nada)
    if (!opciones2.sinDesmarcar) {
      const faltantes = db.prepare('SELECT id, local_path FROM tracks WHERE offline = 1 AND local_path IS NOT NULL').all()
        .filter(fila => fila.local_path.toLowerCase().startsWith(carpeta.toLowerCase() + path.sep.toLowerCase()))
        .filter(fila => !fs.existsSync(fila.local_path));
      const apagar = db.prepare('UPDATE tracks SET offline = 0 WHERE id = ?');
      for (const fila of faltantes) { apagar.run(fila.id); salida.offline += 1; }
    }

    if (!opciones2.sinIds) salida.ids = completarIdsDesdeHistorial();

    salida.ms = Date.now() - arranque;
    log('scan: ' + salida.vistos + ' archivos, ' + salida.nuevos + ' nuevos, ' + salida.actualizados +
      ' actualizados, ' + salida.adoptados + ' adoptados, ' + salida.saltados + ' sin cambios, ' + salida.ms + ' ms' +
      (salida.offline ? ', ' + salida.offline + ' ya no estan' : ''));
    return salida;
  }

  // Completa spotify_track_id con lo que ya sabemos por el historial del chat
  // (mismo titulo + artista). Es offline: no sale a internet.
  function completarIdsDesdeHistorial() {
    if (!disponible()) return 0;
    let candidatos = [];
    try {
      candidatos = db.prepare(`SELECT DISTINCT track_name, track_artist, track_uri FROM interactions
        WHERE track_uri IS NOT NULL AND track_uri <> '' AND track_name IS NOT NULL AND track_name <> ''`).all();
    } catch (_) {
      return 0;   // la tabla interactions todavia no existe
    }
    const porNombre = new Map();
    for (const fila of candidatos) {
      const clave = (String(fila.track_name).toLowerCase().trim() + '|' + String(fila.track_artist || '').toLowerCase().trim());
      const id = String(fila.track_uri).replace('spotify:track:', '');
      if (id && !porNombre.has(clave)) porNombre.set(clave, id);
    }
    const pendientes = db.prepare("SELECT id, title, artist FROM tracks WHERE spotify_track_id IS NULL").all();
    const fijar = db.prepare('UPDATE tracks SET spotify_track_id = ? WHERE id = ?');
    let puestos = 0;
    for (const fila of pendientes) {
      const titulo = String(fila.title || '').toLowerCase().trim();
      let hallado = porNombre.get(titulo + '|' + String(fila.artist || '').toLowerCase().trim());
      if (!hallado) hallado = porNombre.get(titulo + '|');
      if (!hallado) {
        for (const [clave, id] of porNombre) {
          if (clave.split('|')[0] === titulo) { hallado = id; break; }
        }
      }
      if (hallado) { fijar.run(hallado, fila.id); puestos += 1; }
    }
    return puestos;
  }

  // --- consultas para el resto del sistema ----------------------------------
  function resumen() {
    if (!disponible()) return null;
    try { return db.prepare('SELECT * FROM v_biblioteca_resumen').get(); } catch (_) { return null; }
  }

  function listar(opcionesLista) {
    if (!disponible()) return [];
    const filtros = [];
    const valores = [];
    const opciones2 = opcionesLista || {};
    if (opciones2.offline) { filtros.push('offline = 1'); }
    if (opciones2.buscar) {
      filtros.push('(LOWER(title) LIKE ? OR LOWER(artist) LIKE ?)');
      const patron = '%' + String(opciones2.buscar).toLowerCase() + '%';
      valores.push(patron, patron);
    }
    const where = filtros.length ? ' WHERE ' + filtros.join(' AND ') : '';
    const limite = Math.min(500, Math.max(1, Number(opciones2.limite) || 100));
    return db.prepare(`SELECT id, spotify_track_id, title, artist, album, duration_ms, offline, enabled,
      start_at, end_at, analysis_status, lyrics_status FROM tracks${where} ORDER BY artist, title LIMIT ${limite}`).all(...valores);
  }

  function actualizar(id, cambios) {
    if (!disponible()) return false;
    const permitidos = ['title', 'artist', 'album', 'duration_ms', 'offline', 'enabled', 'start_at', 'end_at', 'skip_seconds', 'analysis_status', 'spotify_track_id'];
    const campos = Object.keys(cambios || {}).filter(clave => permitidos.indexOf(clave) !== -1);
    if (!campos.length) return false;
    const sets = campos.map(clave => clave + ' = ?').join(', ');
    const valores = campos.map(clave => cambios[clave]);
    db.prepare(`UPDATE tracks SET ${sets} WHERE id = ?`).run(...valores, id);
    return true;
  }

  return { escanear, metadatos, resumen, listar, actualizar, completarIdsDesdeHistorial, disponible, EXTENSIONES };
}

module.exports = { createBiblioteca, desdeNombreArchivo, EXTENSIONES };
