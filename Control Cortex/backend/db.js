'use strict';
// Conexion unica a la base del proyecto (biblioteca + letras + historial + analitica).
//
// Una sola base, una sola conexion: Rulo/Spotify/spotify-analytics.db
// El esquema de la biblioteca vive en Rulo/Spotify/canciones automatic/esquema-music.sql
// y se aplica aca (es idempotente): si el archivo existe, es la fuente de verdad.
//
// Usa `node:sqlite` (viene dentro de Node >= 22). Si no esta disponible, el
// backend sigue funcionando: `disponible()` devuelve false y los llamadores
// tienen que degradar sin romper nada.

const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (_) {
  DatabaseSync = null;
}

const RAIZ = path.resolve(__dirname, '..', '..');
const RUTA = path.join(RAIZ, 'Rulo', 'Spotify', 'spotify-analytics.db');
const ESQUEMA = path.join(RAIZ, 'Rulo', 'Spotify', 'canciones automatic', 'esquema-music.sql');

let conexionActual = null;
let aviso = '';

function disponible() {
  return !!DatabaseSync;
}

// Fecha logica de operacion del bot (YYYY-MM-DD, hora local).
function fechaLogica(corrimientoDias) {
  const fecha = new Date(Date.now() + (Number(corrimientoDias) || 0) * 86400000);
  const dos = numero => String(numero).padStart(2, '0');
  return fecha.getFullYear() + '-' + dos(fecha.getMonth() + 1) + '-' + dos(fecha.getDate());
}

// Columnas que se agregaron despues de la primera version del esquema:
// se revisan al abrir y se agregan si faltan (misma idea que en spotify-analytics.js).
const COLUMNAS_NUEVAS = [
  ['tracks', 'detalle_analisis', 'TEXT'],
  ['play_history', 'cycle', 'INTEGER NOT NULL DEFAULT 1']
];

function asegurarColumnas(db, log) {
  for (const [tabla, columna, tipo] of COLUMNAS_NUEVAS) {
    try {
      const existe = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla);
      if (!existe) continue;
      const actuales = db.prepare('PRAGMA table_info(' + tabla + ')').all().map(c => c.name);
      if (actuales.indexOf(columna) === -1) db.exec('ALTER TABLE ' + tabla + ' ADD COLUMN ' + columna + ' ' + tipo);
    } catch (error) {
      if (log) log('No se pudo agregar ' + tabla + '.' + columna + ': ' + error.message);
    }
  }
}

// El indice del ciclo automatico cambio de forma: si quedo el viejo (sin la
// columna cycle), se reemplaza. Es instantaneo y no toca datos.
function migrarIndiceCiclo(db, log) {
  try {
    const indices = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_play_auto_dia'").all();
    for (const indice of indices) {
      if (String(indice.sql || '').indexOf('cycle') === -1) db.exec('DROP INDEX IF EXISTS idx_play_auto_dia;');
    }
  } catch (error) {
    if (log) log('No se pudo revisar el indice del ciclo: ' + error.message);
  }
}

function aplicarEsquema(db, log) {
  try {
    if (!fs.existsSync(ESQUEMA)) {
      if (log) log('No encuentro esquema-music.sql: la biblioteca queda sin tablas.');
      return;
    }
    // Primero las columnas que falten en tablas que ya existen (si no, los indices
    // nuevos del esquema fallarian por columnas ausentes), despues el esquema.
    asegurarColumnas(db, log);
    db.exec(fs.readFileSync(ESQUEMA, 'utf8'));
    asegurarColumnas(db, log);
    migrarIndiceCiclo(db, log);
  } catch (error) {
    if (log) log('No se pudo aplicar el esquema de la biblioteca: ' + error.message);
  }
}

// Abre (o devuelve) la conexion compartida.
function abrir(opciones) {
  const config = opciones || {};
  const log = config.log || (() => {});
  if (conexionActual) return conexionActual;
  if (!DatabaseSync) {
    aviso = 'SQLite no disponible en esta version de Node.';
    if (log) log(aviso);
    return null;
  }
  const ruta = config.ruta || RUTA;
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const db = new DatabaseSync(ruta);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 4000;');
    if (config.esquema !== false) aplicarEsquema(db, log);
    conexionActual = db;
    aviso = '';
    return db;
  } catch (error) {
    aviso = 'No se pudo abrir la base (' + error.message + ').';
    if (log) log(aviso);
    return null;
  }
}

function conexion(opciones) {
  return conexionActual || abrir(opciones);
}

function cerrar() {
  try { if (conexionActual) conexionActual.close(); } catch (_) { /* nada */ }
  conexionActual = null;
}

function estado() {
  return { disponible: disponible(), abierto: !!conexionActual, ruta: RUTA, aviso };
}

module.exports = { abrir, conexion, cerrar, estado, disponible, fechaLogica, RUTA, ESQUEMA };
