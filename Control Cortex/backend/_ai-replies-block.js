'use strict';
// Endpoint nuevo: el bot pide a la IA variantes de respuesta para un contexto.
// Se inserta antes del endpoint de estado de la instalacion.

// Saca las variantes de la respuesta de la IA: array JSON, objeto con "variants"
// o una lista de lineas. Despues limpia cada una para ese contexto (placeholders
// permitidos, largo, sin repetir lo que ya hay).
function extractAiVariants(text, entry, existing) {
  const raw = String(text || '').trim();
  const parseCandidate = candidate => {
    if (!candidate) return null;
    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    const source = arrayMatch ? arrayMatch[0] : candidate;
    let parsed = null;
    try { parsed = JSON.parse(source); } catch (error) { parsed = null; }
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.variants)) parsed = parsed.variants;
    if (Array.isArray(parsed)) {
      return parsed.map(item => (item && typeof item === 'object' ? item.text || item.variant || item.message : item));
    }
    // Ultimo recurso: lineas sueltas sin numeracion ni vinetas.
    return candidate
      .split(/\r?\n/)
      .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  };

  let candidates = parseCandidate(raw);
  try {
    const envelope = JSON.parse(raw);
    const content = envelope?.choices?.[0]?.message?.content || envelope?.content || envelope?.text;
    if (typeof content === 'string') candidates = parseCandidate(content);
  } catch (error) { /* no vino envuelto */ }

  const seen = (existing || []).map(item => String(item).toLowerCase());
  const out = [];
  (candidates || []).forEach(item => {
    const clean = cleanVariantFor(entry, item);
    if (!clean || clean.length < 6) return;
    const key = clean.toLowerCase();
    if (seen.indexOf(key) !== -1) return;
    seen.push(key);
    out.push(clean);
  });
  return out.slice(0, 6);
}

app.post('/api/spotify-ai-replies', async (req, res) => {
  const contextId = String(req.body?.context || '').trim();
  const entry = RESPONSE_CONTEXTS.find(item => item.id === contextId);
  if (!entry) return res.status(400).json({ ok: false, error: 'Ese contexto de respuesta no existe.' });

  const count = Math.min(6, Math.max(1, Math.round(Number(req.body?.count) || 3)));
  const ai = spotifyVocabulary.ai || {};
  if (ai.enabled !== true) return res.status(409).json({ ok: false, error: 'El cerebro (IA) esta apagado. Activalo en la seccion Cerebro de la pagina de entrenamiento.' });
  if (!ai.endpoint) return res.status(409).json({ ok: false, error: 'Falta configurar el endpoint de la IA.' });

  const key = spotifyAiKey();
  const current = (spotifyVocabulary.responses.contexts[contextId] || {}).variants || [];
  const placeholders = (entry.placeholders || []).map(name => '{' + name + '}');
  const systemPrompt = [
    'Sos Rulo, el bot musical de un stream en vivo en Argentina. Hablas en rioplatense, informal y corto.',
    'Escribis SOLO un array JSON de strings, sin texto extra.',
    'Tenes que escribir ' + count + ' formas NUEVAS de avisar lo mismo en este momento del pedido: ' + entry.label + '.',
    placeholders.length
      ? 'Podes usar estos datos entre llaves: ' + placeholders.join(' ') + '. No inventes otros placeholders.'
      : 'No uses placeholders entre llaves.',
    'Cada variante tiene que ser una frase completa y natural, de una sola linea, sin comillas raras.',
    'No repitas ninguna de las que ya existen: ' + (current.slice(0, 8).join(' | ') || '(todavia no hay)'),
    'No agregues emojis ni texto fuera del array.',
    ai.instructions ? 'Instrucciones del streamer: ' + ai.instructions : ''
  ].filter(Boolean).join('\n');

  const isOpenAiStyle = /chat\/completions|responses/.test(ai.endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs || 8000);
  try {
    const response = await fetch(ai.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: `Bearer ${key}` } : {}),
      body: JSON.stringify(isOpenAiStyle
        ? {
            model: ai.model || 'gpt-4o-mini',
            temperature: 0.9,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: 'Contexto: ' + entry.label + '. Escribi ' + count + ' variantes nuevas.' }
            ]
          }
        : {
            context: contextId,
            label: entry.label,
            placeholders: entry.placeholders || [],
            existing: current.slice(0, 8),
            count,
            instructions: ai.instructions || ''
          })
    });
    const text = await response.text();
    const variants = extractAiVariants(text, entry, current);
    if (!variants.length) {
      console.warn('[Spotify IA] Variantes no interpretables:', text.slice(0, 200));
      return res.status(502).json({ ok: false, error: 'La IA no devolvio variantes validas.' });
    }
    console.log(`[Spotify IA] ${variants.length} variantes nuevas para "${contextId}".`);
    res.json({ ok: true, context: contextId, variants });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    console.warn('[Spotify IA] Error generando respuestas:', timedOut ? 'timeout' : error.message);
    res.status(502).json({ ok: false, error: timedOut ? 'La IA tardo demasiado.' : 'No se pudo consultar la IA.' });
  } finally {
    clearTimeout(timer);
  }
});

