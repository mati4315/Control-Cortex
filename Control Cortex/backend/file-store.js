'use strict';
// Estado en memoria de un JSON del proyecto que TAMBIEN se puede editar a mano
// (o con una IA que entrena al bot). Antes cada archivo se leia una sola vez al
// arrancar: si lo editabas por fuera, el backend seguia con la copia vieja y el
// siguiente guardado desde el dashboard pisaba tu edicion. Esto relee cuando el
// archivo cambia de verdad, sin romper nada si esta a medio escribir o borrado.

const fs = require('fs');

function stampOf(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtimeMs + ':' + stat.size;
  } catch (error) {
    return null;
  }
}

/**
 * options: { filePath, normalize, fallback, label, warn }
 * - normalize: funcion que limpia/valida el objeto leido (nunca lanza).
 * - fallback: valor por defecto si no existe el archivo o esta roto.
 */
function createFileStore(options) {
  const filePath = options.filePath;
  const normalize = options.normalize || (value => value);
  const fallback = options.fallback;
  const label = options.label || filePath;
  const warn = options.warn || (message => console.warn(message));

  let value = normalize(fallback);
  let stamp = null;
  let warnedAt = null;

  function readFile() {
    return normalize(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  }

  // Primera lectura. Devuelve { exists, ok, error } y deja el valor en memoria.
  function init() {
    if (!fs.existsSync(filePath)) {
      value = normalize(fallback);
      stamp = null;
      return { exists: false, ok: false };
    }
    try {
      value = readFile();
      stamp = stampOf(filePath);
      return { exists: true, ok: true };
    } catch (error) {
      value = normalize(fallback);
      stamp = stampOf(filePath);
      warn(`[${label}] El archivo no se pudo leer (${error.message}); se usa el respaldo.`);
      return { exists: true, ok: false, error: error.message };
    }
  }

  // Relee SOLO si el archivo cambio afuera. Devuelve el valor nuevo o null.
  function refresh() {
    const current = stampOf(filePath);
    if (current === null) return null;   // borrado: se conserva lo que ya estaba
    if (current === stamp) return null;  // sin cambios (o lo escribimos nosotros)
    try {
      value = readFile();
      stamp = current;
      warnedAt = null;
      return value;
    } catch (error) {
      // JSON a medio escribir: se conserva lo anterior y se avisa una sola vez.
      stamp = current;
      if (warnedAt !== current) {
        warnedAt = current;
        warn(`[${label}] El archivo quedo con JSON invalido (${error.message}); se sigue usando lo cargado.`);
      }
      return null;
    }
  }

  // El backend guardo: mismo valor y el sello pasa a ser el del archivo nuevo,
  // asi nuestro propio guardado no se confunde con una edicion externa.
  function markSynced(next) {
    value = normalize(next === undefined ? value : next);
    stamp = stampOf(filePath);
    return value;
  }

  function write(next) {
    value = normalize(next === undefined ? value : next);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    stamp = stampOf(filePath);
    return value;
  }

  return {
    init,
    refresh,
    markSynced,
    write,
    get value() { return value; },
    get filePath() { return filePath; },
    stamp() { return stamp; }
  };
}

module.exports = { createFileStore, stampOf };
