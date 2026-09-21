'use strict';
// Analisis de inicio/final de cada cancion con ffmpeg.
//
// Nunca decodifica la cancion completa: mide SOLO los primeros 15 s y los
// ultimos 15 s (medido: ~0,35 s por punta). Guarda start_at/end_at en la base
// y deja el detalle crudo de ffmpeg para poder reajustar sin volver a analizar.
//
// Reglas (las mismas de la guia):
//   * 0 <= start_at <= 15 y duracion - 15 <= end_at <= duracion
//   * start_at < end_at
//   * si algo no cierra: fallback start_at = 0, end_at = duracion
//   * analysis_status = 'manual' nunca se pisa
//   * nada de esto puede frenar la reproduccion: los errores se anotan y listo

const { execFile } = require('child_process');

const UMBRAL_SILENCIO = '-30dB';
const DURACION_SILENCIO = '0.25';
const PUNTA_MS = 15000;

function correr(comando, argumentos) {
  return new Promise(resolve => {
    execFile(comando, argumentos, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, error: error ? String(error.message || error) : '', salida: String(stderr || '') + String(stdout || '') });
    });
  });
}

// Lee del texto de ffmpeg los silencios y los volumenes.
function leerMediciones(texto) {
  const silencios = [];
  const expresion = /silence_start:\s*(-?[\d.]+)|silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;
  let abierto = null;
  let coincidencia;
  while ((coincidencia = expresion.exec(texto)) !== null) {
    if (coincidencia[1] !== undefined) {
      abierto = Number(coincidencia[1]);
    } else if (abierto !== null) {
      silencios.push({ desde: abierto, hasta: Number(coincidencia[2]), duracion: Number(coincidencia[3]) });
      abierto = null;
    }
  }
  const medio = /mean_volume:\s*(-?[\d.]+) dB/.exec(texto);
  const maximo = /max_volume:\s*(-?[\d.]+) dB/.exec(texto);
  return {
    silencios,
    medioDb: medio ? Number(medio[1]) : null,
    maxDb: maximo ? Number(maximo[1]) : null
  };
}

function redondear(valor) {
  return Math.round(valor * 10) / 10;
}

// Calcula start_at / end_at a partir de las dos puntas medidas.
function calcular(duracionSeg, cabeza, cola, puntaSeg) {
  const punta = Math.min(puntaSeg || PUNTA_MS / 1000, duracionSeg);
  const resultado = {
    startAt: 0,
    endAt: redondear(duracionSeg),
    motivo: 'sin ajustes: no se detecto silencio en las puntas',
    ambiguo: false,
    valido: true
  };

  // Inicio: si el silencio arranca al principio, se salta hasta donde termina.
  const inicial = cabeza.silencios.find(s => s.desde <= 0.5);
  if (inicial && inicial.hasta > 0.5) {
    if (inicial.hasta >= punta - 0.05) {
      resultado.motivo = 'el silencio inicial ocupa toda la punta medida';
      resultado.ambiguo = true;
    } else if (inicial.hasta <= punta) {
      resultado.startAt = redondear(inicial.hasta);
      resultado.motivo = 'silencio inicial de ' + redondear(inicial.hasta) + ' s';
    }
  } else if (cabeza.medioDb !== null && cabeza.medioDb < -45) {
    // Punta casi muda sin silencio declarado: caso ambiguo (para revisar o IA).
    resultado.ambiguo = true;
    resultado.motivo = 'volumen muy bajo en el inicio (' + cabeza.medioDb + ' dB)';
  }

  // Final: si el silencio termina al final de la punta, se corta donde empieza.
  const final = cola.silencios.find(s => s.hasta >= punta - 0.05);
  if (final) {
    const absoluto = duracionSeg - punta + final.desde;
    if (absoluto >= duracionSeg - punta - 0.05 && absoluto > resultado.startAt) {
      resultado.endAt = redondear(absoluto);
      resultado.motivo = (resultado.motivo === 'sin ajustes: no se detecto silencio en las puntas' ? '' : resultado.motivo + ' + ') +
        'silencio final de ' + redondear(duracionSeg - absoluto) + ' s';
    } else if (absoluto <= resultado.startAt) {
      resultado.ambiguo = true;
      resultado.motivo = 'el silencio final dejaria la cancion vacia';
    }
  } else if (cola.medioDb !== null && cola.medioDb < -45) {
    resultado.ambiguo = true;
    resultado.motivo = 'volumen muy bajo en el final (' + cola.medioDb + ' dB)';
  }

  // Validacion final: si no cierra, fallback seguro.
  const cierra = resultado.startAt >= 0 && resultado.startAt <= punta &&
    resultado.endAt >= duracionSeg - punta - 0.05 && resultado.endAt <= duracionSeg &&
    resultado.startAt < resultado.endAt;
  if (!cierra) {
    resultado.startAt = 0;
    resultado.endAt = redondear(duracionSeg);
    resultado.motivo = 'valores fuera de rango: se usa el fallback (0 a ' + resultado.endAt + ')';
    resultado.valido = false;
  }
  return resultado;
}

function createAnalisis(opciones) {
  const config = opciones || {};
  const db = config.db;
  const log = config.log || (() => {});
  const ffmpeg = config.ffmpegBin || process.env.FFMPEG_BIN || 'ffmpeg';
  const ejecutar = config.ejecutar || correr;
  const maxIntentos = Number(config.maxIntentos) || 3;
  // Punta a medir (15 s por defecto) y duracion minima para analizar.
  const puntaSeg = Number(config.puntaSeg) > 0 ? Number(config.puntaSeg) : PUNTA_MS / 1000;
  const minimoMs = Number(config.minimoMs) > 0 ? Number(config.minimoMs) : PUNTA_MS * 2;

  const disponible = () => !!db;

  // --- medicion de una cancion ---------------------------------------------
  async function medir(ruta, duracionMs) {
    const durMs = Number(duracionMs) || 0;
    if (!durMs || durMs < minimoMs) {
      // Menos de 30 s: no tiene sentido buscar silencios en las puntas.
      const duracionSeg = durMs / 1000;
      return { startAt: 0, endAt: redondear(duracionSeg), motivo: 'cancion corta: no se analiza', ambiguo: false, valido: true, detalle: null };
    }
    const duracionSeg = durMs / 1000;
    const cabeza = await ejecutar(ffmpeg, ['-v', 'info', '-ss', '0', '-t', String(puntaSeg), '-i', ruta,
      '-af', 'silencedetect=noise=' + UMBRAL_SILENCIO + ':d=' + DURACION_SILENCIO + ',volumedetect', '-f', 'null', '-']);
    if (!cabeza.ok) return { error: 'ffmpeg fallo en el inicio: ' + cabeza.error };
    const cola = await ejecutar(ffmpeg, ['-v', 'info', '-sseof', '-' + String(puntaSeg), '-i', ruta,
      '-af', 'silencedetect=noise=' + UMBRAL_SILENCIO + ':d=' + DURACION_SILENCIO + ',volumedetect', '-f', 'null', '-']);
    if (!cola.ok) return { error: 'ffmpeg fallo en el final: ' + cola.error };

    const medicionCabeza = leerMediciones(cabeza.salida);
    const medicionCola = leerMediciones(cola.salida);
    const calculo = calcular(duracionSeg, medicionCabeza, medicionCola, puntaSeg);
    return { ...calculo, detalle: { cabeza: medicionCabeza, cola: medicionCola } };
  }

  // --- analizar una cancion de la biblioteca -------------------------------
  async function analizar(id, opcionesAnalisis) {
    if (!disponible()) return { ok: false, error: 'sin base de datos' };
    const fila = db.prepare('SELECT id, local_path, duration_ms, analysis_status FROM tracks WHERE id = ?').get(id);
    if (!fila) return { ok: false, error: 'no existe la cancion ' + id };
    if (fila.analysis_status === 'manual' && !(opcionesAnalisis && opcionesAnalisis.forzar)) {
      return { ok: false, error: 'definida a mano: no se toca', motivo: 'manual' };
    }
    if (!fila.local_path) return { ok: false, error: 'no tiene archivo local' };

    const medicion = await medir(fila.local_path, fila.duration_ms);
    if (medicion.error) return { ok: false, error: medicion.error };

    const estado = medicion.ambiguo && !medicion.valido ? 'manual_review' : 'completed';
    db.prepare(`UPDATE tracks SET start_at = ?, end_at = ?, analysis_status = ?, detalle_analisis = ? WHERE id = ?`)
      .run(medicion.startAt, medicion.endAt, estado, JSON.stringify({
        motivo: medicion.motivo, ambiguo: medicion.ambiguo, valido: medicion.valido,
        medido: medicion.detalle, cuando: new Date().toISOString()
      }), id);
    log('analisis: track=' + id + ' start_at=' + medicion.startAt + ' end_at=' + medicion.endAt + ' (' + medicion.motivo + ')');
    return { ok: true, ...medicion, estado };
  }

  // --- cola de trabajos -----------------------------------------------------
  function encolarPendientes(limite) {
    if (!disponible()) return 0;
    const tope = Number(limite) || 5000;
    const filas = db.prepare(`SELECT id FROM tracks WHERE offline = 1 AND local_path IS NOT NULL AND analysis_status = 'pending' ORDER BY id LIMIT ?`).all(tope);
    const insertar = db.prepare("INSERT OR IGNORE INTO analysis_jobs (track_id, kind, status) VALUES (?, 'offset', 'pending')");
    let encolados = 0;
    db.exec('BEGIN');
    try {
      for (const fila of filas) encolados += insertar.run(fila.id).changes;
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) { /* nada */ }
      log('no se pudo encolar: ' + error.message);
      return 0;
    }
    return encolados;
  }

  // Toma un trabajo pendiente salteando los que ya se intentaron en este lote:
  // un archivo roto no puede quemar sus 3 intentos de una sola vez.
  function tomarTrabajo(yaIntentados) {
    const excluidos = yaIntentados || new Set();
    const candidatos = db.prepare("SELECT id FROM analysis_jobs WHERE status = 'pending' AND kind = 'offset' ORDER BY id LIMIT 25").all();
    const candidato = candidatos.find(fila => !excluidos.has(fila.id));
    if (!candidato) return null;
    excluidos.add(candidato.id);
    const tomado = db.prepare(`UPDATE analysis_jobs SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1
      WHERE id = ? AND status = 'pending'`).run(candidato.id);
    if (!tomado.changes) return null;
    return db.prepare('SELECT id, track_id, attempts FROM analysis_jobs WHERE id = ?').get(candidato.id);
  }

  async function procesarLote(cantidad) {
    if (!disponible()) return { procesados: 0, ok: 0, fallados: 0, ms: 0 };
    const arranque = Date.now();
    const total = Math.max(1, Math.min(200, Number(cantidad) || 10));
    const resumen = { procesados: 0, ok: 0, fallados: 0, pendientes: 0, ms: 0, errores: [] };
    const intentados = new Set();
    for (let i = 0; i < total; i += 1) {
      const trabajo = tomarTrabajo(intentados);
      if (!trabajo) break;
      resumen.procesados += 1;
      const resultado = await analizar(trabajo.track_id);
      if (resultado.ok) {
        resumen.ok += 1;
        db.prepare("UPDATE analysis_jobs SET status = 'completed', finished_at = datetime('now'), error_message = NULL WHERE id = ?").run(trabajo.id);
      } else {
        resumen.fallados += 1;
        resumen.errores.push(String(resultado.error).slice(0, 200));
        if (resultado.motivo === 'manual') {
          db.prepare("UPDATE analysis_jobs SET status = 'completed', finished_at = datetime('now'), error_message = 'definida a mano' WHERE id = ?").run(trabajo.id);
          resumen.fallados -= 1;
        } else if (trabajo.attempts >= maxIntentos) {
          db.prepare("UPDATE analysis_jobs SET status = 'manual_review', finished_at = datetime('now'), error_message = ? WHERE id = ?")
            .run(String(resultado.error).slice(0, 300), trabajo.id);
          db.prepare("UPDATE tracks SET analysis_status = 'failed' WHERE id = ?").run(trabajo.track_id);
        } else {
          db.prepare("UPDATE analysis_jobs SET status = 'pending', started_at = NULL, error_message = ? WHERE id = ?")
            .run(String(resultado.error).slice(0, 300), trabajo.id);
        }
      }
    }
    resumen.pendientes = db.prepare("SELECT COUNT(*) AS n FROM analysis_jobs WHERE status = 'pending'").get().n;
    resumen.ms = Date.now() - arranque;
    return resumen;
  }

  function estado() {
    if (!disponible()) return null;
    const trabajos = db.prepare("SELECT status, COUNT(*) AS n FROM analysis_jobs GROUP BY status").all();
    const porEstado = {};
    for (const fila of trabajos) porEstado[fila.status] = fila.n;
    const tracks = db.prepare('SELECT analysis_status, COUNT(*) AS n FROM tracks GROUP BY analysis_status').all();
    const porTrack = {};
    for (const fila of tracks) porTrack[fila.analysis_status] = fila.n;
    return { trabajos: porEstado, canciones: porTrack };
  }

  return { analizar, medir, calcular, encolarPendientes, procesarLote, estado, disponible, leerMediciones };
}

module.exports = { createAnalisis, calcular, leerMediciones };
