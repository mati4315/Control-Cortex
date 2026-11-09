const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');

// Run the real handlers without opening ports, reading secrets or starting Firestore.
function serverHarness() {
  let server;
  let now = 10000;
  class Server extends EventEmitter {
    constructor() { super(); this.clients = new Set(); server = this; }
  }
  const sandbox = {
    __dirname: root, console,
    process: { env: { WS_TOKEN: 'test-only' }, once() {} },
    Date: { now: () => now },
    setInterval() {}, setTimeout() { return { unref() {} }; },
    require(name) {
      if (name === 'ws') return { Server, OPEN: 1 };
      if (name === 'dotenv') return { config() {} };
      if (name === 'firebase-admin') return {};
      if (name === 'child_process') return { spawn() { throw Error('Unexpected watcher'); } };
      if (name === 'fs') return {
        readFileSync() { throw Error('No runtime data in tests'); },
        writeFileSync() {}, renameSync() {}
      };
      return require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server-ws.js'), 'utf8'), sandbox);
  return {
    advance(ms) { now += ms; },
    connect() {
      const client = new EventEmitter();
      client.readyState = 1;
      client.messages = [];
      client.send = raw => client.messages.push(JSON.parse(raw));
      client.close = () => { client.readyState = 3; client.emit('close'); };
      client.receive = data => client.emit('message', JSON.stringify(data));
      server.clients.add(client);
      server.emit('connection', client, { headers: { origin: 'http://192.168.4.100:4000' } });
      return client;
    }
  };
}
const hello = { type: 'WIDGET_HELLO', source: 'widget', token: 'test-only', busy: true };
const isRequest = msg => ['WIDGET_HELLO', 'REQUEST_CONFIG'].includes(msg.type);

test('cached configuration prevents two dashboards responding to every overlay reconnect', () => {
  const h = serverHarness();
  const a = h.connect(), b = h.connect();
  a.receive({ type: 'CONFIG_SNAPSHOT', config: { MODE: 'dynamic', WS_TOKEN: 'test-only' } });
  b.receive({ type: 'CONFIG_SNAPSHOT', config: { MODE: 'manual' } });
  for (let i = 0; i < 20; i++) {
    const overlay = h.connect();
    overlay.receive(hello);
    overlay.receive({ type: 'REQUEST_CONFIG' });
    assert.equal(overlay.messages.filter(m => m.type === 'CONFIG_SNAPSHOT').at(-1).config.MODE, 'manual');
    overlay.close();
  }
  assert.equal(a.messages.filter(isRequest).length, 0);
  assert.equal(b.messages.filter(isRequest).length, 0);
  assert.ok(b.messages.filter(m => m.config).every(m => !('WS_TOKEN' in m.config)));
  a.receive({ type: 'CONFIG_SNAPSHOT', reason: 'mode_change', config: { MODE: 'test' } });
  assert.equal(b.messages.at(-1).config.MODE, 'test', 'explicit changes still propagate');
});

test('cold configuration requests are throttled, retryable, and omit credentials', () => {
  const h = serverHarness(), dashboard = h.connect(), overlay = h.connect();
  for (let i = 0; i < 20; i++) overlay.receive(hello);
  assert.equal(dashboard.messages.filter(isRequest).length, 1);
  assert.equal(dashboard.messages.find(isRequest).token, undefined);
  h.advance(2100);
  overlay.receive({ type: 'REQUEST_CONFIG' });
  assert.equal(dashboard.messages.filter(isRequest).length, 2);
});

function overlayHarness() {
  const html = fs.readFileSync(path.join(root, 'lottery-ball.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const sandbox = {
    window: { location: { hostname: '192.168.4.100' } },
    document: { getElementById: () => ({ querySelector: () => ({}) }) },
    URL, console, calls: { connect: 0, render: 0, poll: 0, reset: 0 }
  };
  vm.runInNewContext(script.slice(0, script.indexOf('(function init()')) + `
    connectWebSocket = () => calls.connect++;
    renderTicker = () => calls.render++;
    startPolling = () => calls.poll++;
    resetBall = () => calls.reset++;
    applyDimensions = applyNumberStyles = syncTickerVisibility = shortenCurrentStopForQueue = resolveInitialSync = () => {};
    globalThis.config = CONFIG;
    globalThis.receive = handleIncomingMessage;
  `, sandbox);
  return sandbox;
}

test('mode updates keep the socket and duplicate snapshots do not redraw the overlay', () => {
  const h = overlayHarness();
  h.receive({ type: 'CHANGE_MODE', mode: 'manual' });
  h.receive({ type: 'UPDATE_CONFIG', config: { MODE: 'dynamic' } });
  assert.equal(h.calls.connect, 0);
  assert.equal(h.calls.poll, 2);
  const snapshot = JSON.parse(JSON.stringify(h.config));
  for (let i = 0; i < 20; i++) h.receive({ type: 'UPDATE_CONFIG', config: snapshot });
  assert.equal(h.calls.render, 1);
  assert.equal(h.calls.reset, 0);
});

test('all config transports reject remote loopback URLs but accept an explicit reachable endpoint', () => {
  const h = overlayHarness();
  for (const url of ['ws://localhost:688', 'ws://127.0.0.1:688', 'invalid', 'http://192.168.4.100:688']) {
    h.receive({ type: 'UPDATE_CONFIG', config: { WEBSOCKET_URL: url } });
  }
  assert.equal(h.config.WEBSOCKET_URL, 'ws://192.168.4.100:688');
  assert.equal(h.calls.connect, 0);
  h.receive({ type: 'UPDATE_CONFIG', config: { WEBSOCKET_URL: 'ws://192.168.4.100:689' } });
  assert.equal(h.calls.connect, 1);
});
