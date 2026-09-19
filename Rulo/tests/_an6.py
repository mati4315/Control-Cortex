import io

# ---------- A) chip de recordatorio en el estado del dashboard ----------
p = 'D:/plugins para mi OBS/Rulo/Spotify/spotify-dashboard.html'
s = io.open(p, encoding='utf-8', newline='').read()

old = """<span class="chip" id="stDevice">Dispositivo activo: <strong>\u2026</strong></span>"""
new = """<span class="chip" id="stDevice">Dispositivo activo: <strong>\u2026</strong></span>
        <span class="chip" id="stAnalisis" style="cursor:pointer" title="Ir al an\u00e1lisis">An\u00e1lisis: <strong>\u2026</strong></span>"""
assert old in s, 'chip'
s = s.replace(old, new, 1)

old2 = """      function renderStatus(data) {"""
new2 = """      function renderRecordatorio(datos) {
        const info = (datos && datos.analytics) || null;
        const chip = el('stAnalisis');
        if (!chip) return;
        const pendientes = info ? info.pendientes : 0;
        if (!info || !pendientes) {
          chip.className = 'chip';
          chip.innerHTML = 'Análisis: <strong>al día</strong>';
          return;
        }
        chip.className = 'chip is-warn';
        chip.innerHTML = 'Análisis: <strong>' + esc(pendientes) + ' sin revisar</strong>' +
          (info.nuevosNoEncontrados ? ' (' + esc(info.nuevosNoEncontrados) + ' sin encontrar)' : '');
      }

      function renderStatus(data) {"""
assert old2 in s, 'renderStatus'
s = s.replace(old2, new2, 1)

old3 = """      function applyStatus(data) {
        renderStatus(data);"""
new3 = """      function applyStatus(data) {
        renderStatus(data);
        renderRecordatorio(data);"""
assert old3 in s, 'applyStatus'
s = s.replace(old3, new3, 1)

old4 = """      el('btnAn').addEventListener('click', cargarAnalisis);"""
new4 = """      el('stAnalisis').addEventListener('click', () => {
        const destino = document.getElementById('anTotal');
        if (destino && destino.scrollIntoView) destino.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      el('btnAn').addEventListener('click', cargarAnalisis);"""
assert old4 in s, 'click chip'
s = s.replace(old4, new4, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('dashboard: chip de recordatorio')

# ---------- B) el estado trae el recordatorio (para el chip) ----------
ps = 'D:/plugins para mi OBS/Control Cortex/backend/server.js'
b = io.open(ps, encoding='utf-8', newline='').read()
old5 = """    log: spotifyRequestLog.slice(-SPOTIFY_REQUEST_LOG_LIMIT).reverse(),
    stamps: spotifyFileStamps(),"""
new5 = """    log: spotifyRequestLog.slice(-SPOTIFY_REQUEST_LOG_LIMIT).reverse(),
    stamps: spotifyFileStamps(),
    // Recordatorio: cuantas interacciones quedan sin revisar en el analisis.
    analytics: (() => {
      try {
        const stats = spotifyAnalytics.stats(7);
        return stats && stats.recordatorio ? stats.recordatorio : null;
      } catch (error) {
        return null;
      }
    })(),"""
assert old5 in b, 'status analytics'
b = b.replace(old5, new5, 1)
io.open(ps, 'w', encoding='utf-8', newline='').write(b)
print('backend: /api/spotify-status trae el recordatorio')
