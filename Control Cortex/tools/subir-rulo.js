#!/usr/bin/env node
// Sube la carpeta Rulo al repo de GitHub (Control-Cortex---rulo-spotify).
//
//   node tools/subir-rulo.js            -> copia los cambios, commitea y empuja
//   node tools/subir-rulo.js --estado   -> dice que cambiaria, sin subir nada
//   node tools/subir-rulo.js --mensaje "texto"  -> usa ese mensaje de commit
//
// Lo que NO se sube (ni aunque exista en la carpeta): el estado que se genera en
// vivo (historial de chat, registro de pedidos, devices), node_modules de las
// pruebas, ruido de Windows y cualquier .env. El .gitignore del repo tambien manda.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REMOTE = 'https://github.com/mati4315/Control-Cortex---rulo-spotify.git';
const WEB = 'https://github.com/mati4315/Control-Cortex---rulo-spotify';
const ORIGEN = path.resolve(__dirname, '../../Rulo');
const CLON = path.join(os.tmpdir(), 'rulo-github');

const EXCLUIDOS = [
  'tests/node_modules',
  'desktop.ini',
  'Thumbs.db',
  'rulo-chat-history.json',
  'Spotify/spotify-request-log.json',
  'Spotify/spotify-devices.json',
  'Spotify/spotify-analytics.db',
  'Spotify/spotify-analytics.db-wal',
  'Spotify/spotify-analytics.db-shm',
  '.env',
  '*.env'
];

const argumentos = process.argv.slice(2);
const soloEstado = argumentos.indexOf('--estado') !== -1;
const indiceMensaje = argumentos.indexOf('--mensaje');
const mensaje = indiceMensaje !== -1 ? String(argumentos[indiceMensaje + 1] || '').trim() : '';

function correr(comando, args, opciones) {
  return execFileSync(comando, args, Object.assign({ cwd: CLON, encoding: 'utf8' }, opciones || {}));
}

function estaExcluido(relativo) {
  const normal = relativo.split(path.sep).join('/');
  return EXCLUIDOS.some(item => {
    const objetivo = item.split(path.sep).join('/');
    if (objetivo.indexOf('*') !== -1) {
      const sufijo = objetivo.replace('*', '');
      return normal.endsWith(sufijo) || normal.indexOf('/' + sufijo) !== -1 || normal.indexOf(sufijo) === 0;
    }
    return normal === objetivo || normal.indexOf(objetivo + '/') === 0 || normal.endsWith('/' + objetivo);
  });
}

// Deja el clon listo (lo baja de nuevo si no esta o si cambio el remoto).
if (!fs.existsSync(path.join(CLON, '.git'))) {
  console.log('Bajando el repo a ' + CLON + ' ...');
  fs.rmSync(CLON, { recursive: true, force: true });
  fs.mkdirSync(CLON, { recursive: true });
  execFileSync('git', ['clone', REMOTE, CLON], { encoding: 'utf8', stdio: 'inherit' });
} else {
  execFileSync('git', ['-C', CLON, 'pull', '--ff-only', 'origin', 'main'], { encoding: 'utf8' });
}

// Copia la carpeta Rulo encima del clon, respetando las exclusiones.
let copiados = 0;
const afuera = [];
function copiar(relativo) {
  const desde = path.join(ORIGEN, relativo);
  const hacia = path.join(CLON, relativo);
  if (estaExcluido(relativo)) {
    afuera.push(relativo.split(path.sep).join('/'));
    return;
  }
  const info = fs.statSync(desde);
  if (info.isDirectory()) {
    fs.mkdirSync(hacia, { recursive: true });
    fs.readdirSync(desde).forEach(hijo => copiar(path.join(relativo, hijo)));
    return;
  }
  fs.copyFileSync(desde, hacia);
  copiados += 1;
}
fs.readdirSync(ORIGEN).forEach(hijo => copiar(hijo));

console.log('Archivos copiados: ' + copiados);
if (afuera.length) console.log('Fuera del repo: ' + afuera.join(', '));

// Ojo: con core.autocrlf, "status" puede marcar todo como modificado por los
// finales de linea. Se agrega primero y recien ahi se mira lo que cambio de verdad.
correr('git', ['add', '-A']);
const cambios = correr('git', ['status', '--porcelain']);
if (!cambios.trim()) {
  console.log('\nNo hay nada nuevo para subir: el repo ya tiene esta version.');
  console.log(WEB);
  process.exit(0);
}

if (soloEstado) {
  console.log('\nCambios que subiria (--estado no sube nada):');
  console.log(cambios.trim());
  console.log('\nPara subirlo de verdad: node tools/subir-rulo.js');
  process.exit(0);
}

const archivos = cambios.trim().split('\n').length;
const texto = mensaje || ('Rulo: actualizacion del ' + new Date().toLocaleString('es-AR'));
correr('git', ['-c', 'user.name=mati4315', '-c', 'user.email=mati4315@users.noreply.github.com', 'commit', '-q', '-m', texto]);
const hash = correr('git', ['rev-parse', '--short', 'HEAD']).trim();
console.log('\nCommit ' + hash + ' (' + archivos + ' archivo(s)): ' + texto);
execFileSync('git', ['-C', CLON, 'push', 'origin', 'main'], { encoding: 'utf8', stdio: 'inherit' });

// Verificacion: que el remoto tenga el commit que acabamos de hacer.
const remoto = execFileSync('git', ['ls-remote', REMOTE, 'refs/heads/main'], { encoding: 'utf8' }).trim().split('\t')[0];
const local = correr('git', ['rev-parse', 'HEAD']).trim();
console.log('\n' + (remoto === local ? 'OK: GitHub tiene el commit ' + hash : 'ATENCION: el remoto no coincide (¿push rechazado?)'));
console.log(WEB);
process.exit(remoto === local ? 0 : 1);
