// Pruebas del dashboard de entrenamiento (Rulo/Spotify/spotify-training.html) con jsdom:
// carga del vocabulario, edicion de listas, generos, correcciones, probador y cerebro (IA).
const fs = require('fs');
const { JSDOM } = require('jsdom');

const PAGE_PATH = 'D:/plugins para mi OBS/Rulo/Spotify/spotify-training.html';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

const VOCABULARY = {
  commands: ['!playnow', '!tema', '!musica'],
  musicWords: ['tema', 'temita', 'musica', 'cancion'],
  requestVerbs: ['quiero escuchar', 'poneme', 'pasame'],
  greetings: ['hola', 'buenas'],
  fillers: ['che', 'por favor'],
  articles: ['un', 'una', 'el', 'la', 'los', 'las'],
  genres: [
    { id: 'cumbia', spotify: 'cumbia', words: ['cumbia', 'cumbias'] },
    { id: 'reggaeton', spotify: 'reggaeton', words: ['reggaeton', 'regueton'] }
  ],
  typoSwaps: [['i', 'y'], ['b', 'v']],
  search: { maxAttempts: 7, variantLimit: 8 },
  ai: { enabled: false, endpoint: '', model: '', instructions: '', onlyWhenNotUnderstood: true, requireSignal: true, timeoutMs: 8000 }
};

function makePage(options) {
  const opts = options || {};
  const calls = [];
  const state = {
    vocabulary: JSON.parse(JSON.stringify(VOCABULARY)),
    aliases: opts.aliases || { laberiso: 'la beriso' },
    aiKeyPresent: opts.aiKeyPresent === true,
    client: { connected: opts.connected !== false, push: true, version: '25', hasToken: true, sinceLastSeenMs: 900 },
    vocabStamp: opts.vocabStamp || 'sello-1',
    log: [],
    aiInterpretation: opts.aiInterpretation || { action: 'play', artist: 'Amar Azul', title: '', genre: '', query: '', confidence: 0.9, reply: '' },
    install: opts.install || {
      ok: true,
      moduleVersion: 26,
      baseUrl: 'http://192.168.4.100:4000',
      install: {
        ok: true,
        ssnVersion: '3.50.13',
        steps: [
          { id: 'manifest', label: 'ID de extension protegido', ok: true, detail: 'clave presente' },
          { id: 'overrides', label: 'Modulos de Cortex dentro de SSN', ok: true, detail: '4 sin cambios' },
          { id: 'base-url', label: 'URL de Cortex para la extension', ok: true, detail: 'sin cambios' },
          { id: 'loader', label: 'loader.js con las lineas de Cortex', ok: true, detail: '5 lineas activas' }
        ],
        warnings: []
      },
      extension: { connected: true, version: '26', push: true, sinceLastSeenMs: 900 }
    }
  };

  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:4000/rulo-spotify-training.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url, fetchOptions) => {
        const target = String(url);
        const config = fetchOptions || {};
        let body = null;
        try { body = config.body ? JSON.parse(config.body) : null; } catch (error) { body = null; }
        calls.push({ url: target, method: config.method || 'GET', body });
        const json = payload => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });

        if (target.indexOf('/api/spotify-status') !== -1) {
          return json({ ok: true, settings: {}, client: state.client, devices: { devices: [] }, log: state.log, aliases: state.aliases, vocabulary: state.vocabulary, aiKeyPresent: state.aiKeyPresent, stamps: { vocabulary: state.vocabStamp, settings: 's-1', aliases: 'a-1' } });
        }
        if (target.indexOf('/api/spotify-vocabulary-reset') !== -1) {
          state.vocabulary = JSON.parse(JSON.stringify(VOCABULARY));
          return json({ ok: true, vocabulary: state.vocabulary });
        }
        if (target.indexOf('/api/spotify-vocabulary') !== -1) {
          if (config.method === 'POST') {
            state.vocabulary = body && body.vocabulary ? body.vocabulary : state.vocabulary;
            state.vocabStamp = 'sello-guardado';
            return json({ ok: true, vocabulary: state.vocabulary, aiKeyPresent: state.aiKeyPresent, stamps: { vocabulary: state.vocabStamp } });
          }
          return json({ ok: true, vocabulary: state.vocabulary, defaults: VOCABULARY, aiKeyPresent: state.aiKeyPresent });
        }
        if (target.indexOf('/api/spotify-simulate-comment') !== -1) {
          const comment = (body && body.comment) || '';
          setTimeout(() => {
            state.log.unshift({
              id: 'log-' + Date.now(),
              source: 'dashboard',
              requester: 'Entrenamiento',
              query: comment,
              ok: true,
              message: 'Entendi: artista/tema de laberiso (solo analisis)',
              timestamp: Date.now()
            });
          }, 500);
          return json({ ok: true });
        }
        if (target.indexOf('/api/cortex-install-status') !== -1) {
          return json(state.install);
        }
        if (target.indexOf('/api/spotify-ai-interpret') !== -1) {
          if (opts.aiDisabled) return json({ ok: false, error: 'La IA esta desactivada en el dashboard de entrenamiento.' });
          return json({ ok: true, interpretation: state.aiInterpretation });
        }
        return json({ ok: true });
      };
    }
  });
  return { dom, doc: dom.window.document, window: dom.window, calls, state };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const posts = (calls, fragment) => calls.filter(call => call.url.indexOf(fragment) !== -1 && call.method === 'POST');

(async () => {
  // ---------- A) carga del vocabulario ----------
  {
    const { dom, doc, calls } = makePage({});
    await wait(200);
    check('entrenamiento: pide el vocabulario al backend', calls.some(call => call.url.indexOf('/api/spotify-vocabulary') !== -1 || call.url.indexOf('/api/spotify-status') !== -1), calls.map(call => call.url).slice(0, 3).join(' | '));
    check('entrenamiento: palabras de musica cargadas', doc.querySelector('[data-list="musicWords"]').value.split('\n').length === 4, doc.querySelector('[data-list="musicWords"]').value);
    check('entrenamiento: verbos cargados', /quiero escuchar/.test(doc.querySelector('[data-list="requestVerbs"]').value), doc.querySelector('[data-list="requestVerbs"]').value);
    check('entrenamiento: comandos cargados', /!playnow/.test(doc.querySelector('[data-list="commands"]').value), doc.querySelector('[data-list="commands"]').value);
    check('entrenamiento: chip de palabras', /Palabras de música: <strong>4/.test(doc.getElementById('chMusic').innerHTML), doc.getElementById('chMusic').textContent);
    check('entrenamiento: chip de generos', /Géneros: <strong>2/.test(doc.getElementById('chGenres').innerHTML), doc.getElementById('chGenres').textContent);
    check('entrenamiento: chip de correcciones', /Correcciones aprendidas: <strong>1/.test(doc.getElementById('chAliases').innerHTML), doc.getElementById('chAliases').textContent);
    check('entrenamiento: chip de extension conectada', /conectada v25/.test(doc.getElementById('chClient').innerHTML), doc.getElementById('chClient').textContent);
    check('entrenamiento: chip de IA apagada', /apagado/.test(doc.getElementById('chAi').textContent), doc.getElementById('chAi').textContent);
    check('entrenamiento: clave IA avisada', /no configurada/.test(doc.getElementById('aiKeyChip').textContent), doc.getElementById('aiKeyChip').textContent);
    check('entrenamiento: tabla de generos', doc.querySelectorAll('#genresTable [data-genre-spotify]').length === 2, doc.querySelectorAll('#genresTable [data-genre-spotify]').length);
    check('entrenamiento: tabla de cambios', doc.querySelectorAll('#swapsTable [data-swap-from]').length === 2, doc.querySelectorAll('#swapsTable [data-swap-from]').length);
    check('entrenamiento: buscador configurado', doc.getElementById('maxAttempts').value === '7' && doc.getElementById('variantLimit').value === '8', doc.getElementById('maxAttempts').value);
    dom.window.close();
  }

  // ---------- B) edicion y guardado ----------
  {
    const { dom, doc, calls, state } = makePage({});
    await wait(200);
    const music = doc.querySelector('[data-list="musicWords"]');
    music.value = 'tema\ntemita\nhit\nmúsica';
    music.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    const saved = posts(calls, '/api/spotify-vocabulary');
    check('entrenamiento: guarda al editar una lista', saved.length === 1, saved.length);
    check('entrenamiento: la palabra nueva viaja al backend', saved.length === 1 && saved[0].body.vocabulary.musicWords.indexOf('hit') !== -1, JSON.stringify(saved[0] && saved[0].body.vocabulary.musicWords));
    check('entrenamiento: el vocabulario del backend se actualiza', state.vocabulary.musicWords.indexOf('hit') !== -1, JSON.stringify(state.vocabulary.musicWords));

    doc.getElementById('btnAddGenre').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(900);
    check('entrenamiento: se agrega un genero', doc.querySelectorAll('#genresTable [data-genre-spotify]').length === 3, doc.querySelectorAll('#genresTable [data-genre-spotify]').length);

    const newWord = doc.querySelectorAll('[data-genre-words]')[2];
    newWord.value = 'cuarteto, cuartetos';
    newWord.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    const lastSave = posts(calls, '/api/spotify-vocabulary').pop();
    check('entrenamiento: las palabras del genero se guardan', lastSave.body.vocabulary.genres.length === 3 && lastSave.body.vocabulary.genres[2].words.length === 2, JSON.stringify(lastSave.body.vocabulary.genres[2]));

    doc.querySelector('[data-genre-remove]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(900);
    check('entrenamiento: se quita un genero', doc.querySelectorAll('#genresTable [data-genre-spotify]').length === 2, doc.querySelectorAll('#genresTable [data-genre-spotify]').length);

    doc.getElementById('aiEnabled').checked = true;
    doc.getElementById('aiEnabled').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    doc.getElementById('aiEndpoint').value = 'https://api.openai.com/v1/chat/completions';
    doc.getElementById('aiEndpoint').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    doc.getElementById('aiInstructions').value = 'En mi stream piden mucho cumbia.';
    doc.getElementById('aiInstructions').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    const aiSave = posts(calls, '/api/spotify-vocabulary').pop();
    check('entrenamiento: el cerebro se guarda', aiSave.body.vocabulary.ai.enabled === true && /chat\/completions/.test(aiSave.body.vocabulary.ai.endpoint) && /cumbia/.test(aiSave.body.vocabulary.ai.instructions), JSON.stringify(aiSave.body.vocabulary.ai));

    doc.getElementById('btnReset').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(300);
    check('entrenamiento: se puede restaurar por defecto', posts(calls, '/api/spotify-vocabulary-reset').length === 1, 'faltaba el reset');
    dom.window.close();
  }

  // ---------- C) probador en vivo ----------
  {
    const { dom, doc, calls } = makePage({});
    await wait(200);
    doc.getElementById('probeComment').value = 'Un tema de laberiso';
    doc.getElementById('btnProbe').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(200);
    const probeCall = posts(calls, '/api/spotify-simulate-comment')[0];
    check('entrenamiento: el probador manda el comentario', !!probeCall && probeCall.body.comment === 'Un tema de laberiso' && probeCall.body.parseOnly === true, JSON.stringify(probeCall && probeCall.body));
    check('entrenamiento: avisa que esta analizando', /Analizando/.test(doc.getElementById('probeResult').textContent), doc.getElementById('probeResult').textContent);
    await wait(2000);
    check('entrenamiento: muestra que entendio', /Entendi/.test(doc.getElementById('probeResult').textContent) && /laberiso/.test(doc.getElementById('probeResult').textContent), doc.getElementById('probeResult').textContent);
    dom.window.close();
  }

  // ---------- D) cerebro (IA) ----------
  {
    const { dom, doc, calls } = makePage({ aiKeyPresent: true, aiInterpretation: { action: 'play', artist: 'Amar Azul', title: 'Yo Tomo Licor', genre: '', query: '', confidence: 0.95, reply: '' } });
    await wait(200);
    check('entrenamiento: la clave presente se muestra', /presente/.test(doc.getElementById('aiKeyChip').textContent), doc.getElementById('aiKeyChip').textContent);
    doc.getElementById('aiTestComment').value = 'pasame lo del tano';
    doc.getElementById('btnAiTest').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(300);
    const aiCall = posts(calls, '/api/spotify-ai-interpret')[0];
    check('entrenamiento: la prueba de IA manda el comentario', !!aiCall && aiCall.body.comment === 'pasame lo del tano', JSON.stringify(aiCall && aiCall.body));
    check('entrenamiento: muestra la interpretacion', /Artista: Amar Azul/.test(doc.getElementById('aiResult').textContent) && /Tema: Yo Tomo Licor/.test(doc.getElementById('aiResult').textContent), doc.getElementById('aiResult').textContent);
    dom.window.close();
  }

  {
    const { dom, doc } = makePage({ aiDisabled: true });
    await wait(200);
    doc.getElementById('aiTestComment').value = 'pasame lo del tano';
    doc.getElementById('btnAiTest').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(300);
    check('entrenamiento: avisa si la IA esta apagada', /desactivada/.test(doc.getElementById('aiResult').textContent), doc.getElementById('aiResult').textContent);
    dom.window.close();
  }

  // ---------- E) estado de la instalacion (migracion de SocialStream Ninja) ----------
  {
    const { dom, doc, calls } = makePage({});
    await wait(200);
    check('instalacion: consulta el estado al abrir', calls.some(call => call.url.indexOf('/api/cortex-install-status') !== -1), calls.map(call => call.url).slice(0, 4).join(' | '));
    check('instalacion: chip de SSN', /v3\.50\.13/.test(doc.getElementById('inSsn').textContent), doc.getElementById('inSsn').textContent);
    check('instalacion: chip de parcheo aplicado', doc.getElementById('inPatch').className.indexOf('is-ok') !== -1 && /aplicado/.test(doc.getElementById('inPatch').textContent), doc.getElementById('inPatch').className + ' ' + doc.getElementById('inPatch').textContent);
    check('instalacion: chip de modulo', /v26/.test(doc.getElementById('inModule').textContent), doc.getElementById('inModule').textContent);
    check('instalacion: chip de extension', /conectada v26/.test(doc.getElementById('inBase').textContent), doc.getElementById('inBase').textContent);
    const rows = doc.querySelectorAll('#installSteps div');
    check('instalacion: muestra las 4 verificaciones', rows.length === 4, rows.length);
    check('instalacion: las verificaciones dicen OK', /OK/.test(doc.getElementById('installSteps').textContent) && /loader\.js/.test(doc.getElementById('installSteps').textContent), doc.getElementById('installSteps').textContent.slice(0, 120));
    dom.window.close();
  }

  {
    // Caso feo: la extension quedo sin el parcheo (por ejemplo despues de actualizar SSN).
    const { dom, doc, calls } = makePage({
      install: {
        ok: true,
        moduleVersion: 26,
        install: {
          ok: false,
          ssnVersion: '4.0.0',
          steps: [
            { id: 'overrides', label: 'Modulos de Cortex dentro de SSN', ok: false, detail: 'no esta en la extension' },
            { id: 'loader', label: 'loader.js con las lineas de Cortex', ok: false, detail: 'le falta o le sobra algo' }
          ],
          warnings: ['El parcheo no se pudo aplicar: falta el loader.']
        },
        extension: { connected: false, version: '', push: false, sinceLastSeenMs: null }
      }
    });
    await wait(200);
    check('instalacion: avisa cuando falta el parcheo', doc.getElementById('inPatch').className.indexOf('is-warn') !== -1 && /revisar/.test(doc.getElementById('inPatch').textContent), doc.getElementById('inPatch').textContent);
    check('instalacion: avisa cuando la extension no esta', /sin conexión/.test(doc.getElementById('inBase').textContent), doc.getElementById('inBase').textContent);
    check('instalacion: muestra las fallas con detalle', /FALLA/.test(doc.getElementById('installSteps').textContent) && /no esta en la extension/.test(doc.getElementById('installSteps').textContent), doc.getElementById('installSteps').textContent.slice(0, 130));
    check('instalacion: muestra los avisos', /Aviso: El parcheo no se pudo aplicar/.test(doc.getElementById('installSteps').textContent), doc.getElementById('installSteps').textContent.slice(0, 160));
    check('instalacion: avisa que hay que re-aplicar', /falta re-aplicar/.test(doc.getElementById('notice').textContent), doc.getElementById('notice').textContent);
    doc.getElementById('btnInstall').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(150);
    check('instalacion: el boton vuelve a consultar', calls.filter(call => call.url.indexOf('/api/cortex-install-status') !== -1).length >= 2, calls.filter(call => call.url.indexOf('/api/cortex-install-status') !== -1).length);
    dom.window.close();
  }

  // ---------- G) el JSON lo edita algo externo (una IA, el editor, otra pestana) ----------
  {
    const { dom, doc, state } = makePage({});
    await wait(250);
    check('externo: sello inicial adoptado', doc.querySelector('[data-list="musicWords"]').value.split(String.fromCharCode(10)).length === 4, doc.querySelector('[data-list="musicWords"]').value);

    // Alguien edita Rulo/Spotify/spotify-vocabulary.json por fuera: el backend
    // sirve otro contenido y otro sello.
    state.vocabulary.musicWords = ['tema', 'temita', 'hit', 'tocadita'];
    state.vocabStamp = 'sello-2';
    await wait(4300);
    check('externo: el formulario se recarga solo', doc.querySelector('[data-list="musicWords"]').value.indexOf('tocadita') !== -1, doc.querySelector('[data-list="musicWords"]').value);
    check('externo: avisa que cambio afuera', /cambió afuera/.test(doc.getElementById('notice').textContent), doc.getElementById('notice').textContent);
    check('externo: los chips se actualizan', /Palabras de música: <strong>4/.test(doc.getElementById('chMusic').innerHTML), doc.getElementById('chMusic').textContent);

    // Ahora con el foco puesto en un campo: no tiene que pisar lo que escribis.
    const music = doc.querySelector('[data-list="musicWords"]');
    music.focus();
    music.value = 'lo que estoy escribiendo';
    music.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    state.vocabulary.musicWords = ['otra', 'cosa'];
    state.vocabStamp = 'sello-3';
    await wait(4300);
    check('externo: no pisa lo que estas editando', music.value === 'lo que estoy escribiendo', music.value);
    check('externo: avisa que hay que recargar', /Recargar del servidor/.test(doc.getElementById('notice').textContent), doc.getElementById('notice').textContent);

    // Y si aprieta recargar, toma el contenido nuevo y el sello.
    doc.getElementById('btnReload').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(200);
    check('externo: recargar trae el contenido nuevo', music.value.indexOf('otra') !== -1 && music.value.indexOf('cosa') !== -1, music.value);
    dom.window.close();
  }

  // ---------- Resultado ----------
  const failed = results.filter(item => !item.ok);
  results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
  console.log(`\n${results.length - failed.length}/${results.length} pruebas del entrenamiento OK`);
  process.exit(failed.length ? 1 : 0);
})();
