// Parcheo de SocialStream Ninja a prueba de actualizaciones.
//
// Idea: cada cosa que Control Cortex necesita dentro de la extension se re-aplica
// desde cero en cada arranque del backend y SIEMPRE se verifica el resultado.
// Antes, si una version nueva de SSN cambiaba el nombre de un archivo importado
// (por ejemplo `./spotify.js?v=2`), la inyeccion no se hacia pero el log decia
// "inyectado": el bot dejaba de funcionar sin aviso. Ahora:
//
//  1. Se borran las lineas de local-overrides que haya (para no duplicar nunca).
//  2. Se insertan detras (o delante, segun el caso) del import que les corresponde,
//     tolerando cambios de version (`?v=9`), de comillas y de sangria.
//  3. Si el import esperado no existe (SSN lo movio o lo renombro), se insertan al
//     principio o al final de la lista de scripts, que es una posicion valida igual,
//     y se avisa.
//  4. Solo se cargan los overrides que realmente se copiaron: nada de lineas que
//     apunten a archivos que no existen (eso aborta la carga de SSN).
//  5. Se verifica que cada linea quede EXACTAMENTE una vez y se reporta el modo
//     usado (host/lista) para que el resultado quede a la vista.
'use strict';

const fs = require('fs');
const path = require('path');

// Clave publica de la extension: mantiene el mismo ID de extension aunque SSN se
// actualice, asi no se pierden los ajustes ni los Session ID de OBS.
const SSN_PINNED_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyUdjby5vpkeVePz8Qx1nYP0y4bl4rjJs1/7DJVMyFTsVgRxJWVCCbXKgNturGB5AQwKG2vQoBitrxez9/mfyQhqsoIG8gVXSKyNag99Lg44gFW39IE3Z14MgDSGBJ0fYASkPSZBjSybdaHuPuFt/t5ffBUU/EhdB1dE6GtnVhIv0zxK/caheuGqkSz13yq7lLyWJkCAF8EGjAfULwWU05gW6oJg11Ssfh4JWFO34HMnn6jMyfz4J/HMllVVXHecOk0nliwJKcMzBLQ4SIJHKAjO639/OUFamOjth2HqooEtZJTIMoY4IBAr/AxhKdaaE2DnUIcVhr3K8slcbDaPjSwIDAQAB';

// Cada entrada dice: que archivo de local-overrides cargar, detras de que import
// de SSN va, y si tiene que ir antes o despues de ese import.
//  - cortex-base-url.js primero: los demas leen window.CORTEX_BASE_URL.
//  - los modulos de Spotify despues de spotify.js (parchean esa clase).
//  - el Session ID estable ANTES de background.js (background.js lo consume).
const OVERRIDE_ENTRIES = [
  { id: 'base-url', file: 'cortex-base-url.js', host: 'spotify.js', position: 'after', versioned: false },
  { id: 'spotify-auto-music', file: 'spotify-auto-music.js', host: 'spotify.js', position: 'after', versioned: true },
  { id: 'spotify-relay', file: 'spotify-cortex-overlay-relay.js', host: 'spotify.js', position: 'after', versioned: false },
  { id: 'rulo-chat-relay', file: 'rulo-chat-relay.js', host: 'spotify.js', position: 'after', versioned: false },
  { id: 'stable-session', file: 'stable-ssn-session-id.js', host: 'background.js', position: 'before', versioned: false }
];

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indentOf(line) {
  const match = String(line || '').match(/^([ \t]*)/);
  return match && match[1] ? match[1] : '        ';
}

function entryLine(entry, moduleVersion) {
  const version = entry.versioned ? `?v=${moduleVersion}` : '?v=1';
  return `'./local-overrides/${entry.file}${version}',`;
}

/**
 * Reescribe el loader: cada override una sola vez, en la posicion que le toca.
 * options: { moduleVersion, ids } (ids = que overrides se copiaron de verdad).
 * Devuelve { code, applied, missing, warnings, ok, checks }.
 */
function patchLoaderCode(originalCode, options) {
  const config = options || {};
  const version = config.moduleVersion || 1;
  const wantedIds = Array.isArray(config.ids) && config.ids.length
    ? config.ids
    : OVERRIDE_ENTRIES.map(entry => entry.id);
  const entries = OVERRIDE_ENTRIES.filter(entry => wantedIds.indexOf(entry.id) !== -1);
  const warnings = [];
  let code = String(originalCode || '');

  // 1) Fuera todo lo nuestro: asi nunca quedan lineas duplicadas ni viejas.
  // Se aceptan comillas simples o dobles (SSN podria reformatear el archivo).
  code = code.replace(/^[ \t]*['"]\.\/local-overrides\/[^'"]*['"],?[ \t]*\r?\n/gm, '');

  // El fin de linea del archivo se respeta al insertar (nada de mezclar LF y CRLF).
  const eolChar = code.indexOf('\r\n') !== -1 ? '\r\n' : '\n';

  const applied = [];
  const missing = [];

  // Se agrupa por import y posicion: el bloque entra completo y en orden
  // (cortex-base-url.js tiene que cargarse antes que los modulos que lo leen).
  const groups = [];
  entries.forEach(entry => {
    const key = entry.position + ':' + entry.host;
    let group = groups.find(item => item.key === key);
    if (!group) {
      group = { key, host: entry.host, position: entry.position, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  });

  groups.forEach(group => {
    const lines = group.entries.map(entry => ({ id: entry.id, text: entryLine(entry, version) }));
    // Detras o delante del import que le corresponde: cualquier version (?v=N)
    // y comillas simples o dobles.
    const hostRegex = new RegExp("^[ \\t]*['\"](?:\\.\\/)?" + escapeRegex(group.host) + "[^'\"\\n]*['\"],?[ \\t]*\\r?$", 'm');
    const hostMatch = code.match(hostRegex);
    if (hostMatch) {
      const indent = indentOf(hostMatch[0]);
      const start = code.indexOf(hostMatch[0]);
      const eol = code.indexOf('\n', start);
      const at = group.position === 'before' ? start : (eol === -1 ? code.length : eol + 1);
      const block = lines.map(item => indent + item.text).join(eolChar) + eolChar;
      code = code.slice(0, at) + block + code.slice(at);
      lines.forEach(item => applied.push({ id: item.id, mode: 'host:' + group.host, line: item.text }));
      return;
    }

    // Sin el import esperado: al principio o al final de la lista de scripts.
    const listMatch = code.match(/const\s+scripts\s*=\s*\[[\s\S]*?\n[ \t]*\]/);
    if (listMatch) {
      const listText = listMatch[0];
      const closingAt = listMatch.index + listText.lastIndexOf('\n');
      const firstItem = listText.split('\n').slice(1).find(item => item.trim());
      const indent = indentOf(firstItem);
      const at = group.position === 'before' ? listMatch.index + listText.indexOf('\n') + 1 : closingAt + 1;
      const block = lines.map(item => indent + item.text).join(eolChar) + eolChar;
      code = code.slice(0, at) + block + code.slice(at);
      lines.forEach(item => applied.push({ id: item.id, mode: 'lista', line: item.text }));
      group.entries.forEach(entry => warnings.push(`No encontre el import de "${group.host}": ${entry.id} se agrego ${group.position === 'before' ? 'al principio' : 'al final'} de la lista de scripts.`));
      return;
    }

    group.entries.forEach(entry => {
      missing.push(entry.id);
      warnings.push(`No pude insertar ${entry.id}: el loader no tiene el import de "${group.host}" ni una lista de scripts.`);
    });
  });

  // 3) Verificacion: cada linea exactamente una vez.
  const checks = entries.map(entry => {
    const line = entryLine(entry, version);
    const count = code.split(line).length - 1;
    return { id: entry.id, present: count === 1, count };
  });
  const broken = checks.filter(item => !item.present);
  if (broken.length) {
    warnings.push('Lineas que no quedaron exactamente una vez: ' + broken.map(item => `${item.id} (${item.count})`).join(', '));
  }

  return {
    code,
    applied,
    missing,
    warnings,
    ok: missing.length === 0 && broken.length === 0,
    checks
  };
}

/**
 * Aplica todo lo que la extension necesita para funcionar con Control Cortex.
 * Se llama en cada arranque del backend y se puede llamar de nuevo tras migrar SSN.
 * config: { ssnDir, moduleVersion, cortexBaseUrl, ruloSessionId, overrides, log }
 * overrides: [{ id, file, source }]
 */
function applySsnPatches(config) {
  const options = config || {};
  const ssnDir = options.ssnDir;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const overrides = Array.isArray(options.overrides) ? options.overrides : [];
  const version = options.moduleVersion || 1;
  const status = { ok: true, steps: [], warnings: [], ssnDir, generatedAt: Date.now(), copiedIds: [] };

  if (!ssnDir || !fs.existsSync(ssnDir)) {
    status.ok = false;
    status.steps.push({ id: 'carpeta', ok: false, detail: 'No existe la carpeta de SocialStream Ninja: ' + ssnDir });
    status.warnings.push('No se encontro SocialStream Ninja; no se aplico ningun parche.');
    return status;
  }

  // --- 1. manifest: la clave fija (mismo ID de extension) ---
  const manifestPath = path.join(ssnDir, 'manifest.json');
  try {
    const manifest = JSON.parse(readText(manifestPath) || '{}');
    if (!manifest.key) {
      fs.writeFileSync(manifestPath, JSON.stringify(Object.assign({ key: SSN_PINNED_KEY }, manifest), null, 2), 'utf8');
      log('manifest.json: clave inyectada (ID de extension protegido).');
      status.steps.push({ id: 'manifest', ok: true, detail: 'clave inyectada' });
    } else {
      status.steps.push({ id: 'manifest', ok: true, detail: 'clave presente' });
    }
    status.ssnVersion = manifest.version || '';
  } catch (error) {
    status.ok = false;
    status.steps.push({ id: 'manifest', ok: false, detail: error.message });
    status.warnings.push('No se pudo revisar manifest.json: ' + error.message);
  }

  // --- 2. copias en local-overrides (solo las que existen) ---
  const overridesDir = path.join(ssnDir, 'local-overrides');
  let copied = 0;
  let unchanged = 0;
  const missingSources = [];
  const presentIds = ['base-url']; // cortex-base-url.js se genera siempre
  try {
    fs.mkdirSync(overridesDir, { recursive: true });
    overrides.forEach(item => {
      const source = readText(item.source);
      if (source === null) {
        missingSources.push(item.file);
        return;
      }
      presentIds.push(item.id);
      const targetPath = path.join(overridesDir, item.file);
      if (readText(targetPath) === source) {
        unchanged += 1;
        return;
      }
      fs.writeFileSync(targetPath, source, 'utf8');
      copied += 1;
    });
    status.copiedIds = presentIds;
    status.steps.push({
      id: 'overrides',
      ok: missingSources.length === 0,
      detail: `${copied} actualizados, ${unchanged} sin cambios${missingSources.length ? ', faltan: ' + missingSources.join(', ') : ''}`
    });
    if (missingSources.length) {
      status.ok = false;
      status.warnings.push('No encontre el origen de: ' + missingSources.join(', '));
    }
  } catch (error) {
    status.ok = false;
    status.steps.push({ id: 'overrides', ok: false, detail: error.message });
    status.warnings.push('No se pudieron copiar los overrides: ' + error.message);
  }

  // --- 3. URL base generada ---
  try {
    const baseUrlCode = [
      '// Generado automaticamente por Control Cortex al arrancar. No editar a mano.',
      '(function () {',
      '  "use strict";',
      `  window.CORTEX_BASE_URL = ${JSON.stringify(options.cortexBaseUrl || '')};`,
      `  window.CORTEX_SESSION_ID = ${JSON.stringify(options.ruloSessionId || '')};`,
      '}());',
      ''
    ].join('\n');
    const baseUrlPath = path.join(overridesDir, 'cortex-base-url.js');
    if (readText(baseUrlPath) !== baseUrlCode) {
      fs.writeFileSync(baseUrlPath, baseUrlCode, 'utf8');
      log(`cortex-base-url.js generado (${options.cortexBaseUrl}).`);
      status.steps.push({ id: 'base-url', ok: true, detail: 'regenerada' });
    } else {
      status.steps.push({ id: 'base-url', ok: true, detail: 'sin cambios' });
    }
  } catch (error) {
    status.ok = false;
    status.steps.push({ id: 'base-url', ok: false, detail: error.message });
    status.warnings.push('No se pudo generar cortex-base-url.js: ' + error.message);
  }

  // --- 4. loader: solo los overrides que existen ---
  const loaderPath = path.join(ssnDir, 'loader.js');
  const originalLoader = readText(loaderPath);
  if (originalLoader === null) {
    status.ok = false;
    status.steps.push({ id: 'loader', ok: false, detail: 'no existe loader.js' });
    status.warnings.push('No existe loader.js: los modulos de Cortex no se cargaran.');
    return status;
  }
  const patched = patchLoaderCode(originalLoader, { moduleVersion: version, ids: presentIds });
  status.loader = { applied: patched.applied, missing: patched.missing, warnings: patched.warnings };
  if (patched.code !== originalLoader) {
    fs.writeFileSync(loaderPath, patched.code, 'utf8');
  }
  status.checks = patched.checks;
  status.steps.push({
    id: 'loader',
    ok: patched.ok,
    detail: patched.ok
      ? `${patched.applied.length} lineas activas (${patched.applied.map(item => item.mode).join(', ')})`
      : 'revisar: ' + patched.warnings.join(' | ')
  });
  if (!patched.ok) {
    status.ok = false;
    status.warnings = status.warnings.concat(patched.warnings);
  } else if (patched.warnings.length) {
    status.warnings = status.warnings.concat(patched.warnings);
  }
  return status;
}

module.exports = {
  SSN_PINNED_KEY,
  OVERRIDE_ENTRIES,
  patchLoaderCode,
  applySsnPatches
};
