'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHome, safeUrl } = require('../../Control Cortex/backend/cortex-home');
const root = path.resolve(__dirname, '../..');
const copy = x => JSON.parse(JSON.stringify(x));
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-home-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const live = {
    '/api/rulo-config': { config: JSON.parse(fs.readFileSync(path.join(root, 'Rulo/rulo-config.json'))) },
    '/api/rulo-unified-config': { config: { accent: '#112233', showArt: true, commentScale: 1 } },
    '/api/spotify-settings': { settings: JSON.parse(fs.readFileSync(path.join(root, 'Rulo/Spotify/spotify-settings.json'))) },
    '/api/spotify-vocabulary': { vocabulary: JSON.parse(fs.readFileSync(path.join(root, 'Rulo/Spotify/spotify-vocabulary.json'))) }
  };
  const writes = [];
  let failOnce = null;
  const args = { file: path.join(dir, 'profiles.json'), catalog: () => [], aiConfig: () => ({ enabled: true, endpoint: 'https://example.com/v1/chat/completions', model: 'existing-model' }), aiKey: () => 'test-secret',
    api: async (url, body) => {
      if (body !== undefined) {
        if (url === failOnce) { failOnce = null; throw new Error('Simulated failure'); }
        writes.push(url); const key = Object.keys(live[url])[0]; live[url][key] = { ...live[url][key], ...copy(body) };
      }
      return copy(live[url]);
    }, ...options };
  return { home: createHome(args), live, writes, args, fail: url => { failOnce = url; } };
}
test('initializes real project configuration, saves departing profile and applies target; persists across restart', async t => {
  const f = fixture(t); const initial = await f.home.action('state');
  assert.deepEqual(initial.profiles.map(x => x.name), ['Por defecto', 'Pruebas']);
  assert.equal(initial.profiles[0].settings, undefined);
  const original = f.live['/api/rulo-config'].config.botName;
  f.live['/api/rulo-config'].config.botName = 'Directo';
  const result = await f.home.action('activate', { id: 'tests' });
  assert.equal(result.activeId, 'tests'); assert.equal(f.live['/api/rulo-config'].config.botName, original);
  await f.home.action('activate', { id: 'default' });
  assert.equal(f.live['/api/rulo-config'].config.botName, 'Directo');
  assert.equal((await createHome(f.args).action('state')).activeId, 'default');
  assert.ok(fs.existsSync(f.args.file + '.recovery.json'));
});
test('export/import roundtrip creates another profile and never exports AI connection', async t => {
  const f = fixture(t); await f.home.action('state');
  const exported = await f.home.action('export', { id: 'default' });
  assert.equal(exported.profile.settings.vocabulary.ai, undefined);
  assert.ok(!JSON.stringify(exported).includes('test-secret'));
  const imported = await f.home.action('import', exported);
  assert.equal(imported.activeId, 'default'); assert.equal(imported.profiles.length, 3); assert.equal(f.writes.length, 0);
  await f.home.action('activate', { id: imported.profiles[2].id });
});
test('invalid imports, AI endpoint injection, malformed links and protected profile deletion are rejected', async t => {
  const f = fixture(t); const exported = await f.home.action('export', { id: 'default' });
  await assert.rejects(f.home.action('import', { ...exported, version: 2 }));
  const bad = copy(exported); bad.profile.settings.vocabulary.ai = { endpoint: 'http://evil' };
  await assert.rejects(f.home.action('import', bad), /Campo desconocido/);
  const incomplete = copy(exported); incomplete.profile.settings.rulo = {};
  await assert.rejects(f.home.action('import', incomplete), /incompletas/);
  await assert.rejects(f.home.action('delete', { id: 'default' }));
  assert.throws(() => safeUrl('javascript:alert(1)')); assert.throws(() => safeUrl('//evil.com'));
  assert.throws(() => safeUrl('/\\evil.com')); assert.equal(safeUrl('/index.html'), '/index.html');
  assert.equal((await f.home.action('state')).profiles.length, 2);
});
test('partial failure restores all settings and keeps original active profile', async t => {
  const f = fixture(t); await f.home.action('state');
  f.live['/api/rulo-config'].config.botName = 'Current'; f.fail('/api/spotify-settings');
  const before = copy(f.live);
  await assert.rejects(f.home.action('activate', { id: 'tests' }), /Se restauraron/);
  assert.deepEqual(f.live, before); assert.equal((await f.home.action('state')).activeId, 'default');
});
test('favorites, links, profile names survive reload; concurrent creates do not lose updates', async t => {
  const f = fixture(t);
  await Promise.all([f.home.action('create', { name: 'Uno' }), f.home.action('create', { name: 'Dos' })]);
  await f.home.action('preferences', { favorites: ['chat'], links: [{ id: 'abc', name: 'Mi plugin', category: 'Plugins', url: 'http://localhost:9999' }] });
  const state = await createHome(f.args).action('state');
  assert.equal(state.profiles.length, 4); assert.deepEqual(state.profiles[0].preferences.favorites, ['chat']); assert.equal(state.profiles[0].preferences.links[0].id, 'custom-abc');
});
test('corrupt profile file does not crash module startup or overwrite existing data', async t => {
  const f = fixture(t); fs.writeFileSync(f.args.file, '{broken');
  const home = createHome(f.args);
  await assert.rejects(home.action('state'));
  assert.equal(fs.readFileSync(f.args.file, 'utf8'), '{broken');
});
test('assistant reuses model and credential server-side, sends only catalog and question', async t => {
  let captured;
  const f = fixture(t, { fetchImpl: async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'Plan de actualización' } }] }) }; } });
  const answer = await f.home.assist('¿Cómo actualizo?');
  assert.equal(answer.answer, 'Plan de actualización'); assert.equal(captured.options.headers.Authorization, 'Bearer test-secret');
  const payload = JSON.parse(captured.options.body); assert.equal(payload.model, 'existing-model'); assert.equal(payload.messages[1].content, '¿Cómo actualizo?'); assert.equal(f.writes.length, 0);
});
test('Responses API payload and provider errors handled', async t => {
  let payload;
  const f = fixture(t, { aiConfig: () => ({ enabled: true, endpoint: 'https://example.com/v1/responses', model: 'model' }), fetchImpl: async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'Respuesta' }] }] }) }; } });
  assert.equal((await f.home.assist('Ayuda')).answer, 'Respuesta'); assert.ok(payload.input); assert.equal(payload.messages, undefined);
  const failed = fixture(t, { fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(failed.home.assist('Ayuda'), /429/);
  const offline = fixture(t, { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.home.assist('Ayuda'), /servicio de IA esté encendido/);
});
test('UI renders safely, searches, favorites, changes profiles with confirmation and navigates', async t => {
  const { JSDOM } = require('jsdom');
  const f = fixture(t); const state = await f.home.action('state');
  state.modules.push({ id: 'unsafe', name: '<img src=x onerror=alert(1)>', category: 'Plugins', url: 'javascript:alert(1)', description: 'Inseguro' });
  const calls = [];
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'Control Cortex/frontend/home.html'), 'utf8'), { url: 'http://localhost:4000', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async (url, options) => {
    calls.push(url); let body;
    if (url === '/api/cortex-home') body = state;
    else if (url === '/api/cortex-base-url') body = { sessionId: 'test-session' };
    else if (url === '/api/services') body = [];
    else body = await f.home.action(url.split('/').pop(), JSON.parse(options.body));
    return { ok: true, json: async () => body };
  };
  w.eval(fs.readFileSync(path.join(root, 'Control Cortex/frontend/home.js'), 'utf8'));
  const flush = () => new Promise(r => setTimeout(r, 30)); await flush();
  const d = w.document; assert.equal(d.querySelectorAll('.card').length, 8); assert.equal(d.querySelectorAll('.card img').length, 0); assert.equal(d.querySelector('a[href^="javascript:"]'), null);
  assert.ok(d.querySelector('a[href*="session=test-session"]'));
  d.getElementById('search').value = 'entrenamiento'; d.getElementById('search').dispatchEvent(new w.Event('input')); assert.equal(d.querySelectorAll('.card').length, 1);
  d.querySelector('.star').click(); await flush(); assert.ok(calls.includes('/api/cortex-home/preferences'));
  d.querySelector('[data-view="profiles"]').click(); assert.equal(d.getElementById('view-profiles').hidden, false);
  d.getElementById('profile').value = 'tests'; d.getElementById('profile').dispatchEvent(new w.Event('change')); assert.equal(d.getElementById('confirm').open, true); assert.equal((await f.home.action('state')).activeId, 'default');
  d.getElementById('accept-confirm').click(); await flush(); assert.equal((await f.home.action('state')).activeId, 'tests');
});
