const fs = require('fs');
const { JSDOM } = require('jsdom');

const BASE = 'D:/plugins para mi OBS/Rulo/';
const CONFIG = { botName: 'Rulo', accent: '#221a61', avatarLetter: 'A', visibleMs: 7000, maxWidth: 760, fontSize: 1.35, panelOpacity: 0.94, showRequester: true, showMascot: false, overlayTheme: 'dark', animation: 'slide' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

function makeDom(file, search, fetchMap) {
  const html = fs.readFileSync(BASE + file, 'utf8');
  const sockets = [];
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:4000/' + file + (search || ''),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url, options) => {
        const key = String(url).split('?')[0];
        const handler = fetchMap[key];
        const body = handler ? handler(options) : { success: true };
        return Promise.resolve({ json: () => Promise.resolve(body), ok: true });
      };
      window.WebSocket = class {
        constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); setTimeout(() => { if (this.onopen) this.onopen({}); }, 5); }
        send() {}
        close() { if (this.onclose) this.onclose(); }
      };
      window.requestAnimationFrame = cb => setTimeout(cb, 0);
    }
  });
  return { dom, sockets, window: dom.window, doc: dom.window.document };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---------- A) overlay ----------
  {
    const { doc, sockets } = makeDom('rulo-bot-overlay.html', '?preview=1&mood=warning&session=XJ9hQ2JDHH',
      { '/api/rulo-config': () => ({ success: true, config: CONFIG }) });
    await wait(120);
    const panel = doc.getElementById('reply');
    check('overlay: panel visible en modo preview', panel.classList.contains('visible'), panel.className);
    check('overlay: mood del query respetado', panel.dataset.mood === 'warning', panel.dataset.mood);
    check('overlay: nombre desde config', doc.getElementById('botName').textContent === 'Rulo', doc.getElementById('botName').textContent);
    check('overlay: texto de preview', /Vista previa/.test(doc.getElementById('message').textContent), doc.getElementById('message').textContent);
    check('overlay: WS conectado', sockets.length === 1, sockets.length);

    // mensaje real: payload dice Anormalia + mood error -> debe ganar la config y tomar el mood
    sockets[0].onmessage({ data: JSON.stringify({ type: 'rulo_bot_message', rulo: { message: 'No encontre ese tema.', botName: 'Anormalia', mood: 'error', requester: 'Matias' } }) });
    await wait(20);
    check('overlay: payload no pisa el nombre', doc.getElementById('botName').textContent === 'Rulo', doc.getElementById('botName').textContent);
    check('overlay: mood error aplicado', panel.dataset.mood === 'error', panel.dataset.mood);
    check('overlay: mood invalido no rompe', (() => {
      sockets[0].onmessage({ data: JSON.stringify({ type: 'rulo_bot_message', rulo: { message: 'x', mood: 'lol' } }) });
      return panel.dataset.mood === 'lol';
    })(), panel.dataset.mood);
    check('overlay: config en vivo actualiza nombre', (() => {
      sockets[0].onmessage({ data: JSON.stringify({ type: 'rulo_config_updated', config: { ...CONFIG, botName: 'Anormalia 22' } }) });
      return doc.getElementById('botName').textContent === 'Anormalia 22';
    })(), doc.getElementById('botName').textContent);
    check('overlay: mascota sin asset no rompe', doc.getElementById('mascot').hidden === true || doc.getElementById('mascot').hasAttribute('src') === false, 'ok');
    check('overlay: arranca en tema oscuro', !doc.documentElement.classList.contains('theme-light'), doc.documentElement.className);
    check('overlay: inicial clara sobre acento oscuro', doc.documentElement.style.getPropertyValue('--avatar-ink') === '#f5f7fa', doc.documentElement.style.getPropertyValue('--avatar-ink'));
    check('overlay: panel oscuro por defecto', /rgba\(14, 17, 22/.test(doc.documentElement.style.getPropertyValue('--panel')), doc.documentElement.style.getPropertyValue('--panel'));
  }

  // ---------- A2) overlay con tema ----------
  {
    const lightByConfig = makeDom('rulo-bot-overlay.html', '?preview=1&mood=success',
      { '/api/rulo-config': () => ({ success: true, config: { ...CONFIG, overlayTheme: 'light' } }) }).doc;
    await wait(140);
    check('overlay: tema claro desde la config',
      lightByConfig.documentElement.classList.contains('theme-light') && /rgba\(255, 255, 255/.test(lightByConfig.documentElement.style.getPropertyValue('--panel')),
      lightByConfig.documentElement.className + ' | ' + lightByConfig.documentElement.style.getPropertyValue('--panel'));

    const lightByParam = makeDom('rulo-bot-overlay.html', '?preview=1&theme=light',
      { '/api/rulo-config': () => ({ success: true, config: CONFIG }) }).doc;
    await wait(140);
    check('overlay: ?theme=light gana sobre la config', lightByParam.documentElement.classList.contains('theme-light'), lightByParam.documentElement.className);

    const darkByParam = makeDom('rulo-bot-overlay.html', '?preview=1&theme=dark',
      { '/api/rulo-config': () => ({ success: true, config: { ...CONFIG, overlayTheme: 'light' } }) }).doc;
    await wait(140);
    check('overlay: ?theme=dark tambien gana', !darkByParam.documentElement.classList.contains('theme-light'), darkByParam.documentElement.className);

    const withMascot = makeDom('rulo-bot-overlay.html', '?preview=1&mood=warning',
      { '/api/rulo-config': () => ({ success: true, config: { ...CONFIG, showMascot: true } }) }).doc;
    await wait(140);
    const mascotImg = withMascot.getElementById('mascot');
    check('overlay: con mascota pide el asset del estado',
      /\/rulo-assets\/warning\.svg$/.test(mascotImg.getAttribute('src') || ''),
      mascotImg.getAttribute('src'));

    const limeInk = makeDom('rulo-bot-overlay.html', '?preview=1',
      { '/api/rulo-config': () => ({ success: true, config: { ...CONFIG, accent: '#9fd50b' } }) }).doc;
    await wait(140);
    check('overlay: inicial oscura sobre acento claro', limeInk.documentElement.style.getPropertyValue('--avatar-ink') === '#111', limeInk.documentElement.style.getPropertyValue('--avatar-ink'));
  }

  // ---------- B) historial ----------
  {
    const items = [
      { id: 'a1', requester: 'Matias Moreira', comment: 'pone un tema de El Polaco', response: 'Listo Matias, ya se esta reproduciendo: ...', chatimg: '', source: 'youtube', timestamp: Date.now() - 60000, messageId: 'm1' },
      { id: 'a2', requester: 'Ana', comment: 'que lindo stream', response: '', chatimg: '', source: 'tiktok', timestamp: Date.now(), messageId: 'm2' }
    ];
    let cleared = 0;
    const { doc, sockets } = makeDom('rulo-chat-historial.html', '?session=XJ9hQ2JDHH', {
      '/api/rulo-config': () => ({ success: true, config: CONFIG }),
      '/api/rulo-chat-messages': () => ({ success: true, items, total: items.length }),
      '/api/rulo-chat-clear': () => { cleared += 1; return { success: true }; },
      '/api/rulo-repeat-response': () => ({ success: true })
    });
    await wait(200);
    const rows = doc.querySelectorAll('.row');
    check('historial: filas renderizadas', rows.length === 2, rows.length);
    check('historial: etiqueta de respuesta con nombre de config', /Rulo responde/.test(doc.querySelector('.resp-label').textContent), doc.querySelector('.resp-label').textContent);
    const answeredRow = doc.getElementById('rulo-row-a1');
    const pendingRow = doc.getElementById('rulo-row-a2');
    check('historial: sin respuesta no muestra nada',
      pendingRow.querySelector('.response').classList.contains('is-empty') && pendingRow.querySelector('.response-text').textContent === '',
      pendingRow.querySelector('.response-text').textContent);
    check('historial: con respuesta la celda se muestra',
      !answeredRow.querySelector('.response').classList.contains('is-empty') && /Listo Matias/.test(answeredRow.querySelector('.response-text').textContent),
      answeredRow.querySelector('.response-text').textContent);
    // zebra: la primera fila visible queda oscura y la segunda clara
    check('historial: filas alternadas (1 oscura, 2 clara)',
      !doc.getElementById('rulo-row-a2').classList.contains('zebra-b') && doc.getElementById('rulo-row-a1').classList.contains('zebra-b'),
      'a2=' + doc.getElementById('rulo-row-a2').className + ' | a1=' + doc.getElementById('rulo-row-a1').className);
    // zebra en layout apilado (movil <=620px): alterna por CELDA, nunca dos iguales juntos
    const realMatchMedia = doc.defaultView.matchMedia;
    doc.defaultView.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {} });
    doc.getElementById('filterText').dispatchEvent(new doc.defaultView.Event('input'));
    await wait(20);
    check('historial: apilado alterna por celda (nunca 2 iguales juntos)',
      !doc.getElementById('rulo-row-a2').querySelector('.comment').classList.contains('zebra-cell')
      && doc.getElementById('rulo-row-a1').querySelector('.comment').classList.contains('zebra-cell')
      && !doc.getElementById('rulo-row-a1').querySelector('.response').classList.contains('zebra-cell'),
      'a2c=' + doc.getElementById('rulo-row-a2').querySelector('.comment').className
      + ' | a1c=' + doc.getElementById('rulo-row-a1').querySelector('.comment').className
      + ' | a1r=' + doc.getElementById('rulo-row-a1').querySelector('.response').className);
    doc.defaultView.matchMedia = realMatchMedia;
    doc.getElementById('filterText').dispatchEvent(new doc.defaultView.Event('input'));
    await wait(20);

    const badges = Array.prototype.map.call(doc.querySelectorAll('.source'), n => n.textContent).sort();
    check('historial: badges de plataforma', badges.join(',') === 'tiktok,youtube', badges.join(','));
    check('historial: contador', /2 de 2/.test(doc.getElementById('counter').textContent), doc.getElementById('counter').textContent);
    check('historial: chip WS conectado', /Conectado/.test(doc.getElementById('wsState').textContent), doc.getElementById('wsState').textContent);
    check('historial: chip de peers P2P', /Peers P2P: 0/.test(doc.getElementById('p2pState').textContent), doc.getElementById('p2pState').textContent);
    check('historial: estado y Dashboard dentro de Mas Opciones',
      doc.getElementById('toolbar').contains(doc.getElementById('wsState'))
      && doc.getElementById('toolbar').contains(doc.getElementById('p2pState'))
      && doc.getElementById('toolbar').contains(doc.getElementById('dashboardLink')),
      'ok');
    const headerKids = Array.prototype.slice.call(doc.querySelector('header').children);
    check('historial: header = flecha, titulo, lupa, Mas Opciones y tema (sin chips)',
      headerKids.length === 5
      && headerKids[0].id === 'headerToggle'
      && headerKids[1].tagName === 'H1'
      && headerKids[2].classList.contains('font-controls')
      && headerKids[3].id === 'moreOptions'
      && headerKids[4].id === 'themeToggle',
      headerKids.map(n => n.tagName + '#' + (n.id || '') + '.' + (n.className || '')).join('|'));
    check('historial: opciones de plataforma pobladas', doc.querySelectorAll('#filterSource option').length === 3, doc.querySelectorAll('#filterSource option').length);

    // filtro "solo sin respuesta"
    const pending = doc.getElementById('filterPending');
    pending.checked = true;
    pending.dispatchEvent(new doc.defaultView.Event('change'));
    await wait(20);
    check('historial: filtro solo sin respuesta', doc.querySelectorAll('.row:not([hidden])').length === 1, doc.querySelectorAll('.row:not([hidden])').length);
    // al filtrar, la unica fila visible vuelve a ser la "primera" (sin zebra)
    check('historial: zebra respeta el filtro',
      !doc.getElementById('rulo-row-a2').classList.contains('zebra-b') && doc.getElementById('rulo-row-a2').hidden === false,
      doc.getElementById('rulo-row-a2').className);
    pending.checked = false;
    pending.dispatchEvent(new doc.defaultView.Event('change'));

    // filtro de texto
    const text = doc.getElementById('filterText');
    text.value = 'polaco';
    text.dispatchEvent(new doc.defaultView.Event('input'));
    await wait(20);
    check('historial: filtro de texto', doc.querySelectorAll('.row:not([hidden])').length === 1, doc.querySelectorAll('.row:not([hidden])').length);
    text.value = '';
    text.dispatchEvent(new doc.defaultView.Event('input'));

    // panel de opciones: abajo, colapsado por defecto y abierto con "Mas Opciones"
    const toolbar = doc.getElementById('toolbar');
    const more = doc.getElementById('moreOptions');
    check('historial: opciones arranca colapsado', toolbar.classList.contains('collapsed') && more.getAttribute('aria-expanded') === 'false', toolbar.className + '|' + more.getAttribute('aria-expanded'));
    more.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: Mas Opciones abre el panel', !toolbar.classList.contains('collapsed') && more.getAttribute('aria-expanded') === 'true', toolbar.className);
    check('historial: el boton cambia de texto', /Ocultar/.test(more.textContent), more.textContent);
    check('historial: el panel queda debajo de la lista', doc.querySelector('main + #toolbar') === toolbar, 'ok');
    more.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: segundo clic lo vuelve a cerrar', toolbar.classList.contains('collapsed') && more.textContent === 'Mas Opciones', more.textContent);

    // el boton avisa cuando hay filtros activos adentro del panel
    const searchText = doc.getElementById('filterText');
    searchText.value = 'polaco';
    searchText.dispatchEvent(new doc.defaultView.Event('input'));
    await wait(20);
    check('historial: el boton marca filtros activos', more.classList.contains('has-filters'), more.className);
    searchText.value = '';
    searchText.dispatchEvent(new doc.defaultView.Event('input'));
    await wait(20);
    check('historial: la marca se apaga sin filtros', !more.classList.contains('has-filters'), more.className);

    // destacar un comentario sin peers: aviso persistente + marca en el boton
    doc.querySelector('.row .comment').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await wait(60);
    const p2pChip = doc.getElementById('p2pState');
    const toast = doc.getElementById('p2pToast');
    check('historial: sin peers muestra el aviso en el area del chat',
      toast.hidden === false && toast.dataset.kind === 'bad' && /No hay peers/.test(toast.textContent) && /XJ9hQ2JDHH/.test(toast.textContent),
      toast.hidden + '|' + toast.dataset.kind + '|' + toast.textContent);
    check('historial: sin peers avisa en el chip y en el boton',
      /Sin peers/.test(p2pChip.textContent) && p2pChip.className === 'chip bad' && more.classList.contains('has-warning'),
      p2pChip.textContent + ' | ' + more.className);
    await wait(2800);
    check('historial: el aviso no se borra solo', /Sin peers/.test(p2pChip.textContent), p2pChip.textContent);
    const frame = doc.querySelector('iframe');
    doc.defaultView.dispatchEvent(new doc.defaultView.MessageEvent('message', {
      source: frame.contentWindow,
      data: { action: 'push-connection-info', UUID: 'u1', value: { label: 'featured' } }
    }));
    await wait(40);
    // con un peer conectado, el aviso pasa a exito
    doc.querySelector('.row .comment').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await wait(60);
    check('historial: con peer avisa destacado',
      toast.hidden === false && toast.dataset.kind === 'ok' && /destacado en 1 peer/.test(toast.textContent),
      toast.dataset.kind + '|' + toast.textContent);
    check('historial: al aparecer un peer vuelve el contador',
      p2pChip.textContent === 'Peers P2P: 1' && p2pChip.className === 'chip ok' && !more.classList.contains('has-warning'),
      p2pChip.textContent + ' | ' + more.className);

    // el header se oculta al bajar y vuelve al subir (la barra de letra queda)
    const headerEl = doc.querySelector('header');
    const listEl = doc.getElementById('list');
    let fakeTop = 0;
    Object.defineProperty(listEl, 'scrollTop', { get: () => fakeTop, configurable: true });
    const scrollTo = async (value) => { fakeTop = value; listEl.dispatchEvent(new doc.defaultView.Event('scroll')); await wait(30); };
    await scrollTo(0);
    check('historial: header visible arriba de todo', !headerEl.classList.contains('minimized'), headerEl.className);
    await scrollTo(200);
    check('historial: header se oculta al bajar', headerEl.classList.contains('minimized'), headerEl.className);
    await scrollTo(420);
    check('historial: sigue oculto bajando', headerEl.classList.contains('minimized'), headerEl.className);
    await scrollTo(300);
    check('historial: al subir el header vuelve', !headerEl.classList.contains('minimized'), headerEl.className);
    await scrollTo(60);
    check('historial: sigue visible subiendo', !headerEl.classList.contains('minimized'), headerEl.className);
    await scrollTo(0);

    // flecha de la punta izquierda: mostrar / ocultar a mano
    const headerToggle = doc.getElementById('headerToggle');
    check('historial: la flecha arranca pidiendo ocultar', headerToggle.title === 'Ocultar el encabezado' && headerToggle.getAttribute('aria-pressed') === 'false', headerToggle.title);
    headerToggle.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: la flecha oculta el encabezado',
      headerEl.classList.contains('minimized') && headerToggle.title === 'Mostrar el encabezado' && headerToggle.getAttribute('aria-pressed') === 'true',
      headerToggle.title + '/' + headerToggle.getAttribute('aria-pressed'));
    headerToggle.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: la flecha lo vuelve a mostrar',
      !headerEl.classList.contains('minimized') && headerToggle.getAttribute('aria-pressed') === 'false',
      headerToggle.title);
    await scrollTo(0);
    headerToggle.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: la flecha oculta tambien arriba de todo', headerEl.classList.contains('minimized'), headerEl.className);
    await scrollTo(200);
    await scrollTo(100);
    check('historial: el scroll retoma el control automatico', !headerEl.classList.contains('minimized'), headerEl.className);
    await scrollTo(0);

    // control de tamano de letra
    const up = doc.getElementById('fontUp');
    const down = doc.getElementById('fontDown');
    const reset = doc.getElementById('fontReset');
    const level = doc.getElementById('fontLevel');
    const scale = () => doc.documentElement.style.getPropertyValue('--font-scale');
    // tema claro / oscuro
    const root = doc.documentElement;
    const theme = doc.getElementById('themeToggle');
    check('historial: arranca en tema oscuro', !root.classList.contains('theme-light'), root.className);
    check('historial: sol visible en oscuro', !theme.querySelector('.icon-sun').hidden && theme.title === 'Cambiar a tema claro', theme.title);
    theme.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: el boton pasa a tema claro', root.classList.contains('theme-light'), root.className);
    check('historial: en claro el boton pide volver a oscuro', theme.title === 'Cambiar a tema oscuro', theme.title);
    theme.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: el boton vuelve a tema oscuro', !root.classList.contains('theme-light'), root.className);
    theme.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: el tema queda guardado', doc.defaultView.localStorage.getItem('ruloHistorialTheme') === 'light', doc.defaultView.localStorage.getItem('ruloHistorialTheme'));
    theme.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    const controls = Array.prototype.slice.call(doc.querySelectorAll('.font-controls > button'));
    check('historial: barra = lupa -, Restablecer y lupa +',
      controls.map(b => b.id).join(',') === 'fontDown,fontReset,fontUp',
      controls.map(b => b.id).join(','));
    check('historial: el tema queda al final de la linea (ultimo del header)',
      doc.querySelector('header').lastElementChild.id === 'themeToggle'
      && doc.querySelector('header').firstElementChild.id === 'headerToggle',
      doc.querySelector('header').firstElementChild.id + ' ... ' + doc.querySelector('header').lastElementChild.id);
    check('historial: escala inicial 100%', scale() === '1' && level.textContent === '100%', scale() + '|' + level.textContent);
    up.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    up.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: lupa + agranda la letra', scale() === '1.2' && level.textContent === '120%', scale() + '|' + level.textContent);
    down.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: lupa - achica la letra', scale() === '1.1', scale());
    reset.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: Restablecer vuelve al original', scale() === '1' && level.textContent === '100%', scale() + '|' + level.textContent);
    for (let i = 0; i < 20; i++) up.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: tope maximo y boton deshabilitado', scale() === '1.8' && up.disabled === true, scale() + '|' + up.disabled);
    for (let i = 0; i < 30; i++) down.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: tope minimo y boton deshabilitado', scale() === '0.8' && down.disabled === true, scale() + '|' + down.disabled);
    reset.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));

    // la respuesta llega despues: la misma fila se actualiza y la celda deja de estar vacia
    sockets[0].onmessage({ data: JSON.stringify({ type: 'rulo_chat_item', item: { ...items[1], response: 'Anotado, ya la pongo.' } }) });
    await wait(40);
    const late = doc.getElementById('rulo-row-a2');
    check('historial: respuesta tardia activa la celda',
      !late.querySelector('.response').classList.contains('is-empty') && late.querySelector('.response-text').textContent === 'Anotado, ya la pongo.',
      late.querySelector('.response-text').textContent);

    // limpiar historial en dos pasos
    const clear = doc.getElementById('clearHistory');
    clear.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('historial: primer clic arma la limpieza', /Confirmar/.test(clear.textContent) && cleared === 0, clear.textContent);
    clear.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await wait(80);
    check('historial: segundo clic limpia', cleared === 1 && doc.querySelectorAll('.row').length === 0, JSON.stringify({ cleared, rows: doc.querySelectorAll('.row').length }));
    check('historial: boton vuelve al texto normal', clear.textContent === 'Limpiar historial', clear.textContent);
  }

  // ---------- C) dashboard ----------
  {
    const { doc } = makeDom('rulo-dashboard.html', '?session=XJ9hQ2JDHH', {
      '/api/rulo-config': () => ({ success: true, config: CONFIG }),
      '/api/rulo-cortex': () => ({ success: true })
    });
    await wait(150);
    check('dashboard: campo showMascot presente', !!doc.getElementById('showMascot'), 'ok');
    const themeSelect = doc.getElementById('overlayTheme');
    check('dashboard: selector de tema del overlay con 2 opciones', !!themeSelect && themeSelect.options.length === 2 && themeSelect.value === 'dark', themeSelect ? themeSelect.value + '/' + themeSelect.options.length : 'falta');
    check('dashboard: la vista previa respeta el tema', /theme=dark/.test(doc.getElementById('preview').src), doc.getElementById('preview').src);
    themeSelect.value = 'light';
    themeSelect.dispatchEvent(new doc.defaultView.Event('change'));
    await wait(20);
    check('dashboard: cambiar el tema refresca la vista previa', /theme=light/.test(doc.getElementById('preview').src), doc.getElementById('preview').src);
    check('dashboard: selector de estados con 6 opciones', doc.querySelectorAll('#previewMood option').length === 6, doc.querySelectorAll('#previewMood option').length);
    check('dashboard: nombre del bot desde config', doc.getElementById('brandName').textContent === 'Rulo', doc.getElementById('brandName').textContent);
    check('dashboard: botName cargado en el input', doc.getElementById('botName').value === 'Rulo', doc.getElementById('botName').value);
    check('dashboard: preview con mood', /mood=success/.test(doc.getElementById('preview').src), doc.getElementById('preview').src);
    check('dashboard: link a mascota', /rulo-mascota\.html/.test(doc.getElementById('mascotLink').href), doc.getElementById('mascotLink').href);
    check('dashboard: link a historial', /rulo-chat-historial\.html/.test(doc.getElementById('historyLink').href), doc.getElementById('historyLink').href);
    const mood = doc.getElementById('previewMood');
    mood.value = 'error';
    mood.dispatchEvent(new doc.defaultView.Event('change'));
    await wait(20);
    check('dashboard: cambio de estado refresca preview', /mood=error/.test(doc.getElementById('preview').src), doc.getElementById('preview').src);
  }

  // ---------- D) prototipo de mascota ----------
  {
    const { doc } = makeDom('rulo-mascota.html', '?session=XJ9hQ2JDHH', {});
    await wait(150);
    check('mascota: 7 swatches de color', doc.querySelectorAll('.swatch').length === 7, doc.querySelectorAll('.swatch').length);
    check('mascota: 6 botones de estado', doc.querySelectorAll('.toolbar button[data-state]').length === 6, doc.querySelectorAll('.toolbar button[data-state]').length);
    check('mascota: overlay embebido con mood', /mood=success/.test(doc.getElementById('overlayPreview').src), doc.getElementById('overlayPreview').src);
    const btn = doc.querySelector('.toolbar button[data-state="error"]');
    btn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await wait(30);
    check('mascota: cambio de estado pinta el personaje', doc.getElementById('pet').dataset.state === 'error', doc.getElementById('pet').dataset.state);
    check('mascota: overlay sigue el estado elegido', /mood=error/.test(doc.getElementById('overlayPreview').src), doc.getElementById('overlayPreview').src);
  }

  // ---------- E) assets de la mascota ----------
  {
    const nodePath = require('path');
    const assetsDir = nodePath.join(__dirname, '..', 'assets');
    const estados = ['idle', 'thinking', 'success', 'warning', 'error', 'speaking'];
    const problems = [];
    estados.forEach(state => {
      try {
        const text = fs.readFileSync(nodePath.join(assetsDir, state + '.svg'), 'utf8');
        if (!text.startsWith('<svg')) problems.push(state + ': no parece SVG');
        else if (!text.includes('viewBox="0 0 512 512"')) problems.push(state + ': viewBox distinto');
        else if (/<image\b/.test(text)) problems.push(state + ': referencia externa');
        else if (text.length < 400) problems.push(state + ': sospechosamente chico');
      } catch (error) {
        problems.push(state + ': ' + error.code);
      }
    });
    check('assets: los 6 SVG existen y son validos', problems.length === 0, problems.join(' | '));
    const manifest = JSON.parse(fs.readFileSync(nodePath.join(assetsDir, 'states.json'), 'utf8'));
    check('assets: states.json tiene los 6 estados en listo',
      manifest.states.length === 6 && manifest.states.every(s => s.listo === true && estados.includes(s.state)),
      manifest.states.map(s => s.state + ':' + s.listo).join(','));
  }

  const failed = results.filter(r => !r.ok);
  console.log('\n================ RESULTADOS ================');
  results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '   -> ' + r.detail)));
  console.log('-------------------------------------------');
  console.log(`${results.length - failed.length}/${results.length} pruebas OK`);
  process.exit(failed.length ? 1 : 0);
})();
