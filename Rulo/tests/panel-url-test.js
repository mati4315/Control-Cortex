// Prueba del panel Control Cortex servido en vivo (Express en el puerto 4000).
// Carga index.html real, deja que jsdom baje app.js del servidor y verifica
// que la URL base de Cortex se resuelva desde /api/cortex-base-url.
const { JSDOM } = require('jsdom');

const BASE = 'http://10.0.0.77:4000';
const seen = [];

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = await JSDOM.fromURL('http://127.0.0.1:4000/', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url, options) => {
        const key = String(url).split('?')[0];
        seen.push(key);
        let body = {};
        if (key.endsWith('/api/services')) body = [];
        if (key.endsWith('/api/services/status') || key.endsWith('/api/status')) body = [];
        if (key.endsWith('/api/cortex-base-url')) body = { success: true, baseUrl: BASE, sessionId: 'XJ9hQ2JDHH', port: 4000 };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
      };
      window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} };
      window.EventSource = class { constructor() { this.readyState = 0; } close() {} };
      window.fetch = window.fetch.bind(window);
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
      try { window.localStorage.setItem('cortex_spotify_config', JSON.stringify({ sessionId: 'XJ9hQ2JDHH' })); } catch (_) {}
    }
  });

  const { document } = dom.window;
  await wait(2000);

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });

  const cards = document.querySelectorAll('#card-spotify');
  check('panel: tarjeta de Spotify renderizada', cards.length === 1, cards.length);
  const text = cards[0] ? cards[0].textContent : '';
  check('panel: base URL pedida al backend', seen.some(u => u.endsWith('/api/cortex-base-url')), seen.join(' | ').slice(0, 160));
  const urls = (text.match(/http:\/\/[^\s]+/g) || []);
  check('panel: URLs de Rulo usan la base detectada',
    urls.includes(BASE + '/rulo-dashboard.html') && urls.includes(BASE + '/rulo-bot-overlay.html?session=XJ9hQ2JDHH') && urls.includes(BASE + '/rulo-chat-historial.html'),
    urls.join(','));
  check('panel: sin duplicar la tarjeta tras re-render', document.querySelectorAll('#card-spotify').length === 1, document.querySelectorAll('#card-spotify').length);

  const failed = results.filter(r => !r.ok);
  console.log('\n===== PANEL CONTROL CORTEX =====');
  results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '   -> ' + r.detail)));
  console.log(`${results.length - failed.length}/${results.length} pruebas OK`);
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error('ERROR:', error.message); process.exit(1); });
