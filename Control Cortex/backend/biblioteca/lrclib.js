'use strict';
// Cliente de LRCLIB (lrclib.net): letras sincronizadas sin cuenta ni clave.
//
// Detalles que importan (verificados):
//   * /api/get devuelve syncedLyrics en formato LRC ([mm:ss.xx] texto).
//   * Cuando NO hay letra, puede responder HTTP 200 con { error: true }
//     o HTTP 404: hay que mirar los dos casos, no alcanza con el status.
//   * La duracion que devuelve sirve para validar que la letra es de la version
//     correcta (evita pegar la letra de otro remix).
//   * Hay que mandar una cabecera que identifique al cliente.

const URL_BASE = 'https://lrclib.net';
const CLIENTE = 'ControlCortex-Rulo/1.0 (https://github.com/mati4315/Control-Cortex---rulo-spotify)';

// "[01:23.45] texto" -> { startMs, text }   (admite varias marcas por linea)
function parsearLRC(texto) {
  const lineas = [];
  const renglones = String(texto || '').split(/\r?\n/);
  const marca = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const renglon of renglones) {
    const marcas = [];
    let coincidencia;
    marca.lastIndex = 0;
    while ((coincidencia = marca.exec(renglon)) !== null) {
      const minutos = Number(coincidencia[1]);
      const segundos = Number(coincidencia[2]);
      const resto = coincidencia[3] ? Number(('0.' + coincidencia[3])) : 0;
      marcas.push(Math.round((minutos * 60 + segundos + resto) * 1000));
    }
    if (!marcas.length) continue;
    const letra = renglon.replace(/\[[^\]]*\]/g, '').trim();
    for (const ms of marcas) lineas.push({ startMs: ms, text: letra });
  }
  lineas.sort((a, b) => a.startMs - b.startMs);
  // endMs = cuando empieza la siguiente linea (la ultima dura 4 s)
  return lineas.map((linea, indice) => ({
    startMs: linea.startMs,
    endMs: indice + 1 < lineas.length ? Math.max(lineas[indice + 1].startMs, linea.startMs + 500) : linea.startMs + 4000,
    text: linea.text
  }));
}

function normalizarSinTildes(texto) {
  return String(texto || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function createLrclib(opciones) {
  const config = opciones || {};
  const base = (config.urlBase || URL_BASE).replace(/\/$/, '');
  const hacerFetch = config.fetch || globalThis.fetch;
  const timeoutMs = Number(config.timeoutMs) || 8000;
  const log = config.log || (() => {});
  const cliente = config.cliente || CLIENTE;

  async function pedir(ruta) {
    if (typeof hacerFetch !== 'function') return { ok: false, motivo: 'sin fetch' };
    const controlador = typeof AbortController === 'function' ? new AbortController() : null;
    const reloj = controlador ? setTimeout(() => controlador.abort(), timeoutMs) : null;
    try {
      const respuesta = await hacerFetch(base + ruta, {
        headers: { 'Lrclib-Client': cliente, 'Accept': 'application/json' },
        signal: controlador ? controlador.signal : undefined
      });
      if (!respuesta || respuesta.status === 404) return { ok: false, motivo: 'no-esta' };
      if (!respuesta.ok) return { ok: false, motivo: 'http-' + respuesta.status };
      const datos = await respuesta.json();
      if (datos && datos.error === true) return { ok: false, motivo: 'sin-letra' };
      return { ok: true, datos };
    } catch (error) {
      return { ok: false, motivo: 'error-red', detalle: String(error && error.message || error) };
    } finally {
      if (reloj) clearTimeout(reloj);
    }
  }

  // Normaliza la respuesta de LRCLIB al formato interno unico.
  function normalizar(datos) {
    if (!datos) return null;
    const sincronizada = parsearLRC(datos.syncedLyrics);
    let lineas = sincronizada;
    let synced = sincronizada.length > 0;
    if (!synced && datos.plainLyrics) {
      // Sin tiempos: se reparten parejo (mejor que no mostrar nada). synced = false.
      lineas = String(datos.plainLyrics).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        .map((texto, indice) => ({ startMs: indice * 3500, endMs: (indice + 1) * 3500, text: texto }));
    }
    return {
      source: 'lrclib',
      provider: 'LRCLIB',
      id: datos.id || null,
      language: datos.language || null,
      synced,
      instrumental: datos.instrumental === true,
      durationMs: datos.duration ? Math.round(Number(datos.duration) * 1000) : null,
      lines: lineas
    };
  }

  // Busca por artista + titulo (+ album y duracion).
  // Devuelve { letra: normalizado|null, errorRed: bool }.
  // La diferencia importa: si fue un problema de red NO hay que dar la cancion
  // por "sin letra" (manana puede estar disponible).
  async function buscar(tema) {
    const parametros = new URLSearchParams({ artist_name: String(tema.artista || ''), track_name: String(tema.titulo || '') });
    if (tema.album) parametros.set('album_name', tema.album);
    if (tema.duracionMs) parametros.set('duration', String(Math.round(tema.duracionMs / 1000)));
    const directa = await pedir('/api/get?' + parametros.toString());
    if (directa.ok) {
      const letra = normalizar(directa.datos);
      if (letra && validar(letra, tema)) return { letra, errorRed: false };
      if (letra && letra.instrumental) return { letra, errorRed: false };
    }
    if (directa.motivo === 'error-red') return { letra: null, errorRed: true };   // sin red: no insistir

    // Segundo intento: busqueda abierta y eleccion del mejor candidato.
    const consulta = [tema.titulo, tema.artista].filter(Boolean).join(' ').trim();
    if (consulta.length < 3) return null;
    const busqueda = await pedir('/api/search?q=' + encodeURIComponent(consulta));
    if (busqueda.motivo === 'error-red') return { letra: null, errorRed: true };
    if (!busqueda.ok || !Array.isArray(busqueda.datos) || !busqueda.datos.length) return { letra: null, errorRed: false };

    const esperado = normalizarSinTildes(tema.titulo);
    const mejor = busqueda.datos
      .map(candidato => {
        let puntaje = 0;
        const titulo = normalizarSinTildes(candidato.trackName);
        const artista = normalizarSinTildes(candidato.artistName);
        if (titulo === esperado) puntaje += 5;
        else if (titulo.indexOf(esperado) !== -1 || esperado.indexOf(titulo) !== -1) puntaje += 3;
        if (tema.artista && artista.indexOf(normalizarSinTildes(tema.artista)) !== -1) puntaje += 2;
        if (tema.duracionMs && candidato.duration) {
          const diferencia = Math.abs(Number(candidato.duration) * 1000 - tema.duracionMs);
          if (diferencia <= 3000) puntaje += 4;
          else if (diferencia <= 8000) puntaje += 1;
          else puntaje -= 2;
        }
        return { candidato, puntaje };
      })
      .sort((a, b) => b.puntaje - a.puntaje)[0];

    if (!mejor || mejor.puntaje < 3) return { letra: null, errorRed: false };
    const letra = normalizar(mejor.candidato);
    return { letra: letra && validar(letra, tema) ? letra : null, errorRed: false };
  }

  // La letra tiene que ser de esta version: si la duracion difiere mucho, se descarta.
  function validar(letra, tema) {
    if (!letra) return false;
    if (letra.instrumental) return true;
    if (!letra.lines.length) return false;
    const partes = (letra.durationMs || 0) / 1000;
    if (tema && tema.duracionMs && partes) {
      const diferenciaSeg = Math.abs(partes - tema.duracionMs / 1000);
      if (diferenciaSeg > 10) return false;
    }
    return true;
  }

  // Compatibilidad: devuelve solo la letra (para quien no le interese el motivo).
  async function letra(tema) {
    const resultado = await buscar(tema);
    return resultado && resultado.letra ? resultado.letra : null;
  }

  return { buscar, letra, buscarPorNombre: (t, a) => letra({ titulo: t, artista: a }), parsearLRC, normalizar, validar };
}

module.exports = { createLrclib, parsearLRC };
