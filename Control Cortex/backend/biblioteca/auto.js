'use strict';
// Modo automatico de la biblioteca: elige que suena cuando nadie pidio nada.
//
// Reglas:
//   * solo canciones offline = 1, enabled = 1, con Track ID de Spotify y que no
//     hayan sonado hoy en automatico (las manuales pueden repetir);
//   * la eleccion se hace en RAM (nada de ORDER BY RANDOM() por tema);
//   * cuando se agota el catalogo del dia arranca un ciclo nuevo: no se bloquea;
//   * la regla diaria tambien la garantiza la base (indice unico parcial), asi
//     que un doble registro no rompe nada.

const DB = require('../db');

function createAuto(opciones) {
  const config = opciones || {};
  const db = config.db;
  const log = config.log || (() => {});
  const fechaLogica = config.fechaLogica || (() => DB.fechaLogica());

  let lista = [];
  let reproducidasHoy = new Set();
  let ciclo = 1;
  let cargado = false;
  // Modo automatico: cuando nadie pide nada, la biblioteca pone musica.
  let habilitado = false;
  let esperaSegundos = 240;     // cuanto silencio tiene que haber para arrancar
  let ultimaActividad = 0;      // ultimo pedido/comando de alguien
  let proximoPermitido = 0;     // cuando se puede volver a elegir
  const ahora = () => (typeof config.ahora === 'function' ? config.ahora() : Date.now());

  const disponible = () => !!db;

  // Arma la lista en RAM: solo lo que se puede elegir y tiene Track ID.
  function cargar() {
    if (!disponible()) return { candidatas: 0 };
    const hoy = fechaLogica();
    lista = db.prepare(`SELECT id, spotify_track_id, title, artist, duration_ms, start_at, end_at
      FROM tracks
      WHERE offline = 1 AND enabled = 1 AND spotify_track_id IS NOT NULL AND spotify_track_id <> ''`).all();
    // Se retoma el ciclo en el que ibamos (si el backend se reinicio en el medio).
    const ultimo = db.prepare("SELECT MAX(cycle) AS n FROM play_history WHERE played_date = ? AND play_mode = 'auto'").get(hoy);
    ciclo = Math.max(1, Number(ultimo && ultimo.n) || 1);
    reproducidasHoy = new Set(db.prepare("SELECT track_id FROM play_history WHERE played_date = ? AND play_mode = 'auto' AND cycle = ?")
      .all(hoy, ciclo).map(fila => fila.track_id));
    cargado = true;
    log('automatico: ' + lista.length + ' canciones en la biblioteca, ciclo ' + ciclo + ', ' + reproducidasHoy.size + ' ya sonaron');
    return { candidatas: lista.length, reproducidasHoy: reproducidasHoy.size, ciclo };
  }

  function candidatas() {
    if (!cargado) cargar();
    return lista.filter(tema => !reproducidasHoy.has(tema.id));
  }

  // Elige una al azar. Si no queda ninguna, arranca un ciclo nuevo.
  function elegir() {
    if (!cargado) cargar();
    if (!lista.length) return { tema: null, motivo: 'la biblioteca esta vacia' };
    let libres = candidatas();
    let reinicio = false;
    if (!libres.length) {
      reproducidasHoy = new Set();
      ciclo += 1;
      reinicio = true;
      libres = lista.slice();
      log('automatico: se agotaron las canciones del ciclo ' + (ciclo - 1) + ': arranca el ciclo ' + ciclo);
    }
    const tema = libres[Math.floor(Math.random() * libres.length)];
    return {
      ciclo,
      tema: {
        id: tema.id,
        uri: 'spotify:track:' + tema.spotify_track_id,
        titulo: tema.title,
        artista: tema.artist,
        durationMs: tema.duration_ms,
        startAt: tema.start_at,
        endAt: tema.end_at
      },
      reinicio,
      ciclo,
      quedan: libres.length - 1,
      motivo: ''
    };
  }

  // Registra la reproduccion. En automatico la base rechaza el repetido del ciclo.
  function registrar(trackId, detalles) {
    if (!disponible()) return false;
    const info = detalles || {};
    const modo = info.modo === 'manual' ? 'manual' : 'auto';
    const fecha = info.fecha || fechaLogica();
    const vuelta = Number(info.ciclo) || ciclo || 1;
    const insertar = modo === 'auto'
      ? db.prepare(`INSERT OR IGNORE INTO play_history (track_id, played_date, play_mode, cycle, play_source, start_at, end_at) VALUES (?, ?, 'auto', ?, ?, ?, ?)`)
      : db.prepare(`INSERT INTO play_history (track_id, played_date, play_mode, cycle, play_source, start_at, end_at) VALUES (?, ?, 'manual', ?, ?, ?, ?)`);
    const resultado = insertar.run(trackId, fecha, vuelta, info.origen || 'spotify', info.startAt === undefined ? null : info.startAt, info.endAt === undefined ? null : info.endAt);
    if (modo === 'auto') reproducidasHoy.add(trackId);
    return resultado.changes > 0;
  }

  function estado() {
    if (!disponible()) return null;
    const hoy = fechaLogica();
    return {
      ciclo,
      habilitado,
      esperaSegundos,
      puede: puedeElegir(),
      proximoEnMs: Math.max(0, proximoPermitido - ahora()),
      cargado,
      enBiblioteca: lista.length,
      candidatas: candidatas().length,
      reproducidasHoy: reproducidasHoy.size,
      historial: db.prepare(`SELECT play_mode, COUNT(*) AS n FROM play_history WHERE played_date = ? GROUP BY play_mode`).all(hoy)
        .reduce((acc, fila) => { acc[fila.play_mode] = fila.n; return acc; }, {})
    };
  }

  // Para probar el cambio de dia sin esperar a medianoche.
  function recargar() { cargado = false; return cargar(); }

  // --- cuando corresponde poner musica solo ---------------------------------
  function configurar(opciones3) {
    const o = opciones3 || {};
    if (o.habilitado !== undefined) habilitado = o.habilitado === true;
    if (Number(o.esperaSegundos) > 0) esperaSegundos = Math.max(30, Math.min(3600, Math.round(Number(o.esperaSegundos))));
    return { habilitado, esperaSegundos };
  }

  // Cualquier pedido o comando de una persona cuenta como actividad.
  function marcarActividad() { ultimaActividad = ahora(); }

  // ¿Se puede elegir ahora? Devuelve el motivo cuando no.
  function puedeElegir(cuando) {
    const t = Number(cuando) || ahora();
    if (!habilitado) return { si: false, motivo: 'el modo automatico esta apagado' };
    if (t < proximoPermitido) return { si: false, motivo: 'esperando a que termine lo que suena', faltanMs: proximoPermitido - t };
    if (ultimaActividad) {
      const quieto = t - ultimaActividad;
      const falta = esperaSegundos * 1000 - quieto;
      if (falta > 0) return { si: false, motivo: 'hubo pedidos hace poco', faltanMs: falta };
    }
    return { si: true, motivo: '' };
  }

  // Despues de encolar una cancion: no volver a elegir hasta que termine.
  function programarSiguiente(duracionMs, margenMs) {
    const duracion = Number(duracionMs) > 0 ? Number(duracionMs) : 180000;
    proximoPermitido = ahora() + duracion + (margenMs === undefined ? 25000 : Number(margenMs));
    return proximoPermitido;
  }

  // Cuando una cancion se corta en su final logico (end_at), la siguiente entra enseguida.
  function adelantarSiguiente(ms) {
    const objetivo = ahora() + (Number(ms) > 0 ? Number(ms) : 5000);
    proximoPermitido = Math.min(proximoPermitido || objetivo, objetivo);
    return proximoPermitido;
  }

  return {
    cargar, recargar, candidatas, elegir, registrar, estado, disponible,
    configurar, marcarActividad, puedeElegir, programarSiguiente, adelantarSiguiente
  };
}

module.exports = { createAuto };
