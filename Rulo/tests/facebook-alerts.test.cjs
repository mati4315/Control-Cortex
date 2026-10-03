const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('rulo-chat-historial.html contains alert CSS styles and badge handling', () => {
  const historialHtml = fs.readFileSync(path.join(__dirname, '../rulo-chat-historial.html'), 'utf8');
  assert.match(historialHtml, /\.row\.is-alert \.cell\.comment/);
  assert.match(historialHtml, /\.badge\.alert-badge/);
  assert.match(historialHtml, /isAlert/);
  assert.match(historialHtml, /reaccion/i);
});

test('rulo-chat-historial.html renders both regular comments and alert rows correctly', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../rulo-chat-historial.html'), 'utf8');
  const items = [
    { id: 'c1', requester: 'Matias', comment: 'Hola gente del stream', response: '', chatimg: '', source: 'youtube', timestamp: Date.now() },
    { id: 'c2', requester: 'Basta Cdelu', comment: '👍 Basta Cdelu reaccionó a tu stream', response: '', chatimg: '', source: 'facebook', isAlert: true, timestamp: Date.now() }
  ];
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:4000/rulo-chat-historial.html?session=XJ9hQ2JDHH',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = (url) => {
        if (String(url).includes('/api/rulo-chat-messages')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, items, total: items.length }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      };
      window.WebSocket = class {
        constructor() { this.readyState = 1; }
        addEventListener() {}
      };
    }
  });

  await new Promise(r => setTimeout(r, 200));
  const doc = dom.window.document;
  const rows = doc.querySelectorAll('.row');
  assert.equal(rows.length, 2, 'Should render 2 rows');

  const rowRegular = doc.getElementById('rulo-row-c1');
  assert.ok(rowRegular, 'Row c1 should exist');
  assert.equal(rowRegular.querySelector('.name').textContent, 'Matias');
  assert.equal(rowRegular.querySelector('.comment-text').textContent, 'Hola gente del stream');
  assert.equal(rowRegular.classList.contains('is-alert'), false);

  const rowAlert = doc.getElementById('rulo-row-c2');
  assert.ok(rowAlert, 'Row c2 should exist');
  assert.equal(rowAlert.querySelector('.name').textContent, 'Basta Cdelu');
  assert.match(rowAlert.querySelector('.comment-text').textContent, /reaccionó a tu stream/);
  assert.equal(rowAlert.classList.contains('is-alert'), true);
  assert.ok(rowAlert.querySelector('.alert-badge'), 'Should have alert badge');
});

test('rulo-chat-relay.js relays isAlert and event fields', () => {
  const relayJs = fs.readFileSync(path.join(__dirname, '../rulo-chat-relay.js'), 'utf8');
  assert.match(relayJs, /isAlert:\s*isAlert/);
  assert.match(relayJs, /event:\s*isAlert\s*\?\s*'alert'/);
});

test('server.js rulo-chat-message preserves isAlert and event', () => {
  const serverJs = fs.readFileSync('D:/plugins para mi OBS/Control Cortex/backend/server.js', 'utf8');
  assert.match(serverJs, /isAlert:\s*isAlert/);
  assert.match(serverJs, /event:\s*isAlert\s*\?\s*'alert'/);
});

test('facebook.js contains enhanced viewer counting and alert processing', () => {
  const facebookJs = fs.readFileSync('D:/plugins para mi OBS/SocialStream Ninja/sources/facebook.js', 'utf8');
  assert.match(facebookJs, /findFacebookViewerCount/);
  assert.match(facebookJs, /parseNumericCount/);
  assert.match(facebookJs, /isAlert/);
  assert.match(facebookJs, /reaccion/i);
});
