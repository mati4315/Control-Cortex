'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const parentPid = Number(argument('--parent-pid', 0));
const nodePath = argument('--node-path', process.execPath);
const serverPath = argument('--server-path', '');
const workingDirectory = argument('--working-directory', path.dirname(serverPath));
const port = Number(argument('--port', 4000));
const readyFile = argument('--ready-file', '');
const logPath = path.join(require('os').tmpdir(), 'cortex-restart-helper.log');

function log(message) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\r\n`, 'utf8');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPortListening() {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

async function run() {
  if (!parentPid || !serverPath || !fs.existsSync(serverPath)) throw new Error('Faltan datos del proceso o del servidor.');
  if (readyFile) fs.writeFileSync(readyFile, 'ready', 'utf8');
  log(`Waiting for Cortex PID ${parentPid} to exit.`);
  while (true) {
    try { process.kill(parentPid, 0); } catch { break; }
    await delay(250);
  }

  const portDeadline = Date.now() + 12000;
  while (await isPortListening()) {
    if (Date.now() >= portDeadline) throw new Error(`El puerto ${port} sigue ocupado después de cerrar Cortex.`);
    await delay(300);
  }

  const child = spawn(nodePath, [serverPath], {
    cwd: workingDirectory,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  log(`Started Node PID ${child.pid} with entry point ${serverPath}.`);

  const startDeadline = Date.now() + 40000;
  while (Date.now() < startDeadline) {
    await delay(500);
    if (await isPortListening()) {
      log(`Cortex is listening on port ${port}.`);
      return;
    }
    if (child.exitCode !== null) throw new Error(`Node salió con código ${child.exitCode} antes de abrir el puerto ${port}.`);
  }
  throw new Error(`Node no abrió el puerto ${port} en 40 segundos.`);
}

run().catch(error => {
  try { log(`Restart failed: ${error.message}`); } catch { /* No hay más acciones seguras. */ }
  process.exitCode = 1;
});
