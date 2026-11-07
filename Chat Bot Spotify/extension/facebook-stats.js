'use strict';
((root) => {
  const labels = {
    currentViewers: ['Espectadores actuales', 'Current viewers', 'Concurrent viewers', 'Espectadores', 'Espectador', 'Viewers'],
    peakViewers: ['Número máximo de espectadores', 'Peak viewers', 'Peak concurrent viewers'],
    reactions: ['Reacciones totales', 'Total reactions', 'Reacciones', 'Reactions'],
    comments: ['Total de comentarios', 'Total comments', 'Comentarios totales', 'Comentario', 'Comentarios', 'Comment', 'Comments'],
    shares: ['Total de veces compartido', 'Total shares', 'Veces compartido', 'Veces compartidas', 'Veces compartidos', 'Compartidos', 'Shared'],
    clips: ['Clips', 'Clip'],
    views3s: ['Reproducciones de 3 segundos', '3-second views'],
    views15s: ['Reproducciones de 15 segundos', '15-second views'],
    views60s: ['Reproducciones de 60 segundos', '60-second views'],
    stars: ['Estrellas enviadas', 'Stars sent'],
    starSenders: ['Remitentes únicos', 'Unique senders']
  };
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  function streamId(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(u.hostname)) return '';
      const id = u.pathname.match(/\/live\/producer\/(?:v2|dashboard)\/(\d+)(?:\/|$)/i)?.[1]
        || u.pathname.match(/\/live\/producer\/(\d+)(?:\/|$)/i)?.[1]
        || u.pathname.match(/\/videos?\/(\d+)(?:\/|$)/)?.[1]
        || u.searchParams.get('v') || u.searchParams.get('video_id') || '';
      return /^\d{5,30}$/.test(id) ? id : '';
    } catch (_) { return ''; }
  }
  function isStatsPage(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(u.hostname)) return false;
      return /\/live\/producer\/(?:v2\/\d+\/insights|dashboard\/\d+\/(?:insights|stream_stats))(?:\/|$)/i.test(u.pathname);
    } catch (_) { return false; }
  }
  function count(value) {
    const raw = String(value ?? '').trim().replace(/\u00a0/g, ' ');
    if (!/^(?:\d{1,9}|\d{1,3}(?:[., ]\d{3}){1,2})$/.test(raw)) return null;
    const n = Number(raw.replace(/[., ]/g, ''));
    return Number.isSafeInteger(n) && n >= 0 && n <= 100000000 ? n : null;
  }
  function parse(text) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const exact = [];
    const metrics = {};
    for (const [key, aliases] of Object.entries(labels)) {
      for (let i = 0; i < lines.length; i++) {
        const line = normalize(lines[i]);
        for (const alias of aliases.map(normalize)) {
          let value = null;
          if (line === alias) {
            exact.push({ key, index: i });
          } else if (line.startsWith(alias + ' ')) value = count(line.slice(alias.length).trim());
          else if (line.endsWith(' ' + alias)) value = count(line.slice(0, -alias.length).trim());
          if (value !== null) metrics[key] = value;
        }
      }
    }
    let previousOnly = 0;
    let nextOnly = 0;
    for (const item of exact) {
      const previous = item.index > 0 ? count(lines[item.index - 1]) : null;
      const next = item.index + 1 < lines.length ? count(lines[item.index + 1]) : null;
      if (previous !== null && next === null) previousOnly++;
      if (next !== null && previous === null) nextOnly++;
    }
    const valuesPrecedeLabels = previousOnly > nextOnly;
    for (const item of exact) {
      const index = item.index + (valuesPrecedeLabels ? -1 : 1);
      const value = index >= 0 && index < lines.length ? count(lines[index]) : null;
      if (value !== null) metrics[item.key] = value;
    }
    return metrics;
  }
  const api = { streamId, isStatsPage, count, parse, labels };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FacebookStats = api;
})(globalThis);
