// Pruebas de la pestana "Bot / Rulo" (Rulo/Spotify/spotify-bot.html) con jsdom:
// listado editable de palabras clave, editor de respuestas por contexto, azar,
// vista previa y generacion de variantes con IA.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const PAGE_PATH = 'D:/plugins para mi OBS/Rulo/Spotify/spotify-bot.html';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

const RESPONSE_CONTEXTS = [
  { id: 'ok', label: 'Pedido aceptado (el tema ya esta sonando)', mood: 'success', placeholders: ['nombre', 'tema', 'artista', 'pedido'] },
  { id: 'notFound', label: 'No encontro el tema pedido', mood: 'warning', placeholders: ['pedido', 'busqueda', 'nombre'] },
  { id: 'waitGlobal', label: 'Espera general entre pedidos', mood: 'warning', placeholders: ['segundos', 'nombre'] }
];

function makeVocabulary() {
  return {
    commands: ['!playnow', '!tema'],
    musicWords: ['tema', 'temita', 'musica', 'cancion'],
    requestVerbs: ['quiero escuchar', 'poneme', 'pasame'],
    greetings: ['hola', 'buenas'],
    fillers: ['che', 'por favor'],
    articles: ['un', 'la'],
    genres: [{ id: 'cumbia', spotify: 'cumbia', words: ['cumbia'] }],
    typoSwaps: [['i', 'y']],
    search: { maxAttempts: 7, variantLimit: 8 },
    ai: { enabled: false, endpoint: '', model: '', instructions: '', onlyWhenNotUnderstood: true, requireSignal: true, timeoutMs: 8000 },
    responses: {
      random: true,
      avoidRepeat: true,
      recent: 4,
      contexts: {
        ok: { label: 'Pedido aceptado', variants: ['VAR-A {nombre}: {tema} - {artista}', 'VAR-B {nombre}: {tema} - {artista}', 'VAR-C {nombre}: {tema} - {artista}'] },
        notFound: { label: 'No encontrado', variants: ['NO-ESTA {pedido}'] },
        waitGlobal: { label: 'Espera', variants: ['ESPERA {segundos}s {nombre}'] }
      }
    }
  };
}

function makePage(options) {
  const opts = options || {};
  const calls = [];
  const state = {
    vocabulary: makeVocabulary(),
    aliases: { laberiso: 'la beriso' },
    aiKeyPresent: opts.aiKeyPresent === true,
    client: { connected: true, push: true, version: '27', hasToken: true, sinceLastSeenMs: 500 },
    stamp: opts.stamp || 'sello-1',
    aiReplies: opts.aiReplies || { ok: true, variants: ['NUEVA-IA-1 {nombre}: {tema}', 'NUEVA-IA-2 para {nombre}'] }
  };

  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:4000/rulo-spotify-bot.html',
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
          return json({
            ok: true,
            settings: {},
            client: state.client,
            devices: { devices: [] },
            log: [],
            aliases: state.aliases,
            vocabulary: state.vocabulary,
            aiKeyPresent: state.aiKeyPresent,
            stamps: { vocabulary: state.stamp, settings: 's-1', aliases: 'a-1' }
          });
        }
        if (target.indexOf('/api/spotify-ai-replies') !== -1) {
          return json(state.aiReplies);
        }
        if (target.indexOf('/api/spotify-vocabulary') !== -1) {
          if (config.method === 'POST') {
            state.vocabulary = body && body.vocabulary ? body.vocabulary : state.vocabulary;
            state.stamp = 'sello-guardado';
            return json({ ok: true, vocabulary: state.vocabulary, aiKeyPresent: state.aiKeyPresent, stamps: { vocabulary: state.stamp } });
          }
          return json({
            ok: true,
            vocabulary: state.vocabulary,
            defaults: makeVocabulary(),
            responseContexts: RESPONSE_CONTEXTS,
            aiKeyPresent: state.aiKeyPresent,
            stamps: { vocabulary: state.stamp }
          });
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
  // ---------- A) carga y listado de palabras clave ----------
  {
    const { dom, doc, calls } = makePage({});
    await wait(250);
    check('bot: pide el vocabulario al backend', calls.some(call => call.url.indexOf('/api/spotify-vocabulary') !== -1), calls.map(call => call.url).slice(0, 2).join(' | '));
    check('bot: las palabras clave se muestran', doc.querySelector('[data-list="musicWords"]').value.indexOf('temita') !== -1, doc.querySelector('[data-list="musicWords"]').value);
    check('bot: los verbos se muestran', /poneme/.test(doc.querySelector('[data-list="requestVerbs"]').value), doc.querySelector('[data-list="requestVerbs"]').value);
    check('bot: los comandos se muestran', /!playnow/.test(doc.querySelector('[data-list="commands"]').value), doc.querySelector('[data-list="commands"]').value);
    check('bot: los saludos y muletillas se muestran', /hola/.test(doc.querySelector('[data-list="greetings"]').value) && /che/.test(doc.querySelector('[data-list="fillers"]').value), doc.querySelector('[data-list="greetings"]').value);
    check('bot: chip de palabras', /Palabras: <strong>4/.test(doc.getElementById('chWords').innerHTML), doc.getElementById('chWords').textContent);
    check('bot: chip de contextos', /Contextos: <strong>3/.test(doc.getElementById('chContexts').innerHTML), doc.getElementById('chContexts').textContent);
    check('bot: chip de respuestas (5 en total)', /Respuestas: <strong>5/.test(doc.getElementById('chVariants').innerHTML), doc.getElementById('chVariants').textContent);
    check('bot: chip de azar encendido', /activado/.test(doc.getElementById('chRandom').textContent), doc.getElementById('chRandom').textContent);
    check('bot: chip de extension conectada', /conectada v27/.test(doc.getElementById('chClient').innerHTML), doc.getElementById('chClient').textContent);
    dom.window.close();
  }

  // ---------- B) una tarjeta por contexto con sus variantes ----------
  {
    const { dom, doc } = makePage({});
    await wait(250);
    const cards = doc.querySelectorAll('[data-context-card]');
    check('bot: una tarjeta por contexto', cards.length === 3, cards.length);
    check('bot: el contexto ok muestra sus 3 variantes', doc.querySelector('[data-context="ok"]').value.split(String.fromCharCode(10)).length === 3, doc.querySelector('[data-context="ok"]').value);
    check('bot: muestra los placeholders del contexto', /\{nombre\}/.test(cards[0].textContent) && /\{tema\}/.test(cards[0].textContent), cards[0].textContent.slice(0, 120));
    check('bot: muestra el mood', /success/.test(cards[0].textContent), cards[0].textContent.slice(0, 80));
    check('bot: el selector de la vista previa tiene los contextos', doc.getElementById('demoContext').options.length === 3, doc.getElementById('demoContext').options.length);
    dom.window.close();
  }

  // ---------- C) editar y guardar ----------
  {
    const { dom, doc, calls, state } = makePage({});
    await wait(250);
    const ok = doc.querySelector('[data-context="ok"]');
    ok.value = 'LISTO {nombre}: {tema}\nOTRA MAS {nombre}: {tema}\nTERCERA {nombre}';
    ok.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    const saved = posts(calls, '/api/spotify-vocabulary');
    check('bot: guarda al editar las respuestas', saved.length === 1, saved.length);
    check('bot: las variantes nuevas viajan al backend', saved.length === 1 && saved[0].body.vocabulary.responses.contexts.ok.variants.length === 3 && saved[0].body.vocabulary.responses.contexts.ok.variants[0] === 'LISTO {nombre}: {tema}', JSON.stringify(saved[0] && saved[0].body.vocabulary.responses.contexts.ok.variants));
    check('bot: el backend queda actualizado', state.vocabulary.responses.contexts.ok.variants[2] === 'TERCERA {nombre}', JSON.stringify(state.vocabulary.responses.contexts.ok.variants));

    const words = doc.querySelector('[data-list="musicWords"]');
    words.value = 'tema\ntemita\nhit';
    words.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    const last = posts(calls, '/api/spotify-vocabulary').pop();
    check('bot: guarda tambien las palabras clave', last.body.vocabulary.musicWords.indexOf('hit') !== -1, JSON.stringify(last.body.vocabulary.musicWords));
    check('bot: el contador de la tarjeta se actualiza', /3 respuesta/.test(doc.querySelector('[data-context-count="ok"]').textContent), doc.querySelector('[data-context-count="ok"]').textContent);
    dom.window.close();
  }

  // ---------- D) azar y no repetir ----------
  {
    const { dom, doc, calls, state } = makePage({});
    await wait(250);
    doc.getElementById('respRandom').checked = false;
    doc.getElementById('respRandom').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    const saved = posts(calls, '/api/spotify-vocabulary').pop();
    check('bot: se puede apagar el azar', saved.body.vocabulary.responses.random === false, JSON.stringify(saved.body.vocabulary.responses.random));
    check('bot: el chip avisa que el azar esta apagado', /apagado/.test(doc.getElementById('chRandom').textContent), doc.getElementById('chRandom').textContent);

    doc.getElementById('respRecent').value = '7';
    doc.getElementById('respRecent').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    check('bot: se configura cuantas recuerda', posts(calls, '/api/spotify-vocabulary').pop().body.vocabulary.responses.recent === 7, state.vocabulary.responses.recent);
    dom.window.close();
  }

  // ---------- E) probar al azar y vista previa ----------
  {
    const { dom, doc } = makePage({});
    await wait(250);
    const card = doc.querySelector('[data-context-card="ok"]');
    card.querySelector('[data-test="ok"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(150);
    const box = doc.querySelector('[data-result="ok"]');
    check('bot: probar muestra una variante con datos de ejemplo', /VAR-[ABC] Matías: Costumbres - Damas Gratis/.test(box.textContent), box.textContent);

    doc.getElementById('demoContext').value = 'notFound';
    doc.getElementById('btnDemo').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(150);
    check('bot: la vista previa usa el contexto elegido', /Matías, NO-ESTA un tema de damas gratis/.test(doc.getElementById('demoOut').textContent), doc.getElementById('demoOut').textContent);

    doc.getElementById('demoContext').value = 'ok';
    doc.getElementById('btnDemo5').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(150);
    const items = doc.querySelectorAll('#demoList li');
    const textos = Array.from(items).map(item => item.textContent);
    check('bot: la vista previa de 5 muestra 5 lineas', items.length === 5, items.length);
    check('bot: las 5 no son todas iguales (varia)', new Set(textos).size >= 2, JSON.stringify(textos));
    check('bot: no repite antes de agotar las variantes', textos[0] !== textos[1] && textos[1] !== textos[2], JSON.stringify(textos.slice(0, 3)));
    dom.window.close();
  }

  // ---------- F) generar variantes con la IA ----------
  {
    const { dom, doc, calls, state } = makePage({ aiReplies: { ok: true, variants: ['IA-UNO {nombre}: {tema}', 'IA-DOS para {nombre}: {tema}'] } });
    await wait(250);
    const card = doc.querySelector('[data-context-card="ok"]');
    card.querySelector('[data-ai="ok"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(1000);
    const aiCall = posts(calls, '/api/spotify-ai-replies')[0];
    check('bot: el boton de IA manda el contexto', !!aiCall && aiCall.body.context === 'ok' && aiCall.body.count === 3, JSON.stringify(aiCall && aiCall.body));
    const texto = doc.querySelector('[data-context="ok"]').value;
    check('bot: las variantes de la IA se agregan a la lista', texto.indexOf('IA-UNO') !== -1 && texto.indexOf('IA-DOS') !== -1, texto);
    check('bot: y se guardan solas', posts(calls, '/api/spotify-vocabulary').length >= 1 && state.vocabulary.responses.contexts.ok.variants.indexOf('IA-UNO {nombre}: {tema}') !== -1, JSON.stringify(state.vocabulary.responses.contexts.ok.variants));
    check('bot: muestra lo que agrego', /IA-UNO/.test(doc.querySelector('[data-result="ok"]').textContent), doc.querySelector('[data-result="ok"]').textContent);
    dom.window.close();
  }

  {
    // Con el cerebro apagado tiene que avisar, no romper.
    const { dom, doc } = makePage({ aiReplies: { ok: false, error: 'El cerebro (IA) esta apagado. Activalo en la seccion Cerebro de la pagina de entrenamiento.' } });
    await wait(250);
    doc.querySelector('[data-ai="ok"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(400);
    const box = doc.querySelector('[data-result="ok"]');
    check('bot: avisa si el cerebro esta apagado', box.className.indexOf('fail') !== -1 && /cerebro \(IA\) esta apagado/.test(box.textContent), box.textContent);
    dom.window.close();
  }
  {
    // Y si la IA responde cualquier cosa rara, avisa del fallo.
    const { dom, doc } = makePage({ aiReplies: { ok: false, error: 'La IA no devolvio variantes validas.' } });
    await wait(250);
    doc.querySelector('[data-ai="ok"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(400);
    check('bot: avisa si la IA no devolvio nada usable', /no devolvio variantes/.test(doc.querySelector('[data-result="ok"]').textContent), doc.querySelector('[data-result="ok"]').textContent);
    dom.window.close();
  }

  {
    // El backend guarda y marca las variantes de la IA: la pagina refleja lo que volvio.
    const { dom, doc, state } = makePage({});
    await wait(250);
    const conIa = JSON.parse(JSON.stringify(state.vocabulary));
    conIa.responses.contexts.ok.variants = conIa.responses.contexts.ok.variants.concat(['IA-MARCADA {nombre}: {tema}']);
    conIa.responses.contexts.ok.aiVariants = ['IA-MARCADA {nombre}: {tema}'];
    doc.querySelector('[data-ai="ok"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(400);
    // El mock responde ok con las variantes nuevas y el vocabulario ya guardado.
    const box = doc.querySelector('[data-result="ok"]');
    check('bot: avisa que las guardo y las marco', /marcadas como de IA/.test(box.textContent), box.textContent);
    state.vocabulary = conIa;
    dom.window.close();
  }

  // ---------- G) restaurar una lista ----------
  {
    const { dom, doc, calls } = makePage({});
    await wait(250);
    const ok = doc.querySelector('[data-context="ok"]');
    ok.value = 'SOLO UNA {nombre}';
    ok.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);
    doc.querySelector('[data-reset="ok"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(900);
    check('bot: restaurar vuelve a las 3 originales', doc.querySelector('[data-context="ok"]').value.split(String.fromCharCode(10)).length === 3, doc.querySelector('[data-context="ok"]').value);
    check('bot: lo restaurado tambien se guarda', posts(calls, '/api/spotify-vocabulary').pop().body.vocabulary.responses.contexts.ok.variants.length === 3, 'no guardo');
    dom.window.close();
  }

  // ---------- H) edicion externa del archivo ----------
  {
    const { dom, doc, state } = makePage({});
    await wait(250);
    // Alguien edita spotify-vocabulary.json por fuera: otro sello y otro contenido.
    state.vocabulary.responses.contexts.ok.variants = ['CAMBIADA-AFUERA {nombre}'];
    state.stamp = 'sello-2';
    await wait(4300);
    check('bot: recarga solo si el archivo cambio afuera', doc.querySelector('[data-context="ok"]').value.indexOf('CAMBIADA-AFUERA') !== -1, doc.querySelector('[data-context="ok"]').value);
    check('bot: avisa de la recarga', /cambió afuera/.test(doc.getElementById('notice').textContent), doc.getElementById('notice').textContent);
    dom.window.close();
  }

  // ---------- Resultado ----------
  const failed = results.filter(item => !item.ok);
  results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
  console.log(`\n${results.length - failed.length}/${results.length} pruebas de la pestana Bot / Rulo OK`);
  process.exit(failed.length ? 1 : 0);
})();
