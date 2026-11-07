'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { timingSafeEqual } = require('node:crypto');

const cortexIp = String(process.env.RULO_CORTEX_IP || '192.168.4.100').trim();
const cortexOrigin = String(process.env.RULO_CORTEX_ORIGIN || `http://${cortexIp}:4000`).trim();
const port = Number.parseInt(process.env.RULO_REMOTE_LAUNCH_PORT || '4102', 10);
const packageDir = path.resolve(process.env.RULO_3D_PACKAGE_DIR || 'D:\\Codot Model Rulo\\FORMATO WINDOWS\\RULO 3D protegido');
const exePath = path.join(packageDir, 'RULO.exe');
const pckPath = path.join(packageDir, 'RULO.pck');
const tokenPath = path.join(packageDir, 'clave-rulo-3d.txt');

let launchPending = false;
let lastLaunchAt = 0;

function normalizedAddress(address) {
	return String(address || '').replace(/^::ffff:/i, '');
}

function requestFromAllowedCortex(req) {
	return normalizedAddress(req.socket.remoteAddress) === cortexIp;
}

function originAllowed(req) {
	return String(req.headers.origin || '') === cortexOrigin;
}

function sendJson(res, statusCode, payload, allowCors) {
	if (allowCors) {
		res.setHeader('Access-Control-Allow-Origin', cortexOrigin);
		res.setHeader('Vary', 'Origin');
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
		res.setHeader('Access-Control-Allow-Private-Network', 'true');
		res.setHeader('Access-Control-Max-Age', '600');
	}
	res.setHeader('Cache-Control', 'no-store');
	if (statusCode === 204) {
		res.writeHead(statusCode);
		res.end();
		return;
	}
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.writeHead(statusCode);
	res.end(JSON.stringify(payload));
}

function readSharedToken() {
	const token = fs.readFileSync(tokenPath, 'utf8').trim();
	if (token.length < 16 || token.length > 256) throw new Error('Clave compartida inválida.');
	return token;
}

function tokenMatches(req, expectedToken) {
	const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
	if (!match) return false;
	const supplied = Buffer.from(match[1], 'utf8');
	const expected = Buffer.from(expectedToken, 'utf8');
	return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function ruloControlPortIsOpen() {
	return new Promise(resolve => {
		const socket = net.createConnection({ host: '127.0.0.1', port: 4101 });
		const finish = result => {
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(700, () => finish(false));
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
	});
}

async function handleLaunch(req, res) {
	if (!requestFromAllowedCortex(req)) {
		sendJson(res, 403, { success: false, error: 'La solicitud no proviene del equipo Cortex autorizado.' }, false);
		return;
	}
	if (!originAllowed(req)) {
		sendJson(res, 403, { success: false, error: 'Origen de panel no autorizado.' }, false);
		return;
	}
	let token;
	try { token = readSharedToken(); }
	catch (_) {
		sendJson(res, 503, { success: false, error: 'No se encontró una clave válida junto a RULO.exe.' }, true);
		return;
	}
	if (!tokenMatches(req, token)) {
		sendJson(res, 401, { success: false, error: 'La clave compartida no coincide con el paquete protegido.' }, true);
		return;
	}
	if (!fs.existsSync(exePath) || !fs.existsSync(pckPath)) {
		sendJson(res, 503, { success: false, error: 'Falta RULO.exe o su RULO.pck en el paquete protegido.' }, true);
		return;
	}
	if (await ruloControlPortIsOpen()) {
		sendJson(res, 200, { success: true, alreadyRunning: true, message: 'RULO.exe ya está escuchando en este equipo.' }, true);
		return;
	}
	if (launchPending || Date.now() - lastLaunchAt < 8000) {
		sendJson(res, 202, { success: true, starting: true, message: 'RULO.exe se está iniciando; espera unos segundos y vuelve a conectar.' }, true);
		return;
	}
	launchPending = true;
	lastLaunchAt = Date.now();
	const child = spawn(exePath, [], {
		cwd: packageDir,
		detached: true,
		stdio: 'ignore',
		windowsHide: false,
		env: { ...process.env, RULO_CONTROL_TOKEN: token },
	});
	child.once('error', error => {
		launchPending = false;
		console.error('[Rulo remoto] No se pudo iniciar RULO.exe:', error.message);
		if (!res.headersSent) sendJson(res, 500, { success: false, error: 'Windows no pudo iniciar RULO.exe en este equipo.' }, true);
	});
	child.once('spawn', () => {
		child.unref();
		setTimeout(() => { launchPending = false; }, 2000).unref();
		if (!res.headersSent) sendJson(res, 200, { success: true, started: true, message: 'RULO.exe se está iniciando en el equipo del modelo.' }, true);
	});
}

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
	console.error('[Rulo remoto] Puerto de escucha inválido.');
	process.exit(1);
}
if (!/^[0-9.]+$/.test(cortexIp) || !cortexOrigin.startsWith('http://')) {
	console.error('[Rulo remoto] Configura una IP Cortex y origen HTTP válidos.');
	process.exit(1);
}

const server = http.createServer((req, res) => {
	if (req.method === 'OPTIONS' && req.url === '/launch') {
		if (!requestFromAllowedCortex(req) || !originAllowed(req)) {
			sendJson(res, 403, { success: false, error: 'Preflight CORS no autorizado.' }, false);
			return;
		}
		sendJson(res, 204, {}, true);
		return;
	}
	if (req.method !== 'POST' || req.url !== '/launch') {
		sendJson(res, 404, { success: false, error: 'Ruta no encontrada.' }, false);
		return;
	}
	req.resume();
	void handleLaunch(req, res);
});

server.on('error', error => {
	console.error('[Rulo remoto] No se pudo abrir el puerto %d: %s', port, error.message);
	process.exitCode = 1;
});
server.listen(port, '0.0.0.0', () => {
	console.log('[Rulo remoto] Listo en TCP %d; Cortex autorizado: %s', port, cortexIp);
	console.log('[Rulo remoto] El botón abrirá únicamente el paquete protegido configurado.');
});
