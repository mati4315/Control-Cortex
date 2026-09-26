'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let theme = 'light';
  try { theme = localStorage.getItem('cortex-home-theme') === 'dark' ? 'dark' : 'light'; } catch { /* Preferencia opcional del navegador. */ }
  function setTheme(next) {
    theme = next === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('theme-toggle');
    if (button) {
      const dark = theme === 'dark';
      button.innerHTML = dark ? '☀ <span>Modo claro</span>' : '☾ <span>Modo oscuro</span>';
      button.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
      button.title = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
      button.setAttribute('aria-pressed', String(dark));
    }
    try { localStorage.setItem('cortex-home-theme', theme); } catch { /* La sesión actual mantiene el tema. */ }
  }
  setTheme(theme);
  let state, base = {}, services = [], view = 'home', busy = false, editorMode, editingId, noticeTimer, aiModelDirty = false, pendingChanges = [];
  const active = () => state.profiles.find(p => p.id === state.activeId);
  function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function notice(message, error = false) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false; if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 7000); }
  async function request(url, body) {
    const response = await fetch(url, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(url.endsWith('/assist') ? 65000 : 60000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Cortex no pudo completar la operación.'); return data;
  }
  async function mutate(type, body = {}, message = 'Guardado.') {
    if (busy) return;
    busy = true; $('profile').disabled = true;
    try { state = await request('/api/cortex-home/' + type, body); render(); notice(message); return true; }
    catch (error) { notice(error.message, true); return false; }
    finally { busy = false; $('profile').disabled = !state; }
  }
  function destination(raw) {
    try {
      const url = new URL(raw, location.origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = location.hostname;
      if (url.origin === location.origin && /^\/rulo-/.test(url.pathname) && base.sessionId) url.searchParams.set('session', base.sessionId);
      return url.href;
    } catch { return null; }
  }
  function button(text, fn, className) { const b = node('button', text, className); b.type = 'button'; b.onclick = fn; return b; }
  function confirmAction(title, text, callback) {
    $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('accept-confirm').onclick = () => { $('confirm').close(); callback(); }; $('confirm').showModal();
  }
  function switchView(next) {
    view = next;
    document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === next));
    ['home', 'profiles', 'assistant'].forEach(id => { $('view-' + id).hidden = id !== (next === 'favorites' ? 'home' : next); });
    $('breadcrumb').textContent = { home: 'Inicio', favorites: 'Favoritos', profiles: 'Perfiles y respaldos', assistant: 'Asistente IA' }[next];
    $('catalog-title').textContent = next === 'favorites' ? 'Siempre a mano' : 'Todos tus paneles';
    if (state) renderCards();
  }
  function renderCards() {
    const p = active(), all = [...state.modules, ...p.preferences.links];
    const search = $('search').value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const selected = $('category').value;
    const matches = all.filter(m => (!selected || m.category === selected) && (view !== 'favorites' || p.preferences.favorites.includes(m.id)) && `${m.name} ${m.category} ${m.description}`.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(search));
    matches.sort((a, b) => Number(p.preferences.favorites.includes(b.id)) - Number(p.preferences.favorites.includes(a.id)));
    $('cards').replaceChildren();
    for (const m of matches) {
      const card = node('article', undefined, 'card'), top = node('div', undefined, 'card-top');
      top.append(node('span', { Música: '♫', 'Bot y chat': '◌', 'En pantalla': '▣', Sistema: '⚙', Plugins: '◇' }[m.category] || '↗', 'icon'));
      const favorite = p.preferences.favorites.includes(m.id);
      const star = button(favorite ? '★' : '☆', () => mutate('preferences', { ...p.preferences, favorites: favorite ? p.preferences.favorites.filter(id => id !== m.id) : [...p.preferences.favorites, m.id] }, favorite ? 'Quitado de favoritos.' : 'Añadido a favoritos.'), 'star' + (favorite ? ' chosen' : ''));
      star.setAttribute('aria-label', (favorite ? 'Quitar de favoritos: ' : 'Añadir a favoritos: ') + m.name); star.setAttribute('aria-pressed', String(favorite)); top.append(star);
      card.append(top, node('h3', m.name), node('p', m.description || 'Tu acceso personalizado.'));
      const bottom = node('div', undefined, 'card-bottom');
      const service = services.find(s => s.id === m.serviceId);
      bottom.append(node('span', service ? (service.status === 'online' ? '● Activo' : '○ Detenido') : m.category));
      const href = destination(m.url);
      if (href) { const a = node('a', 'Abrir panel ↗'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', 'Abrir ' + m.name); bottom.append(a); }
      else bottom.append(node('span', 'Enlace no válido'));
      card.append(bottom);
      if (service) {
        const actions = node('div', undefined, 'service-actions');
        if (service.status !== 'online') actions.append(button('Iniciar', () => controlService(service, 'start'), 'service-start'));
        else actions.append(button('Reiniciar', () => confirmAction('Reiniciar ' + service.name, 'El servicio se desconectará brevemente de sus overlays mientras vuelve a iniciar.', () => controlService(service, 'restart'))));
        card.append(actions);
      }
      if (m.id.startsWith('custom-')) card.append(button('Eliminar acceso', () => confirmAction('Eliminar acceso', 'Se quitará este enlace del perfil actual.', () => mutate('preferences', { ...p.preferences, links: p.preferences.links.filter(x => x.id !== m.id), favorites: p.preferences.favorites.filter(id => id !== m.id) })), 'remove-link'));
      $('cards').append(card);
    }
    $('empty').hidden = matches.length > 0;
    $('module-count').textContent = all.length;
    $('favorite-count').textContent = all.filter(m => p.preferences.favorites.includes(m.id)).length;
    $('active-name').textContent = p.name;
  }
  function activate(id) {
    $('profile').value = state.activeId;
    const p = state.profiles.find(x => x.id === id); if (!p || id === state.activeId) return;
    confirmAction('Activar ' + p.name, 'Se guardarán los ajustes actuales y se aplicarán los de Spotify y todos los overlays compatibles, incluso los que estén detenidos. Los overlays apagados tomarán sus ajustes al iniciarse.', () => mutate('activate', { id }, 'Perfil activado. Se aplicaron los ajustes y se prepararon los servicios detenidos.'));
  }
  async function controlService(service, action) {
    try {
      await request('/api/services/' + encodeURIComponent(service.id) + '/' + action, {});
      notice(action === 'start' ? service.name + ' iniciado.' : service.name + ' reiniciado.');
      await refreshOverview();
    } catch (error) { notice('No se pudo ' + (action === 'start' ? 'iniciar' : 'reiniciar') + ' ' + service.name + ': ' + error.message, true); }
  }
  function applyOverview(data) {
    services = Array.isArray(data.services) ? data.services : [];
    const online = services.filter(service => service.status === 'online').length;
    $('health-services').textContent = `${online}/${services.length}`;
    $('health-spotify').textContent = data.spotifyConnected ? 'Conectado' : 'Sin cliente';
    $('health-obs').textContent = data.obsReachable === null ? 'Sin dato' : data.obsReachable ? 'Disponible' : 'Sin conexión';
    $('health-services').className = online === services.length && services.length ? 'health-good' : 'health-attention';
    $('health-spotify').className = data.spotifyConnected ? 'health-good' : 'health-attention';
    $('health-obs').className = data.obsReachable ? 'health-good' : 'health-attention';
    if (state) renderCards();
  }
  async function refreshOverview() {
    try { applyOverview(await request('/api/cortex-home/overview')); }
    catch { $('health-services').textContent = 'Sin datos'; $('health-spotify').textContent = 'Sin datos'; $('health-obs').textContent = 'Sin datos'; }
  }
  function download(data, filename) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = node('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function render() {
    const p = active(); $('profile').replaceChildren(...state.profiles.map(x => { const o = node('option', x.name); o.value = x.id; return o; })); $('profile').value = state.activeId;
    $('profile-hint').textContent = 'Organización y ajustes del estudio';
    const selected = $('category').value, categories = [...new Set([...state.modules, ...p.preferences.links].map(x => x.category))];
    $('category').replaceChildren(...['', ...categories].map(c => { const o = node('option', c || 'Todas las categorías'); o.value = c; return o; }));
    $('category').value = categories.includes(selected) ? selected : '';
    $('categories').replaceChildren(...['', ...categories].map(c => button(c || 'Todos', () => { $('category').value = c; render(); }, c === $('category').value ? 'selected' : '')));
    const providerInfo = state.ai.providers[state.ai.provider];
    $('ai-status').textContent = providerInfo.configured ? providerInfo.name + ' · ' + state.ai.model : 'La IA de Rulo necesita activarse o configurarse en Entrenamiento.';
    $('ai-key-status').textContent = state.ai.keyConfigured ? 'Clave ' + providerInfo.environmentKey + ' detectada en el entorno de Control Cortex.' : 'Falta ' + providerInfo.environmentKey + '. Añádela a Control Cortex/backend/.env y reinicia Cortex.';
    $('ai-key-status').classList.toggle('ai-key-missing', !state.ai.keyConfigured);
    if (!aiModelDirty) { $('ai-provider').value = state.ai.provider; $('ai-model').value = state.ai.model; }
    updateModelHint();
    if (state.context) $('context-status').textContent = state.context.files + ' documentos · ' + state.context.routes + ' rutas y ' + state.context.schemas + ' esquemas indexados · actualizado ' + new Date(state.context.updatedAt).toLocaleString('es');
    $('profiles').replaceChildren();
    state.profiles.forEach(profile => {
      const row = node('article', undefined, 'profile-row'), details = node('div', undefined, 'details'), title = node('h3', profile.name);
      if (profile.id === state.activeId) title.append(node('span', 'EN USO', 'badge'));
      details.append(title, node('small', 'Último respaldo: ' + new Date(profile.savedAt).toLocaleString('es')));
      const actions = node('div', undefined, 'profile-actions');
      if (profile.id !== state.activeId) actions.append(button('Activar', () => activate(profile.id), 'primary'));
      actions.append(button('Exportar', async () => { try { download(await request('/api/cortex-home/export/' + encodeURIComponent(profile.id)), 'Cortex-' + profile.name.replace(/[^a-z0-9áéíóúñ_-]/gi, '-') + '.json'); notice('Respaldo exportado.'); } catch (e) { notice(e.message, true); } }));
      actions.append(button('Renombrar', () => openEditor('rename', profile)));
      if (profile.id !== state.activeId && profile.id !== 'default') actions.append(button('Eliminar', () => confirmAction('Eliminar perfil', 'Se eliminará «' + profile.name + '». Exporta un respaldo si quieres conservarlo.', () => mutate('delete', { id: profile.id }))));
      row.append(details, actions); $('profiles').append(row);
    }); renderCards();
  }
  function openEditor(mode, profile) {
    if (!state) return;
    editorMode = mode; editingId = profile?.id; $('editor-form').reset();
    $('editor-title').textContent = { link: 'Nuevo acceso', create: 'Crear perfil desde los ajustes actuales', rename: 'Renombrar perfil' }[mode];
    $('link-fields').hidden = mode !== 'link'; $('editor-form').elements.url.required = mode === 'link';
    if (profile) $('editor-form').elements.name.value = profile.name; $('editor').showModal();
  }
  document.querySelectorAll('.nav').forEach(b => { b.onclick = () => switchView(b.dataset.view); });
  $('search').oninput = () => state && renderCards(); $('category').onchange = () => state && render(); $('profile').onchange = () => activate($('profile').value);
  $('theme-toggle').onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  $('cancel-confirm').onclick = () => $('confirm').close(); $('close-editor').onclick = () => $('editor').close();
  $('add-link').onclick = () => openEditor('link'); $('new-profile').onclick = () => openEditor('create');
  $('save-profile').onclick = () => state && mutate('save', {}, 'Ajustes actuales guardados en ' + active().name + '.');
  $('editor-form').onsubmit = async event => {
    event.preventDefault(); const fields = Object.fromEntries(new FormData(event.target)); let ok;
    if (editorMode === 'link') {
      if (!destination(fields.url)) { notice('Usa una dirección HTTP, HTTPS o una ruta de Cortex.', true); return; }
      const p = active(); ok = await mutate('preferences', { ...p.preferences, links: [...p.preferences.links, { id: 'custom-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)), name: fields.name, url: fields.url, category: fields.category || 'Mis accesos' }] }, 'Acceso añadido.');
    } else ok = await mutate(editorMode, { name: fields.name, id: editingId }, editorMode === 'create' ? 'Perfil creado. Actívalo desde Perfiles y respaldos.' : 'Nombre actualizado.');
    if (ok) $('editor').close();
  };
  $('import-profile').onclick = () => state && $('import-file').click();
  $('import-file').onchange = async () => {
    const file = $('import-file').files[0]; if (!file) return;
    try { if (file.size > 1000000) throw new Error('El respaldo supera el máximo de 1 MB.'); const data = JSON.parse(await file.text()); await mutate('import', data, 'Respaldo importado como otro perfil. Puedes revisarlo y activarlo cuando quieras.'); }
    catch (e) { notice('No se pudo importar: ' + e.message, true); } finally { $('import-file').value = ''; }
  };
  document.querySelectorAll('[data-question]').forEach(b => { b.onclick = () => { $('question').value = b.dataset.question; $('question').focus(); }; });
  $('ask-form').onsubmit = async event => {
    event.preventDefault(); $('ask').disabled = true; $('ask').textContent = 'Pensando…';
    try {
      const data = await request('/api/cortex-home/assist', { question: $('question').value });
      $('answer').textContent = data.answer; pendingChanges = data.overlayChanges || []; renderOverlayChanges(); $('answer-wrap').hidden = false;
    }
    catch (e) { notice(e.message, true); } finally { $('ask').disabled = false; $('ask').textContent = 'Consultar al asistente ↗'; }
  };
  function renderOverlayChanges() {
    const box = $('overlay-changes'); box.replaceChildren(); box.hidden = pendingChanges.length === 0;
    if (!pendingChanges.length) return;
    box.append(node('h3', 'Cambios sugeridos para revisar'));
    const labels = { rulo: 'Rulo · Apariencia', unified: 'Overlay unificado', lights: 'Luces de Fiesta', weather: 'Clima y Tiempo', comments: 'Ruleta de Comentarios', welcome: 'Bienvenidas y Banner' };
    for (const change of pendingChanges) {
      const row = node('div', undefined, 'overlay-change');
      row.append(node('strong', (labels[change.overlayId] || change.overlayId) + ' · ' + change.path));
      const values = node('div', undefined, 'change-values');
      values.append(node('span', 'Actual: ' + JSON.stringify(change.before)), node('span', 'Propuesto: ' + JSON.stringify(change.value)));
      row.append(values); box.append(row);
    }
    box.append(button('Aplicar cambios revisados', () => confirmAction('Aplicar cambios de overlays', 'Se aplicarán ' + pendingChanges.length + ' cambios a los overlays seleccionados. Esta acción se guardará en su configuración y actualizará sus vistas en vivo.', async () => {
      try { const result = await request('/api/cortex-home/overlay-apply', { changes: pendingChanges }); pendingChanges = []; renderOverlayChanges(); notice('Se aplicaron ' + result.changes.length + ' cambios.'); if (!$('assistant-history-list').hidden) await loadAssistantHistory(); }
      catch (error) { notice(error.message, true); }
    }), 'primary'));
  }
  $('refresh-context').onclick = async () => {
    const button = $('refresh-context'); button.disabled = true; button.textContent = 'Actualizando…';
    try { const result = await request('/api/cortex-home/context-refresh', {}); $('context-status').textContent = result.files + ' documentos · ' + result.routes + ' rutas y ' + result.schemas + ' esquemas indexados · actualizado ' + new Date(result.updatedAt).toLocaleString('es'); notice('Contexto del proyecto actualizado.'); }
    catch (error) { notice(error.message, true); }
    finally { button.disabled = false; button.textContent = 'Actualizar contexto'; }
  };
  $('load-overlay-list').onclick = async () => {
    const button = $('load-overlay-list'), box = $('overlay-inventory'); button.disabled = true; button.textContent = 'Cargando…';
    try {
      const data = await request('/api/cortex-home/overlay-catalog'); box.replaceChildren();
      for (const overlay of data.overlays || []) {
        const details = document.createElement('details'), summary = document.createElement('summary');
        summary.append(document.createTextNode(overlay.name + ' '));
        const status = node('span', overlay.available ? `· disponible · ${overlay.fields.length} parámetros` : '· servicio apagado', overlay.available ? '' : 'overlay-offline'); summary.append(status);
        details.append(summary, node('code', overlay.route, 'overlay-route'));
        if (overlay.available) {
          const fields = node('div', undefined, 'overlay-fields');
          for (const field of overlay.fields) fields.append(node('code', `${field.path} = ${JSON.stringify(field.value)}`));
          details.append(fields);
        } else details.append(node('p', 'Inicia este servicio desde Control de servicios para consultar y cambiar sus parámetros.'));
        box.append(details);
      }
      box.hidden = false; button.textContent = 'Actualizar listado';
    } catch (error) { notice('No se pudo cargar el listado: ' + error.message, true); }
    finally { button.disabled = false; }
  };
  async function loadAssistantHistory() {
    const box = $('assistant-history-list');
    try {
      const data = await request('/api/cortex-home/assistant-history'); box.replaceChildren();
      if (!data.history?.length) box.append(node('p', 'Todavía no hay cambios aplicados desde el asistente.', 'history-state'));
      for (const entry of data.history || []) {
        const row = node('article', undefined, 'assistant-history-row'), summary = node('div');
        summary.append(node('strong', new Date(entry.appliedAt).toLocaleString('es') + ' · ' + entry.changes.length + ' cambios'));
        const names = [...new Set(entry.changes.map(change => change.overlay))];
        summary.append(node('p', names.join(', ') + ' · ' + entry.changes.map(change => change.path).join(', ')));
        row.append(summary);
        if (entry.undoneAt) row.append(node('span', 'Deshecho el ' + new Date(entry.undoneAt).toLocaleString('es'), 'history-state'));
        else row.append(button('Deshacer', () => confirmAction('Deshacer cambios', 'Se intentarán restaurar los valores anteriores. Solo se deshará si los parámetros siguen como quedaron tras esta propuesta.', async () => {
          try { await request('/api/cortex-home/assistant-undo', { id: entry.id }); await loadAssistantHistory(); notice('Cambios deshechos.'); }
          catch (error) { notice(error.message, true); }
        })));
        box.append(row);
      }
    } catch (error) { notice('No se pudo cargar el historial: ' + error.message, true); }
  }
  $('toggle-history').onclick = async () => {
    const box = $('assistant-history-list'); box.hidden = !box.hidden;
    if (!box.hidden) { $('toggle-history').textContent = 'Actualizar historial'; await loadAssistantHistory(); }
    else $('toggle-history').textContent = 'Ver historial';
  };
  $('ai-model').addEventListener('input', () => { aiModelDirty = true; updateModelHint(); });
  $('ai-config-form').onsubmit = async event => {
    event.preventDefault();
    const save = $('save-ai-model'); save.disabled = true; save.textContent = 'Guardando…';
    try {
      const result = await request('/api/cortex-home/ai-config', { provider: $('ai-provider').value, model: $('ai-model').value });
      state.ai = result.assistant; aiModelDirty = false; render(); notice('Proveedor y modelo guardados para el Asistente IA.');
    } catch (error) { notice(error.message, true); }
    finally { save.disabled = false; save.textContent = 'Guardar modelo'; }
  };
  function updateModelHint() {
    const provider = $('ai-provider').value;
    if (state?.ai?.providers?.[provider]) {
      const info = state.ai.providers[provider];
      $('ai-status').textContent = info.configured ? info.name + ' · ' + $('ai-model').value : 'La IA de Rulo necesita activarse o configurarse en Entrenamiento.';
      $('ai-key-status').textContent = info.keyConfigured ? 'Clave ' + info.environmentKey + ' detectada en el entorno de Control Cortex.' : 'Falta ' + info.environmentKey + '. Añádela a Control Cortex/backend/.env y reinicia Cortex.';
      $('ai-key-status').classList.toggle('ai-key-missing', !info.keyConfigured);
    }
    $('ai-model-hint').textContent = provider === 'openai'
      ? 'GPT-5.4 nano: USD 0,20 por millón de tokens de entrada y USD 1,25 de salida a tarifa estándar.'
      : provider === 'gemini'
        ? 'Gemini 3.6 Flash: USD 0,75 por millón de tokens de entrada y USD 4,50 de salida a tarifa estándar.'
        : 'Usa el proveedor y el modelo que ya tienes configurado para Rulo.';
  }
  $('ai-provider').addEventListener('change', () => {
    if (state) $('ai-model').value = state.ai.providers[$('ai-provider').value].defaultModel;
    aiModelDirty = true; updateModelHint();
  });
  $('copy-answer').onclick = async () => { try { await navigator.clipboard.writeText($('answer').textContent); notice('Respuesta copiada.'); } catch { notice('Selecciona la respuesta y cópiala con Ctrl+C.', true); } };
  async function load() {
    try { state = await request('/api/cortex-home'); render(); $('profile').disabled = false; $('connection').textContent = 'Cortex conectado'; }
    catch (e) { $('connection').textContent = 'Sin conexión'; notice('No se pudo cargar Inicio. Comprueba que Cortex esté iniciado y recarga la página. ' + e.message, true); }
    const results = await Promise.allSettled([request('/api/cortex-base-url'), request('/api/cortex-home/overview')]);
    if (results[0].status === 'fulfilled') base = results[0].value;
    if (results[1].status === 'fulfilled') applyOverview(results[1].value);
    else if (state) renderCards();
  }
  load();
  setInterval(async () => {
    if (document.hidden || busy || !state) return;
    try { const latest = await request('/api/cortex-home'); state = latest; render(); $('connection').textContent = 'Cortex conectado';
      await refreshOverview();
    }
    catch { $('connection').textContent = 'Sin conexión'; }
  }, 20000);
})();
