'use strict';
// Respuestas del bot / Rulo: cada momento del pedido tiene su contexto y cada
// contexto tiene VARIAS variantes. El modulo elige una al azar (sin repetir las
// ultimas) y rellena los datos. Vive en Rulo/Spotify/spotify-vocabulary.json
// (bloque "responses") y se edita desde la pestana "Bot / Rulo" del dashboard.
//
// Placeholders disponibles por contexto (se limpian solos si no hay dato):
//   {nombre} {tema} {artista} {pedido} {busqueda} {genero} {segundos}
//   {dispositivo} {accion} {comando} {dispositivos} {entendido}
//
// Un detalle importante: si una variante pide un dato que no existe en ese
// momento (por ejemplo {genero} cuando el pedido es un tema), el modulo la saltea
// y elige otra; por eso se puede mezclar tranquilo.

const RESPONSE_CONTEXTS = [
  {
    id: 'ok',
    label: 'Pedido aceptado (el tema ya esta sonando)',
    mood: 'success',
    placeholders: ['nombre', 'tema', 'artista', 'pedido'],
    variants: [
      'Listo {nombre}, ya se esta reproduciendo: {tema} - {artista}',
      '{nombre} ya te puse el tema, es: {tema} - {artista}',
      'Bueno {nombre}, ahi va el tema que pediste: {tema} - {artista}',
      '{nombre} ya esta sonando: {tema} - {artista}',
      'Dale {nombre}, te pongo {tema} - {artista}',
      'Anotado {nombre}: ahora suena {tema} - {artista}',
      'Ahi va {nombre}: {tema} - {artista}',
      '{nombre} pedido, ahora suena {tema} - {artista}',
      'Va {nombre}: {tema} - {artista}',
      'Toma {nombre}, ahi te lo puse: {tema} - {artista}'
    ]
  },
  {
    id: 'searching',
    label: 'Aviso mientras busca (mood pensando)',
    mood: 'thinking',
    placeholders: ['busqueda', 'genero'],
    variants: [
      'Buscando "{busqueda}" en Spotify...',
      'A ver, busco {busqueda}...',
      'Dame un segundo, estoy buscando {busqueda}...',
      'Buscando algo de {genero}...',
      'Ya te busco {busqueda}, aguantame...'
    ]
  },
  {
    id: 'busy',
    label: 'Ya esta procesando otro pedido',
    mood: 'warning',
    placeholders: ['nombre'],
    variants: [
      'Ya estoy procesando un pedido musical. Espera un momento.',
      'Tranquilo {nombre}, estoy con otro tema y ya te lo pongo.',
      'Un pedido a la vez {nombre}, ya casi termino.',
      'Aguantame {nombre} que estoy poniendo otro tema.'
    ]
  },
  {
    id: 'waitGlobal',
    label: 'Espera general entre pedidos',
    mood: 'warning',
    placeholders: ['segundos', 'nombre'],
    variants: [
      'Espera {segundos}s para pedir otro tema.',
      'Falta poco: en {segundos}s te tomo otro pedido.',
      'Dejame respirar {segundos}s y te pongo otro tema.',
      '{nombre}, en {segundos}s te tomo el proximo tema.'
    ]
  },
  {
    id: 'waitUser',
    label: 'El mismo usuario pidio hace poco',
    mood: 'warning',
    placeholders: ['segundos', 'nombre'],
    variants: [
      'Ya pediste un tema hace poco. Espera {segundos}s.',
      '{nombre}, ya te puse uno hace un rato: espera {segundos}s mas.',
      'Calma {nombre}, en {segundos}s te tomo otro tema.'
    ]
  },
  {
    id: 'notFound',
    label: 'No encontro el tema pedido',
    mood: 'warning',
    placeholders: ['pedido', 'busqueda', 'nombre'],
    variants: [
      'No encontre ese tema en Spotify.',
      'No me aparece "{pedido}" en Spotify {nombre}, proba con el nombre exacto.',
      'Busque {pedido} y no lo encontre, fijate si esta bien escrito.',
      'Uy {nombre}, no tengo ese tema: proba con otro nombre.'
    ]
  },
  {
    id: 'noToken',
    label: 'Spotify sin conectar',
    mood: 'error',
    placeholders: [],
    variants: [
      'Spotify no esta conectado.',
      'No tengo conexion con Spotify, avisale al streamer.',
      'Spotify no me responde: ahora no puedo poner musica.'
    ]
  },
  {
    id: 'noDevice',
    label: 'No hay ningun dispositivo Spotify disponible',
    mood: 'error',
    placeholders: [],
    variants: [
      'No encontre un dispositivo Spotify disponible. Abri Spotify en la PC del OBS y reproduce/pausa algo una vez.',
      'Necesito que Spotify este abierto en la PC del OBS para poder sonar.',
      'No veo ningun dispositivo de Spotify: abri Spotify y dale play una vez.'
    ]
  },
  {
    id: 'noDeviceConfigured',
    label: 'No encuentra el dispositivo configurado',
    mood: 'error',
    placeholders: ['dispositivo'],
    variants: [
      'No encuentro el dispositivo configurado "{dispositivo}". Envia !spotifydevices para ver los nombres disponibles.',
      'El dispositivo "{dispositivo}" no aparece: manda !spotifydevices para ver cual usar.',
      'No veo "{dispositivo}" entre los dispositivos: revisalo con !spotifydevices.'
    ]
  },
  {
    id: 'noActiveDevice',
    label: 'No hay dispositivo activo',
    mood: 'error',
    placeholders: [],
    variants: [
      'No hay dispositivo activo. Abri Spotify y reproduce algo manualmente primero.',
      'No tengo donde ponerlo: dale play una vez en Spotify y volve a pedir.',
      'Ningun dispositivo activo: abri Spotify en la PC del OBS y dale play.'
    ]
  },
  {
    id: 'deviceActivateFail',
    label: 'No pudo activar la PC del OBS',
    mood: 'error',
    placeholders: [],
    variants: [
      'Spotify no pudo activar la PC del OBS.',
      'No pude despertar a Spotify en la PC del OBS, proba de nuevo.',
      'Spotify no me dejo activar el dispositivo de la PC.'
    ]
  },
  {
    id: 'playbackError',
    label: 'No pudo cambiar el tema',
    mood: 'error',
    placeholders: [],
    variants: [
      'No pude cambiar el tema',
      'No me dejo cambiar el tema, proba de nuevo en un rato.',
      'Uy, no pude poner ese tema.'
    ]
  },
  {
    id: 'error',
    label: 'Error procesando el pedido',
    mood: 'error',
    placeholders: [],
    variants: [
      'Error procesando el pedido musical.',
      'Algo se me trabo con ese pedido, proba de nuevo.',
      'No pude procesar el pedido, manda el tema otra vez.'
    ]
  },
  {
    id: 'analysis',
    label: 'Busqueda de prueba (no reproduce)',
    mood: 'success',
    placeholders: ['tema', 'artista', 'busqueda'],
    variants: [
      'Encontre: {tema} - {artista} (no reproduje)',
      'Si, lo tengo: {tema} - {artista}',
      'Este es: {tema} - {artista}'
    ]
  },
  {
    id: 'analysisFail',
    label: 'Busqueda de prueba sin resultado',
    mood: 'warning',
    placeholders: ['busqueda'],
    variants: [
      'No encontre nada para "{busqueda}".',
      'Nada para "{busqueda}": fijate como lo escribiste.',
      'Busque "{busqueda}" y no aparece nada.'
    ]
  },
  {
    id: 'parseDebug',
    label: 'Analisis de un comentario (solo entrenamiento)',
    mood: 'success',
    placeholders: ['entendido'],
    variants: [
      'Entendi: {entendido}',
      'Lei esto: {entendido}',
      'Segun mis reglas es: {entendido}'
    ]
  },
  {
    id: 'transportOk',
    label: 'Comando de transporte enviado',
    mood: 'success',
    placeholders: ['accion'],
    variants: [
      'Comando "{accion}" enviado a Spotify.',
      'Listo, {accion}.',
      'Dale, {accion}.'
    ]
  },
  {
    id: 'transportFail',
    label: 'Comando de transporte fallo',
    mood: 'error',
    placeholders: ['accion'],
    variants: [
      'No se pudo ejecutar "{accion}".',
      'No me dejo hacer {accion}.',
      'Fallo {accion}, proba otra vez.'
    ]
  },
  {
    id: 'devices',
    label: 'Lista de dispositivos a pedido (!spotifydevices)',
    mood: 'success',
    placeholders: ['dispositivos'],
    variants: [
      'Dispositivos Spotify: {dispositivos}',
      'Estos dispositivos veo: {dispositivos}',
      'Dispositivos disponibles: {dispositivos}'
    ]
  },
  {
    id: 'usage',
    label: 'Uso incorrecto de un comando',
    mood: 'warning',
    placeholders: ['comando'],
    variants: [
      'Uso: {comando} <tema o artista>',
      'Decime el tema asi: {comando} nombre del tema',
      'Me falta el dato: {comando} + el tema o artista'
    ]
  }
];

const RESPONSE_IDS = RESPONSE_CONTEXTS.map(entry => entry.id);

// Lo que el dashboard necesita para armar la pestana "Bot / Rulo".
const RESPONSE_CONTEXT_META = RESPONSE_CONTEXTS.map(entry => ({
  id: entry.id,
  label: entry.label,
  mood: entry.mood,
  placeholders: entry.placeholders || []
}));

const DEFAULT_SPOTIFY_RESPONSES = {
  random: true,
  avoidRepeat: true,
  // Cuantas respuestas recientes se recuerdan por contexto para no repetir.
  recent: 4,
  contexts: RESPONSE_CONTEXTS.reduce((acc, entry) => {
    acc[entry.id] = { label: entry.label, variants: entry.variants.slice() };
    return acc;
  }, {})
};

function cleanVariant(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

// Deja solo los placeholders que ese contexto entiende, para que una variante
// escrita a mano (o por la IA) no arrastre texto raro al chat. Se saca CUALQUIER
// cosa entre llaves que no este permitida (incluso con espacios o mal escrita).
function cleanVariantFor(entry, value) {
  const allowed = (entry.placeholders || []).map(name => String(name).toLowerCase());
  const withoutUnknown = String(value === undefined || value === null ? '' : value)
    .replace(/\{([^}]*)\}/g, (match, inner) => (allowed.indexOf(String(inner).trim().toLowerCase()) !== -1 ? match : ' '));
  return cleanVariant(withoutUnknown.replace(/\s{2,}/g, ' '));
}

// Clave para comparar variantes entre si: sin placeholders, sin mayusculas y sin
// puntuacion, asi "Listo, {tema}" y "listo {tema}" cuentan como la misma.
function variantKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Algunos proveedores contestan 200 con el error como TEXTO en vez de un status
// de error (DeepSeek devuelve "Authentication Fails (governor)" con 200). Si no
// se detecta, ese texto entra al chat como si fuera una respuesta del bot.
const AI_FAILURE_PATTERNS = [
  [/authentication fails|invalid api key|incorrect api key|invalid_api_key|api key not valid|unauthoriz|not authorized|forbidden/i,
    'La IA rechazo la clave: revisa SPOTIFY_AI_API_KEY en Control Cortex/backend/.env.'],
  [/insufficient balance|insufficient_quota|quota exceeded|exceeded your current quota|billing|no credit/i,
    'La cuenta de la IA no tiene saldo o cuota disponible.'],
  [/rate limit|too many requests|429/i,
    'La IA esta limitando los pedidos (rate limit): proba de nuevo en un rato.'],
  [/maximum context|context length|too long/i,
    'El pedido es demasiado largo para el modelo de IA.'],
  [/model not found|does not exist|unknown model|invalid model|no such model/i,
    'El modelo configurado no existe en ese endpoint: revisa el nombre del modelo.']
];

function aiFailureMessage(text) {
  const raw = String(text || '');
  for (let i = 0; i < AI_FAILURE_PATTERNS.length; i += 1) {
    if (AI_FAILURE_PATTERNS[i][0].test(raw)) return AI_FAILURE_PATTERNS[i][1];
  }
  return '';
}

// El mensaje de error del sobre estilo OpenAI, si viene.
function aiEnvelopeError(parsed) {
  const message = parsed && parsed.error && (parsed.error.message || parsed.error.type);
  return message ? String(message) : '';
}

function normalizeSpotifyResponses(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const contexts = {};
  RESPONSE_CONTEXTS.forEach(entry => {
    const incoming = source.contexts && source.contexts[entry.id];
    const variants = incoming && Array.isArray(incoming.variants) ? incoming.variants : null;
    const cleaned = (variants || entry.variants)
      .map(value => cleanVariantFor(entry, value))
      .filter(Boolean)
      .slice(0, 12);
    const finales = cleaned.length ? cleaned : entry.variants.slice(0, 1);
    // aiVariants: las que escribio la IA, para poder analizar despues si la
    // respuesta que salio al aire la genero la IA o es una de las de fabrica.
    const deIa = (incoming && Array.isArray(incoming.aiVariants) ? incoming.aiVariants : [])
      .map(value => cleanVariantFor(entry, value))
      .filter(value => value && finales.indexOf(value) !== -1);
    contexts[entry.id] = {
      label: String((incoming && incoming.label) || entry.label).slice(0, 90),
      variants: finales,
      aiVariants: deIa
    };
  });
  const recent = Number(source.recent);
  return {
    random: source.random !== false,
    avoidRepeat: source.avoidRepeat !== false,
    recent: Number.isFinite(recent) ? Math.min(10, Math.max(0, Math.round(recent))) : 4,
    contexts
  };
}

// Agrega variantes generadas por la IA al contexto que corresponde: entran a la
// lista normal y quedan marcadas en aiVariants (sin duplicar lo que ya estaba).
function addAiVariants(responses, contextId, variants) {
  const entry = RESPONSE_CONTEXTS.find(item => item.id === contextId);
  const block = responses && responses.contexts && responses.contexts[contextId];
  if (!entry || !block || !Array.isArray(variants)) return [];
  const actuales = Array.isArray(block.variants) ? block.variants.slice() : [];
  const marcadas = Array.isArray(block.aiVariants) ? block.aiVariants.slice() : [];
  const agregadas = [];
  variants.forEach(variante => {
    const limpia = cleanVariantFor(entry, variante);
    if (!limpia || actuales.indexOf(limpia) !== -1) return;
    actuales.push(limpia);
    marcadas.push(limpia);
    agregadas.push(limpia);
  });
  // El tope de 12 por contexto es el mismo que usa el normalize.
  while (actuales.length > 12) {
    const quitada = actuales.shift();
    const posicion = marcadas.indexOf(quitada);
    if (posicion !== -1) marcadas.splice(posicion, 1);
  }
  block.variants = actuales;
  block.aiVariants = marcadas.filter(variante => actuales.indexOf(variante) !== -1);
  return agregadas;
}

// Sugerencias para arreglar lo que no se encuentra: la IA mira los comentarios
// que fallaron y devuelve, por cada uno, que problema vio y que habria que
// cargar (una correccion de escritura, una palabra nueva, un genero...).
const TIPOS_SUGERENCIA = ['alias', 'cancion', 'artista', 'palabra', 'genero', 'nada'];

function parseAiSuggestions(text, comentarios) {
  const crudo = String(text || '').trim();
  const parsear = candidato => {
    if (!candidato) return null;
    const bloque = String(candidato).match(/\[[\s\S]*\]/);
    const fuente = bloque ? bloque[0] : String(candidato);
    try {
      const datos = JSON.parse(fuente);
      return Array.isArray(datos) ? datos : (datos && Array.isArray(datos.sugerencias) ? datos.sugerencias : null);
    } catch (error) {
      return null;
    }
  };
  let lista = parsear(crudo);
  try {
    const sobre = JSON.parse(crudo);
    const contenido = sobre?.choices?.[0]?.message?.content || sobre?.content || sobre?.text;
    if (typeof contenido === 'string') lista = parsear(contenido);
  } catch (error) { /* no vino envuelto */ }

  const validos = (comentarios || []).map(item => String(item).toLowerCase());
  const salida = [];
  (lista || []).forEach(item => {
    if (!item || typeof item !== 'object') return;
    const comentario = cleanVariant(item.comment || item.comentario || '');
    const tipo = String(item.tipo || item.type || '').toLowerCase();
    if (!comentario || TIPOS_SUGERENCIA.indexOf(tipo) === -1) return;
    // El comentario tiene que ser uno de los que se le pasaron.
    const coincide = validos.indexOf(comentario.toLowerCase()) !== -1;
    if (!coincide) return;
    salida.push({
      comentario,
      problema: cleanVariant(item.problema || item.issue || '').slice(0, 160),
      tipo,
      de: cleanVariant(item.de || item.from || '').slice(0, 60),
      a: cleanVariant(item.a || item.to || '').slice(0, 60),
      confianza: Number.isFinite(Number(item.confianza || item.confidence)) ? Number(item.confianza || item.confidence) : null
    });
  });
  return salida.slice(0, 20);
}

module.exports = {
  parseAiSuggestions,
  TIPOS_SUGERENCIA,
  addAiVariants,
  RESPONSE_CONTEXTS,
  RESPONSE_IDS,
  RESPONSE_CONTEXT_META,
  DEFAULT_SPOTIFY_RESPONSES,
  normalizeSpotifyResponses,
  cleanVariant,
  cleanVariantFor,
  variantKey,
  aiFailureMessage,
  aiEnvelopeError
};
