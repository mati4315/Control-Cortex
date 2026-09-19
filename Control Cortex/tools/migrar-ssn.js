#!/usr/bin/env node
// Migracion de SocialStream Ninja sin perder nada de Control Cortex.
//
//   node tools/migrar-ssn.js estado              -> revisa todo y dice que falta (no toca nada)
//   node tools/migrar-ssn.js backup               -> guarda copia de lo personalizado
//   node tools/migrar-ssn.js desde <carpeta>      -> aplica una version nueva descargada
//   node tools/migrar-ssn.js git                  -> actualiza con git pull del repo de SSN
//
// Despues de migrar: reiniciar el backend (re-aplica el parcheo) y recargar la
// extension en brave://extensions. El script te lo recuerda.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const patcher = require(path.join(__dirname, '..', 'backend', 'ssn-patcher.js'));

const CORTEX_DIR = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(CORTEX_DIR, '..');
// Se pueden redirigir para probar la migracion en una carpeta de prueba.
const SSN_DIR = process.env.CORTEX_SSN_DIR ? path.resolve(process.env.CORTEX_SSN_DIR) : path.join(WORKSPACE, 'SocialStream Ninja');
const BACKUP_DIR = process.env.CORTEX_BACKUP_DIR ? path.resolve(process.env.CORTEX_BACKUP_DIR) : path.join(CORTEX_DIR, 'backups');
const MODULE_VERSION = require(path.join(CORTEX_DIR, 'backend', 'versions.js')).SPOTIFY_MODULE_VERSION;

const OVERRIDES = [
  { id: 'stable-session', file: 'stable-ssn-session-id.js', source: path.join(CORTEX_DIR, 'integrations', 'spotify-auto-music', 'stable-ssn-session-id.js') },
  { id: 'spotify-auto-music', file: 'spotify-auto-music.js', source: path.join(CORTEX_DIR, 'integrations', 'spotify-auto-music', 'spotify-auto-music.js') },
  { id: 'spotify-relay', file: 'spotify-cortex-overlay-relay.js', source: path.join(CORTEX_DIR, 'integrations', 'spotify-auto-music', 'spotify-cortex-overlay-relay.js') },
  { id: 'rulo-chat-relay', file: 'rulo-chat-relay.js', source: path.join(WORKSPACE, 'Rulo', 'rulo-chat-relay.js') }
];

const CUSTOM_FILES = ['loader.js', 'manifest.json'];

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach(item => {
    const source = path.join(from, item.name);
    const target = path.join(to, item.name);
    if (item.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  });
}

function step(name, ok, detail) {
  console.log(`${ok ? '  OK   ' : '  FALLA'} ${name}${detail ? ': ' + detail : ''}`);
  return ok;
}

// ---------- estado (solo lectura) ----------
function estado() {
  console.log('\nEstado de la instalacion (no se toca nada)\n');
  let allOk = true;
  if (!fs.existsSync(SSN_DIR)) {
    step('SocialStream Ninja presente', false, SSN_DIR);
    return false;
  }
  const manifest = JSON.parse(readText(path.join(SSN_DIR, 'manifest.json')) || '{}');
  allOk = step(`SSN ${manifest.version || '?'} con clave de extension`, !!manifest.key, manifest.key ? 'ID protegido' : 'falta la clave') && allOk;

  OVERRIDES.forEach(item => {
    const source = readText(item.source);
    const target = readText(path.join(SSN_DIR, 'local-overrides', item.file));
    if (source === null) {
      allOk = step(`origen ${item.file}`, false, 'no existe la fuente en Control Cortex') && allOk;
      return;
    }
    allOk = step(`copia ${item.file}`, target === source, target === null ? 'no esta en la extension' : (target === source ? 'igual a la fuente' : 'distinta: hay que re-aplicar')) && allOk;
  });

  const loader = readText(path.join(SSN_DIR, 'loader.js')) || '';
  const patched = patcher.patchLoaderCode(loader, { moduleVersion: MODULE_VERSION });
  allOk = step('loader.js con las lineas de Cortex', patched.code === loader && patched.ok, patched.code === loader ? 'ya esta al dia' : 'le falta o le sobra algo') && allOk;
  const detalle = patched.applied.map(item => item.id).join(', ');
  console.log(`         lineas: ${detalle}`);
  console.log(`         version del modulo: v${MODULE_VERSION}`);
  console.log(allOk ? '\n  Todo listo: la extension esta como corresponde.\n' : '\n  Falta re-aplicar el parcheo: iniciar el backend (Iniciar Control Cortex.bat) o correr "git"/"desde".\n');
  return allOk;
}

// ---------- backup ----------
function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(BACKUP_DIR, 'ssn-' + stamp);
  fs.mkdirSync(target, { recursive: true });
  CUSTOM_FILES.forEach(file => {
    const source = path.join(SSN_DIR, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, file));
  });
  const overridesDir = path.join(SSN_DIR, 'local-overrides');
  if (fs.existsSync(overridesDir)) copyDir(overridesDir, path.join(target, 'local-overrides'));
  console.log(`\nRespaldo hecho en: ${target}`);
  console.log('  (loader.js, manifest.json y local-overrides/ tal como estaban)\n');
  return target;
}

function reapply(origen) {
  console.log('\nRe-aplicando el parcheo de Control Cortex...');
  // La URL base y el Session ID no se inventan aca: se conservan los que genero
  // el backend la ultima vez (si no existe el archivo, los pone al arrancar).
  const baseUrlFile = readText(path.join(SSN_DIR, 'local-overrides', 'cortex-base-url.js')) || '';
  const baseUrl = (baseUrlFile.match(/CORTEX_BASE_URL = "([^"]*)"/) || [])[1] || 'http://127.0.0.1:4000';
  const sessionId = (baseUrlFile.match(/CORTEX_SESSION_ID = "([^"]*)"/) || [])[1] || '';
  const status = patcher.applySsnPatches({
    ssnDir: SSN_DIR,
    moduleVersion: MODULE_VERSION,
    cortexBaseUrl: baseUrl,
    ruloSessionId: sessionId,
    overrides: OVERRIDES,
    log: message => console.log('  ' + message)
  });
  status.steps.forEach(item => step(item.id, item.ok, item.detail));
  status.warnings.forEach(warning => console.log('  AVISO: ' + warning));
  console.log(status.ok ? '\n  Parcheo aplicado y verificado.\n' : '\n  Quedo algo pendiente: mirar los FALLA de arriba.\n');
  if (origen) console.log(`  (se trabajo sobre: ${origen})`);
  return status.ok;
}

// ---------- migrar desde una carpeta con la version nueva ----------
function desde(carpeta) {
  const source = path.resolve(carpeta);
  if (!fs.existsSync(path.join(source, 'manifest.json')) || !fs.existsSync(path.join(source, 'loader.js'))) {
    console.error(`\nLa carpeta "${source}" no parece una version de SocialStream Ninja (falta manifest.json o loader.js).`);
    return false;
  }
  console.log(`\nVersion nueva detectada: ${JSON.parse(readText(path.join(source, 'manifest.json'))).version || '?'}`);
  backup();
  // Se copia todo menos local-overrides: eso lo regenera Control Cortex.
  let copiados = 0;
  const walk = (from, to) => {
    fs.readdirSync(from, { withFileTypes: true }).forEach(item => {
      if (item.name === 'local-overrides' || item.name === '.git') return;
      const a = path.join(from, item.name);
      const b = path.join(to, item.name);
      if (item.isDirectory()) {
        fs.mkdirSync(b, { recursive: true });
        walk(a, b);
      } else {
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.copyFileSync(a, b);
        copiados += 1;
      }
    });
  };
  walk(source, SSN_DIR);
  console.log(`\n  ${copiados} archivos copiados de la version nueva.`);
  return reapply(source);
}

// ---------- migrar con git ----------
function porGit() {
  console.log('\nActualizando SocialStream Ninja con git...');
  try {
    backup();
    // El loader.js lleva nuestras lineas: se descarta para que el pull no choque.
    try {
      execFileSync('git', ['-C', SSN_DIR, 'checkout', '--', 'loader.js'], { stdio: 'inherit' });
      console.log('  loader.js restaurado a la version del repo (el parcheo se re-aplica despues).');
    } catch (error) {
      console.log('  No pude restaurar loader.js con git (sigo igual).');
    }
    execFileSync('git', ['-C', SSN_DIR, 'pull', '--ff-only'], { stdio: 'inherit' });
  } catch (error) {
    console.error('\n  El git pull no se pudo completar. No se rompio nada: hay respaldo.');
    console.error('  Detalle:', String(error.message).split('\n')[0]);
    console.error('  Alternativa: descargar la version nueva y correr "desde <carpeta>".');
    return false;
  }
  return reapply('git pull');
}

// ---------- main ----------
const [comando, argumento] = process.argv.slice(2);
console.log('Control Cortex - migracion de SocialStream Ninja');

let ok = false;
switch ((comando || 'estado').toLowerCase()) {
  case 'estado':
    ok = estado();
    break;
  case 'backup':
    backup();
    ok = true;
    break;
  case 'desde':
    if (!argumento) {
      console.error('\nFalta la carpeta: node tools/migrar-ssn.js desde "D:\\...\\SocialStreamNinja-Nueva"');
      break;
    }
    ok = desde(argumento);
    break;
  case 'git':
    ok = porGit();
    break;
  case 'ayuda':
  case 'help':
    console.log('\nUso: node tools/migrar-ssn.js [estado|backup|desde <carpeta>|git]');
    console.log('  estado   revisa que este todo aplicado (no toca nada)');
    console.log('  backup   guarda loader.js, manifest.json y local-overrides en Control Cortex/backups');
    console.log('  desde    aplica una version nueva de SSN que tengas descargada en una carpeta');
    console.log('  git      actualiza con git pull dentro de SocialStream Ninja');
    console.log('\nPara probar sin tocar la instalacion real: CORTEX_SSN_DIR=<carpeta de prueba>\n');
    ok = true;
    break;
  default:
    console.log('\nUso: node tools/migrar-ssn.js [estado|backup|desde <carpeta>|git]\n');
    ok = false;
}

if (comando !== 'estado') {
  if (!ok) {
    console.log('No se aplico ningun cambio al proyecto.');
  } else {
    console.log('Pasos que quedan a mano:');
    console.log('  1. Reiniciar el backend (Iniciar Control Cortex.bat) si estaba abierto.');
    console.log('  2. brave://extensions -> Actualizar en SocialStream Ninja.');
    console.log('  3. Recargar las Browser Sources de OBS.');
    console.log('  4. Verificar: node tools/migrar-ssn.js estado  (o GET /api/cortex-install-status)\n');
  }
}
process.exit(ok ? 0 : 1);
