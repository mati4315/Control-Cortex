/**
 * Aplica el esquema de la biblioteca musical a la base del proyecto.
 *
 *   node "Rulo/Spotify/canciones automatic/aplicar-esquema.js"                    -> aplica a la base real
 *   node "Rulo/Spotify/canciones automatic/aplicar-esquema.js" --db <ruta>        -> aplica a otra base (pruebas)
 *   node "Rulo/Spotify/canciones automatic/aplicar-esquema.js" --sin-backup       -> no hace la copia previa
 *
 * Seguro por diseño:
 *   - Hace una copia consistente ANTES de tocar nada (VACUUM INTO, con WAL andando).
 *   - Sólo AGREGA (CREATE TABLE/INDEX/VIEW IF NOT EXISTS, INSERT en analysis_jobs no).
 *   - No borra ni modifica ninguna tabla existente (interactions, events, ...).
 *   - Es idempotente: se puede correr las veces que haga falta.
 *   - Al final verifica que las tablas viejas siguen enteras.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const BASE_POR_DEFECTO = path.join(RAIZ, 'Rulo', 'Spotify', 'spotify-analytics.db');
const ESQUEMA = path.join(__dirname, 'esquema-music.sql');

const args = process.argv.slice(2);
const arg = nombre => {
  const i = args.indexOf(nombre);
  return i !== -1 ? args[i + 1] : null;
};
const BASE = arg('--db') || BASE_POR_DEFECTO;
const CON_BACKUP = !args.includes('--sin-backup');
const NUEVAS = ['tracks', 'lyrics', 'play_history', 'analysis_jobs'];

if (!fs.existsSync(BASE)) {
  console.log('No encuentro la base: ' + BASE);
  console.log('(si la base del proyecto todavia no existe, se crea al aplicarlo con --db <ruta nueva>)');
  process.exit(1);
}

console.log('Base destino: ' + BASE);
const db = new DatabaseSync(BASE);

const tablasAntes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t => t.name);
const nuevasAntes = NUEVAS.filter(n => tablasAntes.includes(n));
console.log('Tablas existentes: ' + tablasAntes.length + (nuevasAntes.length ? ' (ya tiene: ' + nuevasAntes.join(', ') + ')' : ' (ninguna de la biblioteca todavia)'));

// ---- copia de seguridad ---------------------------------------------------
if (CON_BACKUP) {
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  let backup = BASE + '.backup-' + sello;
  let intento = 2;
  while (fs.existsSync(backup)) {                      // dos corridas en el mismo segundo
    backup = BASE + '.backup-' + sello + '-' + intento;
    intento += 1;
  }
  try {
    db.exec("VACUUM INTO '" + backup.replace(/\\/g, '/').replace(/'/g, "''") + "'");
    const info = fs.statSync(backup);
    console.log('Copia de seguridad: ' + path.basename(backup) + ' (' + Math.round(info.size / 1024) + ' KB)');
  } catch (error) {
    console.log('No se pudo hacer la copia (' + error.message + '). Se cancela por seguridad.');
    process.exit(1);
  }
}

// ---- esquema --------------------------------------------------------------
const esquema = fs.readFileSync(ESQUEMA, 'utf8');
db.exec(esquema);
console.log('Esquema aplicado (idempotente).');

// ---- verificaciones -------------------------------------------------------
const tablasDespues = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t => t.name);
const faltan = NUEVAS.filter(n => !tablasDespues.includes(n));
if (faltan.length) {
  console.log('ERROR: faltan tablas -> ' + faltan.join(', '));
  process.exit(1);
}
const perdidas = tablasAntes.filter(n => !tablasDespues.includes(n));
console.log('Tablas viejas intactas: ' + (perdidas.length === 0 ? 'si' : 'NO -> ' + perdidas.join(', ')));
const indices = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").get().n;
const vistas = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='view' AND name LIKE 'v_%'").get().n;
console.log('Indices de la biblioteca: ' + indices + ' | vistas: ' + vistas);

const resumen = db.prepare('SELECT * FROM v_biblioteca_resumen').get();
console.log('Resumen: ' + JSON.stringify(resumen));
try {
  const analitica = db.prepare('SELECT COUNT(*) AS n FROM interactions').get().n;
  console.log('Analitica del chat (intacta): ' + analitica + ' interacciones');
} catch (_) {
  console.log('Analitica del chat: (esta base no tiene la tabla interactions)');
}
console.log('\nListo. La reproduccion y el dashboard no cambian: son tablas nuevas y vacias.');
db.close();
