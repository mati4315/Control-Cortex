'use strict';
// Resolucion de letras: SQLite primero, despues la cache local de Spotify
// (opcional y apagada por defecto) y despues LRCLIB. Si ninguna tiene nada,
// se anota que esa cancion no tiene letra para no volver a preguntar.
//
// Regla de oro: esto NUNCA frena la reproduccion. Cualquier error se registra
// y se devuelve null.

const { createLrclib } = require('./lrclib');

const ESPERA_ENTRE_PEDIDOS_MS = 1000;    // limite amable para LRCLIB

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createLetras(opciones) {
  const config = opciones || {};
  const db = config.db;
  const log = config.log || (() => {});
  const lrclib = config.lrclib || createLrclib({ log, fetch: config.fetch });
  const leerCacheLocal = config.leerCacheLocal || null;      // funcion (tema) => normalizado|null
  const cacheLocalHabilitada = config.cacheLocal === true;   // apagada por defecto
  const fuentePreferida = config.fuentePreferida || 'lrclib';

  const disponible = () => !!db;

  function filaDeTrack(id) {
    return db.prepare('SELECT id, spotify_track_id, title, artist, album, duration_ms, lyrics_status FROM tracks WHERE id = ?').get(id);
  }

  function porSpotifyId(spotifyId) {
    return db.prepare('SELECT * FROM tracks WHERE spotify_track_id = ?').get(spotifyId);
  }

  // --- lectura desde la base ------------------------------------------------
  function leer(trackId) {
    if (!disponible()) return null;
    const fila = db.prepare('SELECT source, provider, language, synced, instrumental, duration_ms, lines_json FROM lyrics WHERE track_id = ?').get(trackId);
    if (!fila) return null;
    let lineas = [];
    try { lineas = JSON.parse(fila.lines_json); } catch (_) { lineas = []; }
    return {
      trackId,
      source: fila.source,
      provider: fila.provider,
      language: fila.language,
      synced: fila.synced === 1,
      instrumental: fila.instrumental === 1,
      lines: Array.isArray(lineas) ? lineas : []
    };
  }

  function guardar(trackId, letra) {
    if (!disponible() || !letra) return false;
    const lineas = Array.isArray(letra.lines) ? letra.lines : [];
    db.prepare(`INSERT INTO lyrics (track_id, source, language, synced, instrumental, provider, duration_ms, lines_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        source = excluded.source, language = excluded.language, synced = excluded.synced,
        instrumental = excluded.instrumental, provider = excluded.provider,
        duration_ms = excluded.duration_ms, lines_json = excluded.lines_json,
        fetched_at = datetime('now')`)
      .run(trackId, letra.source || 'manual', letra.language || null, letra.synced ? 1 : 0,
        letra.instrumental ? 1 : 0, letra.provider || null, letra.durationMs || null, JSON.stringify(lineas));
    db.prepare("UPDATE tracks SET lyrics_status = 'ok', lyrics_checked_at = datetime('now') WHERE id = ?").run(trackId);
    return true;
  }

  function marcarSinLetra(trackId) {
    if (!disponible()) return;
    db.prepare("UPDATE tracks SET lyrics_status = 'none', lyrics_checked_at = datetime('now') WHERE id = ?").run(trackId);
  }

  // Busca una ficha que sirva para guardar la letra: primero por id de Spotify,
  // despues por titulo + artista. Si no hay ninguna, la crea (sin archivo local):
  // asi la letra de CUALQUIER tema que suene queda cacheada, este o no en la
  // biblioteca, y la segunda vez ya no se consulta internet.
  function fichaPara(tema) {
    if (tema.id) {
      const porId = filaDeTrack(tema.id);
      if (porId) return porId;
    }
    if (tema.spotifyId) {
      const porSpotify = porSpotifyId(tema.spotifyId);
      if (porSpotify) return porSpotify;
    }
    const titulo = String(tema.titulo || '').trim();
    const artista = String(tema.artista || '').trim();
    if (!titulo) return null;
    const porNombre = db.prepare(`SELECT * FROM tracks WHERE LOWER(title) = LOWER(?) AND LOWER(COALESCE(artist,'')) = LOWER(?) ORDER BY id LIMIT 1`)
      .get(titulo, artista);
    if (porNombre) {
      // Si recien ahora sabemos el id de Spotify, se lo anota.
      if (tema.spotifyId && !porNombre.spotify_track_id) {
        try { db.prepare('UPDATE tracks SET spotify_track_id = ? WHERE id = ?').run(tema.spotifyId, porNombre.id); } catch (_) { /* ya existe en otra fila */ }
      }
      return porNombre;
    }
    try {
      const info = db.prepare(`INSERT INTO tracks (title, artist, album, duration_ms, offline, enabled, spotify_track_id, lyrics_status)
        VALUES (?, ?, ?, ?, 0, 0, ?, 'pending')`)
        .run(titulo, artista, String(tema.album || ''), Number(tema.duracionMs) || null, tema.spotifyId || null);
      return filaDeTrack(Number(info.lastInsertRowid));
    } catch (_) {
      return null;
    }
  }

  // --- resolucion -----------------------------------------------------------
  // tema: { id?, spotifyId?, titulo, artista, album, duracionMs }
  async function resolver(tema, opcionesResolver) {
    const opciones2 = opcionesResolver || {};
    const temaNormal = {
      titulo: String(tema.titulo || '').trim(),
      artista: String(tema.artista || '').trim(),
      album: String(tema.album || '').trim(),
      duracionMs: Number(tema.duracionMs) || 0
    };
    if (!temaNormal.titulo) return null;

    // Averiguar de que ficha estamos hablando (se crea si hace falta).
    const fila = !disponible() ? null
      : (opciones2.sinGuardar
        ? (tema.id ? filaDeTrack(tema.id) : (tema.spotifyId ? porSpotifyId(tema.spotifyId) : null))
        : fichaPara(tema));

    // 1) SQLite
    if (fila) {
      const guardada = leer(fila.id);
      if (guardada) return guardada;
      if (!opciones2.forzar && fila.lyrics_status === 'none' && !opciones2.reintentarVacios) {
        return null;    // ya sabemos que no tiene letra: no se vuelve a preguntar
      }
    }

    // 2) cache local de Spotify (opcional)
    if (cacheLocalHabilitada && typeof leerCacheLocal === 'function') {
      try {
        const local = await leerCacheLocal(temaNormal);
        if (local && Array.isArray(local.lines) && local.lines.length) {
          if (fila) guardar(fila.id, local);
          log('letras: ' + temaNormal.titulo + ' desde la cache local de Spotify');
          return { ...local, trackId: fila ? fila.id : null };
        }
      } catch (error) {
        log('letras: la cache local fallo (' + (error && error.message) + '): se sigue con LRCLIB');
      }
    }

    // 3) LRCLIB
    const respuesta = await lrclib.buscar(temaNormal);
    const deLrclib = respuesta && respuesta.letra ? respuesta.letra : null;
    const falloLaRed = !!(respuesta && respuesta.errorRed);
    if (deLrclib && deLrclib.instrumental) {
      if (fila) guardar(fila.id, deLrclib);
      return { ...deLrclib, trackId: fila ? fila.id : null };
    }
    if (deLrclib && deLrclib.lines.length) {
      if (fila) guardar(fila.id, deLrclib);
      log('letras: ' + temaNormal.titulo + ' desde ' + fuentePreferida);
      return { ...deLrclib, trackId: fila ? fila.id : null };
    }

    // 4) nada
    // Si fue un problema de red NO se marca: la proxima vez se vuelve a intentar.
    if (fila && !falloLaRed) marcarSinLetra(fila.id);
    if (falloLaRed) log('letras: no se pudo consultar LRCLIB para ' + temaNormal.titulo + ' (problema de red)');
    return null;
  }

  // Trae de a poco las letras que faltan (1 por segundo como maximo).
  // Devuelve cuantas consiguio. Se usa desde el dashboard o al arrancar.
  async function traerFaltantes(cantidad, opcionesTraer) {
    if (!disponible()) return { intentadas: 0, encontradas: 0, ms: 0 };
    const opciones2 = opcionesTraer || {};
    const tope = Math.max(1, Math.min(200, Number(cantidad) || 10));
    const arranque = Date.now();
    const filas = db.prepare(`SELECT id, spotify_track_id, title, artist, album, duration_ms FROM tracks
      WHERE lyrics_status = 'pending' ORDER BY id LIMIT ?`).all(tope);
    const resumen = { intentadas: 0, encontradas: 0, ms: 0 };
    for (const fila of filas) {
      resumen.intentadas += 1;
      const letra = await resolver({ id: fila.id, titulo: fila.title, artista: fila.artist, album: fila.album, duracionMs: fila.duration_ms });
      if (letra) resumen.encontradas += 1;
      if (opciones2.esperaMs !== 0 && resumen.intentadas < filas.length) await dormir(Number(opciones2.esperaMs) || ESPERA_ENTRE_PEDIDOS_MS);
    }
    resumen.ms = Date.now() - arranque;
    return resumen;
  }

  function estado() {
    if (!disponible()) return null;
    const porEstado = {};
    for (const fila of db.prepare('SELECT lyrics_status AS estado, COUNT(*) AS n FROM tracks GROUP BY lyrics_status').all()) {
      porEstado[fila.estado] = fila.n;
    }
    const porFuente = {};
    for (const fila of db.prepare('SELECT source, COUNT(*) AS n FROM lyrics GROUP BY source').all()) porFuente[fila.source] = fila.n;
    const tamano = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(lines_json)), 0) AS bytes FROM lyrics').get();
    return { porEstado, porFuente, guardadas: tamano.n, kb: Math.round(tamano.bytes / 1024) };
  }

  return { resolver, leer, guardar, marcarSinLetra, traerFaltantes, estado, disponible };
}

module.exports = { createLetras };
