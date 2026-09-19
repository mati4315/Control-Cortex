// Pruebas del modulo de respuestas del backend (Control Cortex/backend/spotify-responses.js):
// normalizacion, limpieza de variantes escritas por la IA y deteccion de errores
// que el proveedor devuelve con status 200 (DeepSeek: "Authentication Fails").
const RESP = require('D:/plugins para mi OBS/Control Cortex/backend/spotify-responses.js');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

// ---------- A) contextos de fabrica ----------
{
  const ids = RESP.RESPONSE_CONTEXTS.map(entry => entry.id);
  check('respuestas: estan los contextos clave', ['ok', 'searching', 'notFound', 'waitGlobal', 'error'].every(id => ids.indexOf(id) !== -1), ids.join(','));
  check('respuestas: el ok tiene varias variantes de fabrica', RESP.DEFAULT_SPOTIFY_RESPONSES.contexts.ok.variants.length >= 8, RESP.DEFAULT_SPOTIFY_RESPONSES.contexts.ok.variants.length);
  check('respuestas: la primera variante del ok mantiene el texto historico', /^Listo \{nombre\}, ya se esta reproduciendo: \{tema\} - \{artista\}$/.test(RESP.DEFAULT_SPOTIFY_RESPONSES.contexts.ok.variants[0]), RESP.DEFAULT_SPOTIFY_RESPONSES.contexts.ok.variants[0]);
  check('respuestas: todos los contextos traen al menos una variante', RESP.RESPONSE_CONTEXTS.every(entry => entry.variants.length >= 1), 'falta alguna');
  const meta = RESP.RESPONSE_CONTEXT_META;
  check('respuestas: la meta no arrastra las variantes', meta.every(entry => entry.variants === undefined) && meta[0].label && meta[0].mood, JSON.stringify(meta[0]));
}

// ---------- B) normalizacion ----------
{
  const normalizado = RESP.normalizeSpotifyResponses({});
  check('normalizar: sin datos quedan los valores de fabrica', normalizado.contexts.ok.variants.length === RESP.DEFAULT_SPOTIFY_RESPONSES.contexts.ok.variants.length, 'no uso el default');
  check('normalizar: azar y no-repetir encendidos por defecto', normalizado.random === true && normalizado.avoidRepeat === true && normalizado.recent === 4, JSON.stringify({ random: normalizado.random, recent: normalizado.recent }));

  const mio = RESP.normalizeSpotifyResponses({
    random: false,
    recent: 99,
    contexts: { ok: { variants: ['  Solo   esta   {nombre}  ', ''] } }
  });
  check('normalizar: respeta lo que viene', mio.random === false && mio.contexts.ok.variants.length === 1, JSON.stringify(mio.contexts.ok.variants));
  check('normalizar: limpia espacios de las variantes', mio.contexts.ok.variants[0] === 'Solo esta {nombre}', JSON.stringify(mio.contexts.ok.variants[0]));
  check('normalizar: el tope de recientes queda entre 0 y 10', mio.recent === 10, mio.recent);
  check('normalizar: los contextos que no vienen quedan de fabrica', mio.contexts.notFound.variants.length >= 1, 'vacio');
  check('normalizar: aguanta basura', (() => { const r = RESP.normalizeSpotifyResponses('no soy objeto'); return r.contexts.ok.variants.length >= 1; })(), 'rompio');
  const conPlaceholderRaro = RESP.normalizeSpotifyResponses({ contexts: { ok: { variants: ['Hola {nombre}, {cosa rara} y {tema}'] } } });
  check('normalizar: saca los placeholders que no van', conPlaceholderRaro.contexts.ok.variants[0].indexOf('{cosa') === -1 && conPlaceholderRaro.contexts.ok.variants[0].indexOf('{nombre}') !== -1, conPlaceholderRaro.contexts.ok.variants[0]);
}

// ---------- C) limpieza de variantes de la IA ----------
{
  const entry = RESP.RESPONSE_CONTEXTS.find(item => item.id === 'ok');
  check('limpieza: saca el placeholder inventado', RESP.cleanVariantFor(entry, 'Toma {nombre}, {color} ahora {tema}') === 'Toma {nombre}, ahora {tema}', RESP.cleanVariantFor(entry, 'Toma {nombre}, {color} ahora {tema}'));
  check('limpieza: no deja dobles espacios', RESP.cleanVariantFor(entry, 'Toma  {nombre}   y   {tema}') === 'Toma {nombre} y {tema}', RESP.cleanVariantFor(entry, 'Toma  {nombre}   y   {tema}'));
  check('limpieza: corta las variantes larguisimas', RESP.cleanVariantFor(entry, 'a'.repeat(400)).length <= 220, 'no corto');
  const contexto = RESP.RESPONSE_CONTEXTS.find(item => item.id === 'transportOk');
  check('limpieza: cada contexto acepta solo sus placeholders', RESP.cleanVariantFor(contexto, '{accion} y {nombre}') === '{accion} y', RESP.cleanVariantFor(contexto, '{accion} y {nombre}'));
  check('clave: dos formas de decir lo mismo dan la misma clave', RESP.variantKey('Listo, {tema}!') === RESP.variantKey('listo {tema}'), RESP.variantKey('Listo, {tema}!'));
}

// ---------- D) errores del proveedor con status 200 ----------
{
  check('errores: detecta el rechazo de la clave (DeepSeek)', /clave/.test(RESP.aiFailureMessage('Authentication Fails (governor)')), RESP.aiFailureMessage('Authentication Fails (governor)'));
  check('errores: detecta falta de saldo', /saldo/.test(RESP.aiFailureMessage('{"error":{"message":"Insufficient Balance"}}')), RESP.aiFailureMessage('Insufficient Balance'));
  check('errores: detecta el rate limit', /limitando/.test(RESP.aiFailureMessage('Rate limit reached for requests')), 'no lo vio');
  check('errores: detecta el modelo mal escrito', /modelo configurado no existe/.test(RESP.aiFailureMessage('The model `deepsek-flash` does not exist')), 'no lo vio');
  check('errores: una respuesta normal no es un error', RESP.aiFailureMessage('Listo {nombre}, suena {tema}') === '', 'falso positivo');
  check('errores: lee el mensaje del sobre estilo OpenAI', RESP.aiEnvelopeError({ error: { message: 'Invalid API key' } }) === 'Invalid API key', RESP.aiEnvelopeError({ error: { message: 'Invalid API key' } }));
  check('errores: sin sobre devuelve vacio', RESP.aiEnvelopeError({ choices: [] }) === '', 'devolvio algo');
}

// ---------- E) cuales respuestas las escribio la IA ----------
{
  const vacio = RESP.normalizeSpotifyResponses({});
  check('ia: arranca sin variantes marcadas', Array.isArray(vacio.contexts.ok.aiVariants) && vacio.contexts.ok.aiVariants.length === 0, JSON.stringify(vacio.contexts.ok.aiVariants));

  const conIa = RESP.normalizeSpotifyResponses({});
  const agregadas = RESP.addAiVariants(conIa, 'ok', ['Nueva de la IA {nombre}: {tema}', 'Nueva de la IA {nombre}: {tema}', '']);
  check('ia: agrega la variante generada', agregadas.length === 1, JSON.stringify(agregadas));
  check('ia: queda en la lista y marcada', conIa.contexts.ok.variants.indexOf(agregadas[0]) !== -1 && conIa.contexts.ok.aiVariants.indexOf(agregadas[0]) !== -1, JSON.stringify(conIa.contexts.ok.aiVariants));
  check('ia: no se pierde la marca al normalizar', RESP.normalizeSpotifyResponses(conIa).contexts.ok.aiVariants.length === 1, 'se perdio');
  check('ia: una marca huerfana se descarta', RESP.normalizeSpotifyResponses({ contexts: { ok: { variants: ['Otra {tema}'], aiVariants: ['Ya no esta {tema}'] } } }).contexts.ok.aiVariants.length === 0, 'quedo una marca sin variante');
  check('ia: no agrega a un contexto que no existe', RESP.addAiVariants(conIa, 'no-existe', ['x y']).length === 0, 'agrego igual');
  check('ia: no duplica lo que ya estaba', RESP.addAiVariants(conIa, 'ok', [conIa.contexts.ok.variants[0]]).length === 0, 'duplico');
  const lleno = RESP.normalizeSpotifyResponses({});
  RESP.addAiVariants(lleno, 'ok', ['Uno {nombre} y {tema}', 'Dos {nombre} y {tema}', 'Tres {nombre} y {tema}', 'Cuatro {nombre} y {tema}', 'Cinco {nombre} y {tema}']);
  check('ia: respeta el tope de 12 por contexto', lleno.contexts.ok.variants.length <= 12, lleno.contexts.ok.variants.length);
}

const failed = results.filter(item => !item.ok);
results.forEach(item => console.log(`${item.ok ? 'OK  ' : 'FALLA'}  ${item.name}${item.ok ? '' : ' -- ' + item.detail}`));
console.log(`\n${results.length - failed.length}/${results.length} pruebas del modulo de respuestas OK`);
process.exit(failed.length ? 1 : 0);
