// Pruebas del dashboard de Spotify (Rulo/Spotify/spotify-dashboard.html) con jsdom:
// chips de estado, guardado de ajustes, modo prueba, pruebas manuales y registro.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const DASHBOARD_PATH = 'D:/plugins para mi OBS/Rulo/Spotify/spotify-dashboard.html';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

const SETTINGS = {
  enabled: true,
  testMode: false,
  cooldownSeconds: 40,
  userCooldownSeconds: 120,
  minTextLength: 8,
  requireCommand: false,
  personalize: true,
  announce: true,
  autoContinue: true,
  skipEnabled: true,
  skipSeconds: 10,
  pollSeconds: 4,
  deviceTargetName: 'NOTEBOOK-MATI',
  effectiveCooldownSeconds: 40,
  effectiveUserCooldownSeconds: 120
};

function makeDashboard(options) {
  const opts = options || {};
  const calls = [];
  const state = {
    settings: { ...SETTINGS, ...(opts.settings || {}) },
    client: { lastSeenAt: Date.now(), version: '21', hasToken: true, sinceLastSeenMs: 1200, connected: opts.connected !== false, push: opts.push !== false },
    devices: opts.devices || { devices: [{ name: 'NOTEBOOK-MATI', type: 'Computer', isActive: true, isRestricted: false, volumePercent: 70 }, { name: 'Celular', type: 'Smartphone', isActive: false, isRestricted: false, volumePercent: 40 }], activeName: 'NOTEBOOK-MATI', updatedAt: Date.now() },
    aliases: opts.aliases || {},
    log: opts.log || [{ id: '1', source: 'chat', requester: 'Mati', query: 'amar azul', ok: true, message: 'Listo Mati, ya se esta reproduciendo: Yo Tomo Licor - Amar Azul', track: { name: 'Yo Tomo Licor' }, timestamp: Date.now() }]
  };

  const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:4000/rulo-spotify.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url, fetchOptions) => {
        const target = String(url);
        const config = fetchOptions || {};
        let body = null;
        try { body = config.body ? JSON.parse(config.body) : null; } catch (error) { body = null; }
        calls.push({ url: target, method: config.method || 'GET', body });

        if (target.indexOf('/api/spotify-status') !== -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({
            ok: true, settings: state.settings, client: state.client, devices: state.devices, log: state.log, aliases: state.aliases, pendingCommands: 0, serverTime: Date.now()
          }) });
        }
        if (target.indexOf('/api/spotify-aliases') !== -1) {
          if (target.indexOf('-delete') !== -1) delete state.aliases[(body && body.from) || ''];
          else if (target.indexOf('-clear') !== -1) state.aliases = {};
          else if (body && body.from && body.to) state.aliases[String(body.from).toLowerCase()] = body.to;
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, aliases: state.aliases }) });
        }
        if (target.indexOf('/api/spotify-settings') !== -1) {
          Object.assign(state.settings, body && body.settings ? body.settings : {});
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, settings: state.settings }) });
        }
        if (target.indexOf('/api/spotify-test-request') !== -1) {
          // La extension tarda un poco en tomar el pedido: el registro aparece despues.
          setTimeout(() => {
            state.log.unshift({ id: 'sim-' + Date.now(), source: 'dashboard', requester: 'Dashboard', query: body && body.query, ok: true, message: 'Listo, ya se esta reproduciendo: Yo Tomo Licor - Amar Azul', track: { name: 'Yo Tomo Licor' }, timestamp: Date.now() });
          }, 700);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, command: { type: 'play', query: body && body.query } }) });
        }
        if (target.indexOf('/api/spotify-simulate-comment') !== -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        if (target.indexOf('/api/spotify-transport') !== -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        if (target.indexOf('/api/spotify-request-log-clear') !== -1) {
          state.log = [];
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      };
    }
  });
  return { dom, doc: dom.window.document, window: dom.window, calls, state };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const posts = (calls, fragment) => calls.filter(call => call.url.indexOf(fragment) !== -1 && call.method === 'POST');

(async () => {
  // ---------- A) carga y estado ----------
  {
    const { dom, doc, calls } = makeDashboard({});
    await wait(150);
    check('dashboard: se pide el estado completo', calls.some(call => call.url.indexOf('/api/spotify-status') !== -1), 'faltaba /api/spotify-status');
    check('dashboard: espera global cargada', doc.querySelector('[data-key="cooldownSeconds"]').value === '40', doc.querySelector('[data-key="cooldownSeconds"]').value);
    check('dashboard: dispositivo cargado', doc.querySelector('[data-key="deviceTargetName"]').value === 'NOTEBOOK-MATI', doc.querySelector('[data-key="deviceTargetName"]').value);
    check('dashboard: salto marcado y con segundos', doc.querySelector('[data-key="skipEnabled"]').checked === true && doc.querySelector('[data-key="skipSeconds"]').value === '10', doc.querySelector('[data-key="skipSeconds"]').value);
    check('dashboard: modo prueba apagado', doc.querySelector('[data-key="testMode"]').checked === false, 'testMode');
    check('dashboard: frecuencia de consulta cargada', doc.querySelector('[data-key="pollSeconds"]').value === '4', doc.querySelector('[data-key="pollSeconds"]').value);
    check('dashboard: chip de extension conectada e instantanea', /conectada v21 · instantánea/.test(doc.getElementById('stClient').textContent), doc.getElementById('stClient').textContent);
    check('dashboard: chip de spotify conectado', /conectado/.test(doc.getElementById('stToken').textContent), doc.getElementById('stToken').textContent);
    check('dashboard: chip de dispositivo activo', /NOTEBOOK-MATI/.test(doc.getElementById('stDevice').textContent), doc.getElementById('stDevice').textContent);
    check('dashboard: espera efectiva 40s/120s', /40s \/ 120s/.test(doc.getElementById('stEffective').textContent), doc.getElementById('stEffective').textContent);
    check('dashboard: lista de dispositivos dibujada', doc.querySelectorAll('#devices .device').length === 2, doc.querySelectorAll('#devices .device').length);
    check('dashboard: dispositivos marcados activo y restringido', /activo/.test(doc.querySelector('#devices .device').textContent), doc.querySelector('#devices .device').textContent);
    check('dashboard: registro con el pedido', /Yo Tomo Licor/.test(doc.getElementById('log').textContent), doc.getElementById('log').textContent);
    check('dashboard: contador del registro', doc.getElementById('logCount').textContent === '(1)', doc.getElementById('logCount').textContent);
    dom.window.close();
  }

  // ---------- B) sin conexion con la extension ----------
  {
    const { dom, doc } = makeDashboard({ connected: false, log: [], devices: { devices: [], activeName: '', updatedAt: 0 } });
    await wait(150);
    check('dashboard: extension sin conexion se avisa', /sin conexión/.test(doc.getElementById('stClient').textContent), doc.getElementById('stClient').textContent);
    check('dashboard: registro vacio', /Sin pedidos registrados/.test(doc.getElementById('log').textContent), doc.getElementById('log').textContent);
    check('dashboard: dispositivos vacios avisan', /Todavia no hay dispositivos|Todavía no hay dispositivos/.test(doc.getElementById('devices').textContent), doc.getElementById('devices').textContent);
    dom.window.close();
  }

  // ---------- C) modo prueba y esperas ----------
  {
    const { dom, doc, calls, state } = makeDashboard({});
    await wait(150);
    const testMode = doc.querySelector('[data-key="testMode"]');
    testMode.checked = true;
    testMode.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(700);
    const saved = posts(calls, '/api/spotify-settings');
    check('modo prueba: se guarda al tocarlo', saved.length === 1, saved.length);
    check('modo prueba: el payload lo manda encendido', saved.length === 1 && saved[0].body.settings.testMode === true, JSON.stringify(saved[0] && saved[0].body.settings && saved[0].body.settings.testMode));
    check('modo prueba: el resto de los ajustes viaja completo', saved.length === 1 && saved[0].body.settings.cooldownSeconds === 40 && saved[0].body.settings.deviceTargetName === 'NOTEBOOK-MATI', JSON.stringify(saved[0] && saved[0].body.settings));
    check('modo prueba: el backend lo refleja', state.settings.testMode === true, state.settings.testMode);
    check('modo prueba: el panel se marca', doc.getElementById('testModeField').classList.contains('test-mode-on'), doc.getElementById('testModeField').className);
    check('modo prueba: avisa que se guardo', /guardados/.test(doc.getElementById('notice').textContent), doc.getElementById('notice').textContent);

    const cooldown = doc.querySelector('[data-key="cooldownSeconds"]');
    cooldown.value = '0';
    cooldown.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(700);
    const savedTwo = posts(calls, '/api/spotify-settings');
    check('espera en 0: se guarda el cero', savedTwo.some(call => call.body.settings.cooldownSeconds === 0), JSON.stringify(savedTwo.map(call => call.body.settings.cooldownSeconds)));
    dom.window.close();
  }

  // ---------- D) pruebas manuales y transporte ----------
  {
    const { dom, doc, calls } = makeDashboard({});
    await wait(150);

    doc.getElementById('testQuery').value = 'Amar Azul Yo Tomo Licor';
    doc.getElementById('btnTest').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(120);
    const playPost = posts(calls, '/api/spotify-test-request');
    check('prueba manual: manda el tema', playPost.length === 1 && playPost[0].body.query === 'Amar Azul Yo Tomo Licor', JSON.stringify(playPost[0] && playPost[0].body));

    doc.getElementById('testQuery').value = 'laberiso';
    doc.getElementById('btnSearch').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(150);
    const searchPost = posts(calls, '/api/spotify-test-request').filter(call => call.body.searchOnly === true);
    check('buscar: se pide sin reproducir', searchPost.length === 1 && searchPost[0].body.query === 'laberiso', JSON.stringify(searchPost[0] && searchPost[0].body));

    doc.getElementById('simComment').value = 'che poneme un tema de Damas Gratis';
    doc.getElementById('simRequester').value = 'Mati';
    doc.getElementById('btnSimulate').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(120);
    const simPost = posts(calls, '/api/spotify-simulate-comment');
    check('simular comentario: manda comentario y usuario', simPost.length === 1 && /Damas Gratis/.test(simPost[0].body.comment) && simPost[0].body.requester === 'Mati', JSON.stringify(simPost[0] && simPost[0].body));

    doc.querySelector('[data-transport="next"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(120);
    const transportPost = posts(calls, '/api/spotify-transport');
    check('transporte: siguiente', transportPost.length === 1 && transportPost[0].body.action === 'next', JSON.stringify(transportPost[0] && transportPost[0].body));

    doc.getElementById('btnDevices').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(120);
    const devicePost = posts(calls, '/api/spotify-transport');
    check('dispositivos: se pide la lista a la extension', devicePost.some(call => call.body.action === 'devices'), JSON.stringify(devicePost.map(call => call.body.action)));

    doc.querySelectorAll('#devices .device button')[1].dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(700);
    check('dispositivos: "usar este" escribe el nombre', doc.querySelector('[data-key="deviceTargetName"]').value === 'Celular', doc.querySelector('[data-key="deviceTargetName"]').value);
    const deviceSaved = posts(calls, '/api/spotify-settings');
    check('dispositivos: "usar este" guarda el ajuste', deviceSaved.some(call => call.body.settings.deviceTargetName === 'Celular'), JSON.stringify(deviceSaved.map(call => call.body.settings.deviceTargetName)));

    doc.getElementById('btnClearLog').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(120);
    check('registro: se puede vaciar', posts(calls, '/api/spotify-request-log-clear').length === 1, 'faltaba el vaciado');
    dom.window.close();
  }

  // ---------- F) frecuencia + seguimiento del resultado ----------
  {
    const { dom, doc, calls } = makeDashboard({});
    await wait(150);
    const poll = doc.querySelector('[data-key="pollSeconds"]');
    poll.value = '1';
    poll.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(700);
    const saved = posts(calls, '/api/spotify-settings');
    check('frecuencia: se guarda en 1 segundo', saved.some(call => call.body.settings.pollSeconds === 1), JSON.stringify(saved.map(call => call.body.settings.pollSeconds)));

    doc.getElementById('testQuery').value = 'Amar Azul';
    doc.getElementById('btnTest').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(200);
    const box = doc.getElementById('testResult');
    check('prueba: avisa que va en camino', box.classList.contains('pending') && /en camino/.test(box.textContent), box.textContent);
    check('prueba: el aviso nombra el tema', /Amar Azul/.test(box.textContent), box.textContent);
    await wait(2200);
    check('prueba: el resultado aparece solo', box.classList.contains('ok') && /Yo Tomo Licor/.test(box.textContent), box.textContent);
    check('prueba: el registro se refresca solo', /Yo Tomo Licor/.test(doc.getElementById('log').textContent), doc.getElementById('log').textContent);
    dom.window.close();
  }

  {
    const { dom, doc } = makeDashboard({ push: false });
    await wait(150);
    check('dashboard: sin enlace instantaneo lo avisa', /por consulta/.test(doc.getElementById('stClient').textContent), doc.getElementById('stClient').textContent);
    dom.window.close();
  }

  // ---------- G) correcciones aprendidas ----------
  {
    const { dom, doc, calls, state } = makeDashboard({ aliases: { laberiso: 'la beriso', gladis: 'gladys' } });
    await wait(150);
    check('correcciones: se listan las guardadas', doc.querySelectorAll('#aliasList .device').length === 2, doc.querySelectorAll('#aliasList .device').length);
    check('correcciones: muestran la equivalencia', /laberiso/.test(doc.getElementById('aliasList').textContent) && /la beriso/.test(doc.getElementById('aliasList').textContent), doc.getElementById('aliasList').textContent);
    check('correcciones: contador visible', doc.getElementById('aliasCount').textContent === '(2)', doc.getElementById('aliasCount').textContent);

    doc.getElementById('aliasFrom').value = 'palmeraz';
    doc.getElementById('aliasTo').value = 'los palmeras';
    doc.getElementById('btnAliasAdd').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(400);
    const added = posts(calls, '/api/spotify-aliases').filter(call => call.url.indexOf('-clear') === -1 && call.url.indexOf('-delete') === -1);
    check('correcciones: se puede agregar a mano', added.length >= 1 && added[0].body.from === 'palmeraz' && added[0].body.to === 'los palmeras', JSON.stringify(added[0] && added[0].body));
    check('correcciones: la nueva queda guardada', state.aliases.palmeraz === 'los palmeras', JSON.stringify(state.aliases));

    doc.querySelectorAll('#aliasList [data-alias]')[0].dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(400);
    const removed = posts(calls, '/api/spotify-aliases-delete');
    check('correcciones: se puede quitar una', removed.length === 1, JSON.stringify(removed.map(call => call.body)));

    doc.getElementById('btnAliasClear').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(400);
    check('correcciones: se pueden vaciar', posts(calls, '/api/spotify-aliases-clear').length === 1, 'faltaba vaciar');
    dom.window.close();
  }

  // ---------- E) enlaces con session ----------
  {
    const { dom, doc } = makeDashboard({});
    await wait(120);
    check('enlaces: historial apunta al dock', doc.getElementById('histLink').getAttribute('href') === '/rulo-chat-historial.html', doc.getElementById('histLink').getAttribute('href'));
    check('enlaces: dashboard de Rulo', doc.getElementById('dashLink').getAttribute('href') === '/rulo-dashboard.html', doc.getElementById('dashLink').getAttribute('href'));
    dom.window.close();
  }

  // ---------- Resultado ----------
  const failed = results.filter(item => !item.ok);
  results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
  console.log(`\n${results.length - failed.length}/${results.length} pruebas del dashboard de Spotify OK`);
  process.exit(failed.length ? 1 : 0);
})();
