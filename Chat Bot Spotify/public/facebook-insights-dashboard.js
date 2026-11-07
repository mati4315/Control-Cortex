'use strict';
(() => {
  const labels = { currentViewers: 'Espectadores actuales', peakViewers: 'Máximo de espectadores',
    reactions: 'Reacciones', comments: 'Comentarios totales', shares: 'Compartidos', clips: 'Clips',
    views3s: 'Reproducciones de 3 s', views15s: 'Reproducciones de 15 s', views60s: 'Reproducciones de 60 s',
    stars: 'Estrellas enviadas', starSenders: 'Remitentes de estrellas' };
  let busy = false;
  async function refresh() {
    if (busy || !token) return;
    busy = true;
    const root = document.getElementById('facebookInsights');
    try {
      const response = await fetch('/api/facebook-insights', { headers: auth(), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las estadísticas.');
      root.replaceChildren();
      if (!data.streams.length) {
        root.textContent = 'Todavía no llegaron estadísticas. Recarga la extensión y abre Estadísticas desde su popup.';
      }
      for (const row of data.streams) {
        const card = document.createElement('article');
        card.className = 'capture';
        const title = document.createElement('strong');
        title.textContent = (row.accountLabel || 'Facebook') + ' · ' + row.streamId;
        const state = document.createElement('p');
        state.className = 'hint';
        state.textContent = row.fresh ? (row.source === 'insights' ? 'Estadísticas de Live Producer' : 'Contador del video') + ' · recibido ' + new Date(row.updatedAt).toLocaleTimeString() : 'Sin datos recientes: abre o revisa la pestaña de Facebook.';
        card.append(title, state);
        const list = document.createElement('div');
        list.className = 'statline';
        for (const [key, label] of Object.entries(labels)) {
          const field = document.createElement('span');
          const value = row.metrics[key];
          field.textContent = label + ': ' + (Number.isFinite(value) ? value.toLocaleString('es-AR') : '—');
          list.append(field);
        }
        card.append(list);
        root.append(card);
      }
    } catch (error) { root.textContent = error.message; }
    finally { busy = false; }
  }
  setInterval(refresh, 5000);
  refresh();
})();
