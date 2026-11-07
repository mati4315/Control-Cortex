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
  let state, base = {}, services = [], view = 'home', busy = false, obsPollBusy = false, editorMode, editingId, noticeTimer, aiModelDirty = false, pendingChanges = [], preflightStartedAt = 0, prepareProgressPollTimer = 0, prepareProgressPollActive = false, prepareProgressLastValue = 0, preflightButtonState = 'initial';
  const overviewRequests = new Map();
  let overviewLastUpdatedAt = 0, servicesAreStale = false;
  let triggerStudioConnection = { ip: '', mode: 'tailscale', profiles: {}, configured: false, passwordConfigured: false }, triggerStudioDraftMode = null, triggerStudioDraftProfiles = null, triggerStudioFeedback = '', triggerStudioFeedbackOk = false;
  const active = () => state.profiles.find(p => p.id === state.activeId);
  function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function notice(message, error = false) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false; if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 7000); }
  const preflightCard = document.querySelector('.preflight-card');
  const preflightAdvanced = document.createElement('details');
  preflightAdvanced.className = 'preflight-advanced';
  preflightAdvanced.append(node('summary', 'Confirmaciones manuales, escena, fuentes e historial'));
  const preflightManualPanel = preflightCard?.querySelector('.preflight-manual');
  const preflightHistoryPanel = preflightCard?.querySelector('.preflight-history');
  if (preflightManualPanel) { preflightManualPanel.before(preflightAdvanced); preflightAdvanced.append(preflightManualPanel); }
  if (preflightHistoryPanel) preflightAdvanced.append(preflightHistoryPanel);
  const prepareProgressPanel = node('div', undefined, 'preflight-progress');
  prepareProgressPanel.id = 'preflight-progress';
  prepareProgressPanel.hidden = true;
  const prepareProgressHeading = node('strong', 'Preparando módulos…');
  const prepareProgressEta = node('span', 'Calculando tiempo restante…');
  const prepareProgressTrack = node('div', undefined, 'preflight-progress-track');
  prepareProgressTrack.setAttribute('role', 'progressbar');
  prepareProgressTrack.setAttribute('aria-label', 'Progreso de preparación del directo');
  prepareProgressTrack.setAttribute('aria-valuemin', '0');
  prepareProgressTrack.setAttribute('aria-valuemax', '100');
  const prepareProgressFill = node('span', undefined, 'preflight-progress-fill');
  prepareProgressTrack.append(prepareProgressFill);
  const prepareProgressDetail = node('small', '');
  prepareProgressPanel.append(prepareProgressHeading, prepareProgressTrack, prepareProgressEta, prepareProgressDetail);
  $('readiness-detail')?.after(prepareProgressPanel);
  preflightCard?.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const label = target.closest('label');
    if (!label || !preflightCard.contains(label)) return;
    if (label.classList.contains('global-test-toggle') || label.classList.contains('power-row')) return;
    const checkbox = label.querySelector('input[type="checkbox"]');
    if (checkbox && target !== checkbox) event.preventDefault();
  });
  async function request(url, body) {
    const timeoutMs = url.endsWith('/api/cortex-home/prepare-status') ? 5000 : url.endsWith('/api/cortex-home/prepare') ? 90000 : url.endsWith('/assist') ? 65000 : 60000;
    let response;
    try { response = await fetch(url, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (cause) {
      const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
      const error = new Error(timedOut ? 'Cortex tardó demasiado en responder. Comprueba que siga iniciado y vuelve a intentar.' : `No se pudo conectar con Cortex en ${location.host}. Comprueba que el backend esté iniciado y vuelve a intentar.`);
      error.cause = cause; error.code = timedOut ? 'CORTEX_TIMEOUT' : 'CORTEX_OFFLINE'; throw error;
    }
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) { const error = new Error(data.error || `Cortex respondió con error (${response.status}).`); error.data = data; error.status = response.status; throw error; } return data;
  }
  function renderPrepareProgress(data, { keepProgress = true } = {}) {
    if (!data) return;
    prepareProgressPanel.hidden = false;
    const reportedProgress = Math.max(0, Math.min(100, Number(data.progress) || 0));
    prepareProgressLastValue = keepProgress ? Math.max(prepareProgressLastValue, reportedProgress) : reportedProgress;
    prepareProgressFill.style.width = prepareProgressLastValue + '%';
    prepareProgressTrack.setAttribute('aria-valuenow', String(prepareProgressLastValue));
    prepareProgressPanel.classList.toggle('is-running', data.running === true);
    prepareProgressPanel.classList.toggle('is-complete', ['complete', 'complete-with-issues'].includes(data.phase));
    prepareProgressPanel.classList.toggle('has-issues', data.phase === 'complete-with-issues' || data.phase === 'failed');
    prepareProgressHeading.textContent = data.message || 'Preparando módulos…';
    if (data.phase === 'review' && Number(data.remainingSeconds) > 0) prepareProgressEta.textContent = `Tiempo para esta comprobación: ~${data.remainingSeconds} s · ${Math.round(prepareProgressLastValue)}%`;
    else if (data.phase === 'review') prepareProgressEta.textContent = `Comprobando conexiones y los requisitos del directo… ${Math.round(prepareProgressLastValue)}%`;
    else if (data.running && Number(data.remainingSeconds) > 0) {
      const seconds = Number(data.remainingSeconds), estimate = seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
      prepareProgressEta.textContent = `Tiempo restante estimado: ~${estimate} · ${Math.round(prepareProgressLastValue)}%`;
    } else if (data.running) prepareProgressEta.textContent = 'Calculando el tiempo restante…';
    else if (data.startedAt) {
      const elapsed = Math.max(0, Math.round(((Number(data.finishedAt) || Date.now()) - Number(data.startedAt)) / 1000));
      prepareProgressEta.textContent = `Proceso terminado en ${elapsed} s · 100%.`;
    } else prepareProgressEta.textContent = '';
    const total = Math.max(0, Number(data.total) || 0), completed = Math.max(0, Number(data.completed) || 0);
    prepareProgressDetail.textContent = total ? `${Math.min(completed, total)} de ${total} pasos terminados${data.currentIndex && data.running ? ` · paso ${data.currentIndex}` : ''}.` : 'Verificando la preparación del directo.';
  }
  function stopPrepareProgressPolling() { prepareProgressPollActive = false; clearTimeout(prepareProgressPollTimer); prepareProgressPollTimer = 0; }
  function startPrepareProgressPolling() {
    stopPrepareProgressPolling();
    prepareProgressPollActive = true;
    const poll = async () => {
      if (!prepareProgressPollActive) return;
      try {
        const data = await request('/api/cortex-home/prepare-status');
        if (data.phase !== 'idle') renderPrepareProgress(data);
        if (data.running || data.phase === 'idle') prepareProgressPollTimer = setTimeout(poll, 700);
        else stopPrepareProgressPolling();
      } catch { if (prepareProgressPollActive) prepareProgressPollTimer = setTimeout(poll, 1200); }
    };
    prepareProgressPollTimer = setTimeout(poll, 250);
  }
  function setIdlePreflightButton() {
    const button = $('preflight-run');
    button.disabled = false;
    button.textContent = preflightButtonState === 'prepared' ? '✓ Directo listo · revisar' : preflightButtonState === 'review' ? 'Revisar / preparar de nuevo' : preflightButtonState === 'retry' ? 'Reintentar módulos' : 'Iniciar módulos y revisar';
  }
  let globalTestModeAvailable = false;
  function renderGlobalTestMode(data) {
    const checkbox = $('global-test-mode'), status = $('global-test-mode-status');
    if (!checkbox || !status) return;
    globalTestModeAvailable = true;
    checkbox.checked = data.enabled === true;
    checkbox.disabled = false;
    const chatBot = data.modules?.chatBot || {};
    const roulette = data.modules?.roulette || {};
    const pending = [chatBot.restartRequired ? 'Chat Bot Spotify' : '', roulette.restartRequired ? 'Comentarios / Ruleta' : ''].filter(Boolean);
    if (pending.length) {
      status.textContent = `Cambio guardado; enciende o reinicia ${pending.join(' y ')} para confirmar el aislamiento.`;
    } else if (data.enabled) {
      status.textContent = 'Pruebas visibles solo en memoria temporal; no entran al historial, audiencia, ruleta real ni Spotify.';
    } else {
      status.textContent = 'Modo de pruebas desactivado en Spotify y los capturadores de comentarios.';
    }
  }
  async function loadGlobalTestMode() {
    const checkbox = $('global-test-mode'), status = $('global-test-mode-status');
    if (!checkbox || !status) return;
    try { renderGlobalTestMode(await request('/api/test-mode')); }
    catch {
      globalTestModeAvailable = false;
      checkbox.disabled = true;
      status.textContent = 'Reinicia Cortex para habilitar el control global.';
    }
  }
  function renderSpotifyAiPriority(data) {
    const checkbox = $('spotify-ai-priority'), status = $('spotify-ai-priority-status');
    if (!checkbox || !status) return;
    const vocabulary = data?.vocabulary || data || {};
    const ai = vocabulary.ai && typeof vocabulary.ai === 'object' ? vocabulary.ai : {};
    checkbox.checked = ai.onlyWhenNotUnderstood === false;
    checkbox.disabled = false;
    if (!checkbox.checked) {
      status.textContent = 'El parser normal interpreta primero; la IA queda como respaldo.';
    } else if (ai.enabled !== true) {
      status.textContent = 'Prioridad activada, pero la IA está apagada. Actívala en Entrenamiento.';
    } else if (data?.aiKeyPresent === false) {
      status.textContent = 'Prioridad activada, pero falta SPOTIFY_AI_API_KEY en Control Cortex/backend/.env.';
    } else {
      status.textContent = 'La IA interpreta primero; el parser normal queda como respaldo.';
    }
  }
  async function loadSpotifyAiPriority() {
    const checkbox = $('spotify-ai-priority'), status = $('spotify-ai-priority-status');
    if (!checkbox || !status) return;
    try { renderSpotifyAiPriority(await request('/api/spotify-vocabulary')); }
    catch {
      checkbox.disabled = true;
      status.textContent = 'No se pudo leer la preferencia de IA. Recarga Cortex.';
    }
  }
  function renderSpotifyAiReplyOptions(data) {
    const aiReplies = $('spotify-ai-replies'), casualChat = $('spotify-casual-chat');
    const aiRepliesStatus = $('spotify-ai-replies-status'), casualChatStatus = $('spotify-casual-chat-status');
    if (!aiReplies || !casualChat || !aiRepliesStatus || !casualChatStatus) return;
    const vocabulary = data?.vocabulary || data || {};
    const responses = vocabulary.responses && typeof vocabulary.responses === 'object' ? vocabulary.responses : {};
    const ai = vocabulary.ai && typeof vocabulary.ai === 'object' ? vocabulary.ai : {};
    aiReplies.checked = responses.aiRepliesEnabled !== false;
    casualChat.checked = responses.casualChatEnabled === true;
    aiReplies.disabled = false;
    casualChat.disabled = false;
    if (!aiReplies.checked) {
      aiRepliesStatus.textContent = 'Usa las respuestas normales guardadas para los pedidos del bot.';
    } else if (ai.enabled !== true || data?.aiKeyPresent === false) {
      aiRepliesStatus.textContent = 'Preferencia guardada; si falta activar/configurar la IA, el bot recurrirá a sus respuestas normales.';
    } else {
      aiRepliesStatus.textContent = 'Respuestas originales con IA en pedidos; las respuestas normales quedan como respaldo.';
    }
    if (!casualChat.checked) {
      casualChatStatus.textContent = 'Rulo no iniciará conversaciones casuales sobre comentarios.';
    } else if (ai.enabled !== true || data?.aiKeyPresent === false) {
      casualChatStatus.textContent = 'Activado; requiere que la IA esté encendida y tenga una clave configurada.';
    } else {
      casualChatStatus.textContent = 'Activado; Rulo podrá responder ocasionalmente a comentarios interesantes.';
    }
  }
  async function loadSpotifyAiReplyOptions() {
    const aiReplies = $('spotify-ai-replies'), casualChat = $('spotify-casual-chat');
    const aiRepliesStatus = $('spotify-ai-replies-status'), casualChatStatus = $('spotify-casual-chat-status');
    if (!aiReplies || !casualChat || !aiRepliesStatus || !casualChatStatus) return;
    try { renderSpotifyAiReplyOptions(await request('/api/spotify-vocabulary')); }
    catch {
      aiReplies.disabled = true;
      casualChat.disabled = true;
      aiRepliesStatus.textContent = 'No se pudo leer la configuración compartida. Recarga Cortex.';
      casualChatStatus.textContent = 'No se pudo leer la configuración compartida. Recarga Cortex.';
    }
  }
  async function saveSpotifyAiReplyOption(event) {
    const changedCheckbox = event.currentTarget;
    const key = changedCheckbox.id === 'spotify-ai-replies' ? 'aiRepliesEnabled' : 'casualChatEnabled';
    const previous = !changedCheckbox.checked;
    const aiReplies = $('spotify-ai-replies'), casualChat = $('spotify-casual-chat');
    const aiRepliesStatus = $('spotify-ai-replies-status'), casualChatStatus = $('spotify-casual-chat-status');
    aiReplies.disabled = true;
    casualChat.disabled = true;
    aiRepliesStatus.textContent = 'Guardando las opciones compartidas de Rulo…';
    casualChatStatus.textContent = 'Guardando las opciones compartidas de Rulo…';
    try {
      const current = await request('/api/spotify-vocabulary');
      const vocabulary = current?.vocabulary || current || {};
      const responses = vocabulary.responses && typeof vocabulary.responses === 'object' ? vocabulary.responses : {};
      const data = await request('/api/spotify-vocabulary', {
        vocabulary: { responses: { ...responses, [key]: changedCheckbox.checked } }
      });
      renderSpotifyAiReplyOptions(data);
      notice(key === 'aiRepliesEnabled'
        ? (changedCheckbox.checked ? 'Rulo responderá los pedidos del bot con IA cuando esté disponible.' : 'Rulo usará las respuestas normales guardadas para los pedidos.')
        : (changedCheckbox.checked ? 'Rulo podrá conversar ocasionalmente sobre comentarios interesantes.' : 'Conversación casual de Rulo desactivada.'));
    } catch (error) {
      changedCheckbox.checked = previous;
      aiReplies.disabled = false;
      casualChat.disabled = false;
      aiRepliesStatus.textContent = error.message;
      casualChatStatus.textContent = error.message;
      notice('No se pudieron guardar las opciones de respuestas de Rulo: ' + error.message, true);
    }
  }
  $('spotify-ai-replies')?.addEventListener('change', saveSpotifyAiReplyOption);
  $('spotify-casual-chat')?.addEventListener('change', saveSpotifyAiReplyOption);
  $('spotify-ai-priority')?.addEventListener('change', async event => {
    const checkbox = event.currentTarget, status = $('spotify-ai-priority-status');
    const previous = !checkbox.checked, prioritizeAi = checkbox.checked;
    checkbox.disabled = true;
    status.textContent = 'Guardando la preferencia compartida…';
    try {
      const data = await request('/api/spotify-vocabulary', {
        vocabulary: { ai: { onlyWhenNotUnderstood: !prioritizeAi } }
      });
      renderSpotifyAiPriority(data);
      notice(prioritizeAi ? 'Rulo priorizará la IA al interpretar pedidos musicales.' : 'Rulo priorizará el parser normal; la IA quedará como respaldo.');
    } catch (error) {
      checkbox.checked = previous;
      checkbox.disabled = false;
      status.textContent = error.message;
      notice('No se pudo guardar la prioridad de IA: ' + error.message, true);
    }
  });
  $('global-test-mode').addEventListener('change', async event => {
    const checkbox = event.currentTarget, previous = !checkbox.checked;
    checkbox.disabled = true;
    $('global-test-mode-status').textContent = 'Guardando el modo compartido…';
    try {
      renderGlobalTestMode(await request('/api/test-mode', { enabled: checkbox.checked }));
      notice(checkbox.checked ? 'Modo de pruebas activado para Spotify, Chat Bot Spotify y la Ruleta.' : 'Modo de pruebas desactivado.');
      if (!$('preflight-results').hidden) runPreflight(false);
    } catch (error) {
      checkbox.checked = previous;
      checkbox.disabled = !globalTestModeAvailable;
      $('global-test-mode-status').textContent = error.message;
      notice(error.message, true);
    }
  });
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
    const visibleView = next === 'favorites' ? 'home' : next;
    document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== 'view-' + visibleView; });
    $('breadcrumb').textContent = { home: 'Inicio', rulo: 'Rulo y Spotify', databases: 'Bases de datos', favorites: 'Favoritos', profiles: 'Perfiles y respaldos', assistant: 'Asistente IA' }[next];
    $('catalog-title').textContent = next === 'favorites' ? 'Siempre a mano' : 'Todos tus paneles';
    if (state) renderCards();
    if (next === 'profiles') loadRuloDataBackups();
    if (next === 'databases') loadDatabaseTab(activeDatabaseTab);
  }
  const ruloSettingsGrid = $('rulo-settings-grid');
  if (ruloSettingsGrid) {
    const aiPriority = $('spotify-ai-priority')?.closest('.global-test-toggle');
    const aiReplies = $('spotify-ai-replies')?.closest('.global-ai-replies-card');
    if (aiPriority) ruloSettingsGrid.append(aiPriority);
    if (aiReplies) ruloSettingsGrid.append(aiReplies);
  }
  let activeDatabaseTab = 'audience', audienceDbOffset = 0, audienceDbHasMore = false, audienceDbLoaded = false, sqliteTableList = null, lotteryDbLoaded = false, audienceSearchTimer = 0;
  function formatDatabaseValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }
  function appendDatabaseFields(container, data) {
    const list = node('dl', undefined, 'database-fields');
    for (const [key, value] of Object.entries(data || {})) {
      const term = node('dt', key), detail = node('dd');
      const photo = /^(avatar|profile.?pic|photo|picture|image).*(url)?$/i.test(key) && typeof value === 'string' && /^https?:\/\//i.test(value);
      if (photo) {
        const image = document.createElement('img'); image.src = value; image.alt = 'Foto de perfil'; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; detail.append(image);
        detail.append(node('a', 'Abrir imagen', 'database-image-link')); detail.lastChild.href = value; detail.lastChild.target = '_blank'; detail.lastChild.rel = 'noopener noreferrer';
      }
      const textValue = formatDatabaseValue(value);
      if (!photo || !/^(avatar|profile.?pic|photo|picture|image).*(url)?$/i.test(key)) detail.append(node('code', textValue));
      list.append(term, detail);
    }
    container.append(list);
  }
  function renderAudienceDatabase(items, columns) {
    const box = $('db-audience-records');
    if (!items.length) { box.replaceChildren(node('p', 'No se encontraron registros con ese filtro.', 'database-empty')); return; }
    box.replaceChildren(...items.map(record => {
      const title = [record.requester || record.name || record.display_name || record.track_name || record.title || record.user_id || record.id || 'Registro', record.platform || record.event || record.status || ''].filter(Boolean).join(' · ');
      const rawDate = record.ts ?? record.timestamp ?? record.created_at ?? record.createdAt ?? record.program_date;
      const when = typeof rawDate === 'number' ? new Date(rawDate).toLocaleString('es') : rawDate ? String(rawDate) : '';
      const row = node('details', undefined, 'database-record'), summary = node('summary');
      summary.append(node('strong', title), node('span', when));
      const preview = record.comment || record.artist || record.uri || record.path;
      if (preview) summary.append(node('p', preview));
      appendDatabaseFields(row, Object.fromEntries((columns || Object.keys(record)).map(column => [column, record[column]])));
      row.prepend(summary);
      return row;
    }));
  }
  async function loadSqliteTables() {
    const result = await request('/api/cortex-home/database/sqlite/tables');
    sqliteTableList = result.tables || [];
    $('db-sqlite-table').replaceChildren(...sqliteTableList.map(table => new Option(`${table.name} · ${table.total}`, table.name)));
    if (!sqliteTableList.length) $('db-sqlite-table').replaceChildren(new Option('No hay tablas disponibles', ''));
    if (!sqliteTableList.some(table => table.name === $('db-sqlite-table').value)) $('db-sqlite-table').value = sqliteTableList[0]?.name || '';
  }
  async function loadAudienceDatabase() {
    const status = $('db-audience-status'), box = $('db-audience-records');
    status.textContent = 'Consultando SQLite…';
    $('db-audience-prev').disabled = true; $('db-audience-next').disabled = true;
    try {
      if (!sqliteTableList) await loadSqliteTables();
      const table = $('db-sqlite-table').value;
      if (!table) { box.replaceChildren(node('p', 'No hay tablas para mostrar.', 'database-empty')); return; }
      const params = new URLSearchParams({ table, limit: '50', offset: String(audienceDbOffset) });
      const search = $('db-audience-search').value.trim(); if (search) params.set('search', search);
      const result = await request('/api/cortex-home/database/sqlite/rows?' + params.toString());
      renderAudienceDatabase(result.rows || [], result.columns || []);
      audienceDbHasMore = audienceDbOffset + (result.rows || []).length < Number(result.total || 0); audienceDbLoaded = true;
      const count = (result.rows || []).length, first = count ? audienceDbOffset + 1 : 0, last = audienceDbOffset + count;
      status.textContent = `${result.table} · ${result.total} filas · ${count ? `mostrando ${first}–${last}` : 'sin registros'}${search ? ' · filtro aplicado' : ''}`;
      $('db-audience-page').textContent = `Página ${Math.floor(audienceDbOffset / 50) + 1}`;
      $('db-audience-prev').disabled = audienceDbOffset === 0;
      $('db-audience-next').disabled = !audienceDbHasMore;
    } catch (error) { status.textContent = error.message; box.replaceChildren(node('p', 'No se pudo leer la base de audiencia.', 'database-empty')); }
  }
  function renderLotteryDatabase(lotteries) {
    const box = $('db-lottery-records');
    if (!lotteries.length) { box.replaceChildren(node('p', 'Firestore no devolvió documentos de lotería.', 'database-empty')); return; }
    box.replaceChildren(...lotteries.map(lottery => {
      const wrapper = node('section', undefined, 'database-lottery');
      const heading = node('details', undefined, 'database-record'), summary = node('summary');
      summary.append(node('strong', lottery.data?.name || lottery.name || lottery.id), node('span', `${(lottery.entries || []).length} entradas · ID ${lottery.id}`));
      appendDatabaseFields(heading, { id: lottery.id, ...(lottery.data || {}) }); heading.prepend(summary); wrapper.append(heading);
      const entriesTitle = node('h3', `Entradas (${(lottery.entries || []).length})`); wrapper.append(entriesTitle);
      for (const entry of lottery.entries || []) {
        const row = node('details', undefined, 'database-record database-entry'), entrySummary = node('summary'), data = entry.data || {};
        const participant = data.name || data.requester || data.displayName || 'Participante';
        const number = data.selectedNumber ?? data.number ?? data.selected_number;
        entrySummary.append(node('strong', number === undefined ? participant : `N.º ${number} · ${participant}`), node('span', `ID ${entry.id}`));
        appendDatabaseFields(row, { id: entry.id, ...data }); row.prepend(entrySummary); wrapper.append(row);
      }
      return wrapper;
    }));
  }
  async function loadLotteryDatabase() {
    const status = $('db-lottery-status'), box = $('db-lottery-records'); status.textContent = 'Consultando Cloud Firestore…';
    try {
      const result = await request('/api/cortex-home/database/lottery');
      renderLotteryDatabase(result.lotteries || []); lotteryDbLoaded = true;
      const entries = (result.lotteries || []).reduce((sum, lottery) => sum + (lottery.entries || []).length, 0);
      status.textContent = `${result.database} · proyecto ${result.projectId} · ${result.count} loterías · ${entries} entradas`;
    } catch (error) { status.textContent = error.message; box.replaceChildren(node('p', 'No se pudo leer Firestore.', 'database-empty')); }
  }
  function loadDatabaseTab(tab) {
    activeDatabaseTab = tab === 'lottery' ? 'lottery' : 'audience';
    if (activeDatabaseTab === 'audience') { if (!audienceDbLoaded) loadAudienceDatabase(); }
    else if (!lotteryDbLoaded) loadLotteryDatabase();
  }
  document.querySelectorAll('[data-db-tab]').forEach(button => {
    button.onclick = () => {
      activeDatabaseTab = button.dataset.dbTab;
      document.querySelectorAll('[data-db-tab]').forEach(tab => { const selected = tab === button; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); });
      document.querySelectorAll('[data-db-panel]').forEach(panel => { panel.hidden = panel.dataset.dbPanel !== activeDatabaseTab; });
      loadDatabaseTab(activeDatabaseTab);
    };
  });
  $('db-audience-refresh').onclick = () => { audienceDbLoaded = false; sqliteTableList = null; loadAudienceDatabase(); };
  $('db-sqlite-table').onchange = () => { audienceDbOffset = 0; audienceDbLoaded = false; loadAudienceDatabase(); };
  $('db-lottery-refresh').onclick = () => { lotteryDbLoaded = false; loadLotteryDatabase(); };
  $('db-audience-prev').onclick = () => { audienceDbOffset = Math.max(0, audienceDbOffset - 50); loadAudienceDatabase(); };
  $('db-audience-next').onclick = () => { if (audienceDbHasMore) { audienceDbOffset += 50; loadAudienceDatabase(); } };
  $('db-audience-search').addEventListener('input', () => { clearTimeout(audienceSearchTimer); audienceSearchTimer = setTimeout(() => { audienceDbOffset = 0; audienceDbLoaded = false; loadAudienceDatabase(); }, 300); });
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
      bottom.append(node('span', service ? (service.status === 'online' ? '● Activo' : '○ Detenido') + (servicesAreStale ? ' · guardado' : '') : m.category));
      const href = destination(m.url);
      if (href) { const a = node('a', 'Abrir panel ↗'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', 'Abrir ' + m.name); bottom.append(a); }
      else bottom.append(node('span', 'Enlace no válido'));
      card.append(bottom);
      if (service) {
        const actions = node('div', undefined, 'service-actions');
        const serviceAction = (label, action, className = '') => {
          const control = button(label, action, className);
          if (servicesAreStale) { control.disabled = true; control.title = 'Esperando la comprobación actual del servicio.'; }
          return control;
        };
        if (service.status !== 'online') actions.append(serviceAction('Iniciar', () => controlService(service, 'start'), 'service-start'));
        else actions.append(serviceAction('Reiniciar', () => confirmAction('Reiniciar ' + service.name, 'El servicio se desconectará brevemente de sus overlays mientras vuelve a iniciar.', () => controlService(service, 'restart'))));
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
      notice(action === 'start' ? service.name + ' iniciado.' : action === 'stop' ? service.name + ' apagado.' : service.name + ' reiniciado.');
      await refreshOverview();
      if (!$('preflight-results').hidden) runPreflight(false);
    } catch (error) { notice('No se pudo ' + ({ start: 'iniciar', stop: 'apagar', restart: 'reiniciar' }[action] || 'controlar') + ' ' + service.name + ': ' + error.message, true); }
  }
  function applyOverview(data, { cached = false } = {}) {
    if (!cached) {
      $('connection').textContent = 'Cortex conectado';
      $('connection').style.color = '';
      $('connection').title = '';
    }
    const overviewServices = Array.isArray(data.services) ? data.services : [];
    services = overviewServices;
    servicesAreStale = cached;
    const online = overviewServices.filter(service => service.status === 'online').length;
    $('health-services').textContent = `${online}/${overviewServices.length}`;
    const spotify = data.chatBotSpotify || {};
    const spotifyReady = data.spotifyConnected === true;
    $('health-spotify').textContent = !spotify.reachable ? 'Sin respuesta' : !spotify.moduleEnabled ? 'Módulo apagado' : !spotify.connected ? 'Spotify desconectado' : !spotify.cortexDashboardConnected ? 'Sin enlace a Cortex' : !spotify.captureFacebook ? 'Captura Facebook apagada' : !spotify.enabled ? 'Pedidos apagados' : 'Listo';
    const obsRequired = $('preflight-obs').checked;
    $('health-obs').textContent = !obsRequired ? 'No requerido' : data.obsReachable === null ? 'Sin dato' : data.obsReachable ? 'Disponible' : 'Sin conexión';
    const ai = data.spotifyAi || {};
    const aiReady = ai.enabled === true && ai.keyPresent === true && !!ai.model;
    $('health-ai').textContent = ai.enabled !== true ? 'IA apagada' : ai.keyPresent !== true ? 'Falta clave' : !ai.model ? 'Falta modelo' : ai.model;
    const deviceAge = Date.now() - Number(data.spotifyDeviceUpdatedAt || 0);
    const deviceFresh = !!data.spotifyDevice && deviceAge <= 60000;
    $('health-device').textContent = deviceFresh ? data.spotifyDevice : data.spotifyDevice ? `${data.spotifyDevice} · dato antiguo` : (spotify.connected ? 'Sin dispositivo activo' : 'Spotify desconectado');
    const overlayClients = Number(data.ruloOverlayClients);
    const botOverlayClients = Number(data.ruloBotOverlayClients);
    const ruloEnabled = data.ruloEnabled !== false;
    const ruloPower = $('home-rulo-power');
    ruloPower.checked = ruloEnabled;
    ruloPower.disabled = cached;
    $('home-rulo-power-title').textContent = ruloEnabled ? 'Rulo encendido' : 'Rulo apagado';
    $('home-rulo-power-status').textContent = cached ? 'Estado guardado · verificando…' : ruloEnabled ? 'Funciones listas · abrir controles WebM / 3D' : 'Algunos pedidos y acciones están detenidos · abrir controles';
    const ruloSourceActive = (data.obsProgram?.enabledSources || []).some(name => /rulo/i.test(String(name)));
    $('health-rulo-overlay').textContent = !ruloEnabled ? 'Rulo apagado' : Number.isFinite(botOverlayClients) && Number.isFinite(overlayClients) ? `Bot ${botOverlayClients} · Rulo ${overlayClients}${ruloSourceActive ? ' · fuente activa' : ''}` : 'Actualiza Cortex para medir';
    const playback = data.spotifyPlayback || {};
    const playbackAge = Date.now() - Number(playback.receivedAt || 0);
    const trackLabel = playback.track ? [playback.track.name, playback.track.artist].filter(Boolean).join(' — ') : '';
    $('health-playing').textContent = playbackAge > 30000 || !trackLabel ? 'Sin dato reciente' : trackLabel;
    $('health-services').className = online === overviewServices.length && overviewServices.length ? 'health-good' : 'health-attention';
    $('health-spotify').className = spotifyReady ? 'health-good' : 'health-attention';
    $('health-obs').className = !obsRequired ? 'health-neutral' : data.obsReachable ? 'health-good' : 'health-attention';
    $('health-ai').className = aiReady ? 'health-good' : 'health-attention';
    $('health-device').className = deviceFresh ? 'health-good' : 'health-attention';
    $('health-rulo-overlay').className = ruloEnabled && botOverlayClients > 0 && overlayClients > 0 ? 'health-good' : 'health-attention';
    $('health-playing').className = playbackAge <= 30000 && playback.isPlaying === true ? 'health-good' : 'health-attention';
    if (state && !cached) { renderCards(); renderPreflightServices(); }
  }
  $('home-rulo-power').addEventListener('change', async event => {
    const toggle = event.currentTarget, enabled = toggle.checked, status = $('home-rulo-power-status');
    toggle.disabled = true;
    status.textContent = enabled ? 'Encendiendo Rulo…' : 'Apagando Rulo…';
    try {
      const result = await request('/api/rulo-mascota-state', { enabled });
      toggle.checked = result.enabled === true;
      $('home-rulo-power-title').textContent = result.enabled ? 'Rulo encendido' : 'Rulo apagado';
      status.textContent = result.enabled ? 'Funciones listas; cambios guardados.' : 'Algunos pedidos y acciones están detenidos.';
      notice(result.enabled ? 'Rulo encendido.' : 'Rulo apagado.');
      await refreshOverview();
    } catch (error) {
      toggle.checked = !enabled;
      $('home-rulo-power-title').textContent = enabled ? 'Rulo apagado' : 'Rulo encendido';
      status.textContent = error.message;
      notice('No se pudo cambiar el estado de Rulo: ' + error.message, true);
    } finally { toggle.disabled = false; }
  });
  const defaultStreamProfiles = {
    radio: { services: ['modulo-de-tiempo-y-clima', 'comentarios', 'trigger-studio', 'chat-bot-spotify'], rulo: true, socialstream: true, obs: true, ngrok: false },
    sorteo: { services: ['modulo-de-tiempo-y-clima', 'comentarios', 'trigger-studio', 'modulo-de-loteria', 'chat-bot-spotify'], rulo: true, socialstream: true, obs: true, ngrok: false },
    pruebas: { services: ['modulo-de-tiempo-y-clima'], rulo: false, socialstream: false, obs: false, ngrok: false }
  };
  function streamProfiles() {
    try {
      const saved = JSON.parse(localStorage.getItem('cortex-stream-profiles') || '{}');
      return { ...defaultStreamProfiles, ...saved, pruebas: { ...defaultStreamProfiles.pruebas, ...(saved.pruebas || {}), obs: false, ngrok: false, rulo: false, socialstream: false } };
    } catch { return { ...defaultStreamProfiles }; }
  }
  function selectedStreamProfile() { return $('stream-profile').value || 'radio'; }
  function applyStreamProfile() {
    const profile = streamProfiles()[selectedStreamProfile()] || defaultStreamProfiles.radio;
    document.body.dataset.streamProfile = selectedStreamProfile();
    $('btn-refresh-obs').hidden = selectedStreamProfile() === 'pruebas';
    preflightAdvanced.hidden = profile.obs !== true;
    ['rulo', 'socialstream', 'obs', 'ngrok'].forEach(id => { $('preflight-' + id).checked = profile[id] === true; $('preflight-' + id).onchange = () => { saveStreamProfile(); if (!$('preflight-results').hidden) runPreflight(false); }; });
    let legacyScene = '', legacySources = '';
    if (selectedStreamProfile() === 'radio') try { legacyScene = localStorage.getItem('cortex-expected-obs-scene') || ''; legacySources = localStorage.getItem('cortex-required-obs-sources') || ''; } catch { /* Preferencias opcionales. */ }
    $('preflight-expected-scene').value = profile.expectedScene ?? legacyScene;
    $('preflight-required-sources').value = profile.requiredSources ?? legacySources;
    $('preflight-obs').onchange = async () => { saveStreamProfile(); if ($('preflight-obs').checked) { try { await loadObsScenes(); } catch { /* Se informa en el estado de OBS. */ } } refreshObsLiveStatus(); };
    renderPreflightServices();
  }
  async function refreshObsLiveStatus() {
    const card = $('obs-live-card');
    if (!$('preflight-obs').checked) { card.className = 'obs-live-card inactive'; $('obs-live-status').textContent = 'OBS NO INCLUIDO'; $('obs-live-details').textContent = 'Este perfil no requiere transmisión por OBS.'; return; }
    if (document.hidden || obsPollBusy) return;
    obsPollBusy = true;
    try {
      const data = await request('/api/cortex-home/obs-live-status');
      const elapsed = Math.max(0, Math.floor((Number(data.streamDurationMs) || 0) / 1000));
      const time = data.streamTimecode || [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60].map(value => String(value).padStart(2, '0')).join(':');
      const fps = Number(data.activeFps) > 0 ? Number(data.activeFps).toFixed(1) + ' FPS' : 'FPS sin dato';
      const dropped = `${Number(data.skippedFrames) || 0} cuadros perdidos de ${Number(data.totalFrames) || 0}`;
      card.className = 'obs-live-card ' + (data.reconnecting ? 'reconnecting' : data.streaming ? ((Number(data.skippedFrames) || 0) > 0 ? 'live-warning' : 'live') : 'offline');
      $('obs-live-status').textContent = data.reconnecting ? 'RECONECTANDO' : data.streaming ? 'EN VIVO' : 'NO EN VIVO';
      $('obs-live-details').textContent = `Escena: ${data.currentScene || 'sin dato'} · ${data.streaming ? 'Tiempo ' + time + ' · ' : ''}${fps} · ${dropped}`;
    } catch (error) {
      card.className = 'obs-live-card unavailable'; $('obs-live-status').textContent = 'OBS SIN CONEXIÓN'; $('obs-live-details').textContent = error.message || 'No se pudo consultar OBS.';
    } finally { obsPollBusy = false; }
  }
  function saveStreamProfile(showSavedNotice = true) {
    const profiles = streamProfiles();
    profiles[selectedStreamProfile()] = { services: [...document.querySelectorAll('#preflight-services [data-service-id]:checked')].map(input => input.dataset.serviceId), stopServices: [...document.querySelectorAll('#end-stream-services [data-stop-service-id]:checked')].map(input => input.dataset.stopServiceId), ...Object.fromEntries(['rulo', 'socialstream', 'obs', 'ngrok'].map(id => [id, $('preflight-' + id).checked])), expectedScene: $('preflight-expected-scene').value, requiredSources: $('preflight-required-sources').value };
    try { localStorage.setItem('cortex-stream-profiles', JSON.stringify(profiles)); if (showSavedNotice) notice('Selección guardada en el perfil «' + $('stream-profile').selectedOptions[0].textContent + '».'); } catch { if (showSavedNotice) notice('No se pudo guardar el perfil en este navegador.', true); }
  }
  function renderPreflightServices() {
    const box = $('preflight-services');
    if (!state) { box.textContent = 'Consultando módulos…'; return; }
    const choices = (state?.modules || []).filter(module => module.serviceId);
    if (!choices.length) { box.textContent = 'No hay módulos registrados.'; return; }
    const profile = streamProfiles()[selectedStreamProfile()] || defaultStreamProfiles.radio;
    box.replaceChildren(...choices.map(module => {
      const row = node('div', undefined, 'preflight-service-choice'), label = node('label'), input = document.createElement('input'); input.type = 'checkbox'; input.dataset.serviceId = module.serviceId;
      input.checked = Array.isArray(profile.services) ? profile.services.includes(module.serviceId) : false;
      input.onchange = saveStreamProfile;
      label.append(input, document.createTextNode(module.name)); row.append(label);
      const service = services.find(item => item.id === module.serviceId);
      const running = service?.status === 'online';
      row.append(node('span', service ? (running ? '✓ ACTIVO' : '○ APAGADO') + (servicesAreStale ? ' · GUARDADO' : '') : '… CONSULTANDO', 'preflight-module-state ' + (running ? 'is-ready' : service ? 'is-off' : '')));
      const actions = node('div', undefined, 'preflight-module-actions');
      const serviceAction = (label, action, className = '') => {
        const control = button(label, action, className);
        if (servicesAreStale) { control.disabled = true; control.title = 'Esperando la comprobación actual del servicio.'; }
        return control;
      };
      if (service && running) {
        actions.append(serviceAction('Reiniciar', () => confirmAction('Reiniciar ' + service.name, 'El módulo se desconectará brevemente de sus overlays.', () => controlService(service, 'restart'))));
        actions.append(serviceAction('Apagar', () => confirmAction('Apagar ' + service.name, 'Sus overlays dejarán de recibir datos hasta que vuelvas a encender el módulo.', () => controlService(service, 'stop'))));
      } else if (service) actions.append(serviceAction('Encender', () => controlService(service, 'start'), 'service-start'));
      if (module.serviceId === 'trigger-studio') {
        const openApp = button('Abrir app', async () => {
          openApp.disabled = true; openApp.textContent = 'Abriendo…';
          try {
            const result = await request('/api/cortex-home/prepare', { services: ['trigger-studio'] });
            const triggerStudio = result.results?.find(item => item.id === 'trigger-studio');
            if (!triggerStudio?.ok) throw new Error(triggerStudio?.error || 'No se pudo preparar TriggerStudio.');
            if (triggerStudio.desktopApp?.ok === false) throw new Error(triggerStudio.desktopApp.message || 'No se pudo abrir TriggerStudio.exe.');
            notice(triggerStudio.desktopApp?.message || 'TriggerStudio está listo.');
            await refreshOverview();
          } catch (error) { notice('No se pudo abrir TriggerStudio: ' + error.message, true); }
          finally { openApp.disabled = false; openApp.textContent = 'Abrir app'; }
        }, 'service-app-open');
        openApp.title = 'Abrir la aplicación de escritorio TriggerStudio';
        openApp.setAttribute('aria-label', 'Abrir la aplicación de escritorio TriggerStudio');
        row.classList.add('has-service-app-open');
        row.append(openApp);
      }
      row.append(actions);
      if (module.serviceId === 'trigger-studio') {
        const connection = node('div', undefined, 'preflight-trigger-connection');
        const profiles = { ...(triggerStudioConnection.profiles || {}), ...(triggerStudioDraftProfiles || {}) };
        const mode = triggerStudioDraftMode || triggerStudioConnection.mode || 'tailscale';
        const modeLabel = node('label', 'Conexión a OBS');
        const modeSelect = document.createElement('select');
        modeSelect.append(new Option('Tailscale', 'tailscale'), new Option('Red local', 'lan'), new Option('Otra IP manual', 'manual'));
        modeSelect.value = mode;
        modeLabel.append(modeSelect);
        const fieldLabel = node('label', mode === 'tailscale' ? 'IP Tailscale de la PC con OBS' : mode === 'lan' ? 'IP local de la PC con OBS' : 'Otra IP de la PC con OBS');
        const field = document.createElement('input'); field.type = 'text'; field.inputMode = 'text'; field.autocomplete = 'off'; field.spellcheck = false; field.placeholder = 'Ej.: 192.168.1.50 o 100.x.x.x';
        field.value = profiles[mode] || '';
        field.addEventListener('input', () => { profiles[mode] = field.value; triggerStudioDraftProfiles = { ...profiles }; triggerStudioDraftMode = mode; triggerStudioFeedback = ''; });
        modeSelect.addEventListener('change', () => {
          profiles[mode] = field.value.trim();
          triggerStudioDraftProfiles = { ...profiles };
          triggerStudioDraftMode = modeSelect.value;
          triggerStudioFeedback = '';
          renderPreflightServices();
        });
        if (servicesAreStale) { openApp.disabled = true; openApp.title = 'Esperando la comprobación actual del servicio.'; }
        fieldLabel.append(field);
        const controls = node('div', undefined, 'preflight-trigger-actions');
        const saveIp = button('Guardar y aplicar', async () => {
          saveIp.disabled = true; saveIp.textContent = 'Guardando…';
          try {
            const selectedMode = modeSelect.value, selectedIp = field.value.trim();
            const connectionChanged = triggerStudioConnection.mode !== selectedMode || triggerStudioConnection.ip !== selectedIp;
            profiles[selectedMode] = selectedIp;
            const data = await request('/api/trigger-studio/connection', { mode: modeSelect.value, profiles });
            triggerStudioConnection = data; triggerStudioDraftMode = null; triggerStudioDraftProfiles = null;
            const service = services.find(item => item.id === 'trigger-studio');
            if (service?.status === 'online' && connectionChanged) {
              saveIp.textContent = 'Aplicando…';
              await request('/api/services/trigger-studio/restart', {});
              triggerStudioFeedback = 'Conexión guardada en .env y aplicada. TriggerStudio se reinició.';
            } else if (service?.status === 'online') triggerStudioFeedback = 'Perfiles guardados en .env. TriggerStudio ya usa la conexión seleccionada.';
            else triggerStudioFeedback = 'Conexión guardada en .env. Se aplicará cuando inicies TriggerStudio.';
            triggerStudioFeedbackOk = true;
          } catch (error) { triggerStudioFeedback = error.message; triggerStudioFeedbackOk = false; }
          await refreshOverview();
          renderPreflightServices();
          saveIp.disabled = false;
        });
        const testIp = button('Probar conexión', async () => {
          testIp.disabled = true; testIp.textContent = 'Probando…';
          triggerStudioFeedback = 'Comprobando la red seleccionada y la autenticación de OBS…'; triggerStudioFeedbackOk = false;
          const feedback = connection.querySelector('.preflight-trigger-status');
          if (feedback) { feedback.textContent = triggerStudioFeedback; feedback.classList.remove('is-ready', 'is-off'); }
          try {
            const result = await request('/api/trigger-studio/connection/test', { ip: field.value.trim() });
            triggerStudioFeedback = result.message; triggerStudioFeedbackOk = result.ok === true;
          } catch (error) { triggerStudioFeedback = error.message; triggerStudioFeedbackOk = false; }
          renderPreflightServices();
        });
        const guide = node('div', undefined, 'preflight-trigger-guide'); guide.hidden = true;
        guide.append(node('strong', 'Guía rápida: conectar las dos PCs'));
        const guideSteps = node('ol');
        const step1 = node('li'); step1.append(document.createTextNode('Elige cómo se conectarán: por red local, conecta ambas PCs al mismo router (Wi-Fi o cable); por Tailscale, abre Tailscale en ambas e inicia sesión en la misma red privada (tailnet).'));
        const step2 = node('li'); step2.append(document.createTextNode('En la PC con OBS, ve a Herramientas → Ajustes del servidor WebSocket. Habilítalo en el puerto '), node('code', '4455'), document.createTextNode(' y activa la autenticación. La contraseña de OBS debe coincidir con la configurada para TriggerStudio.'));
        const step3 = node('li'); step3.append(document.createTextNode('Obtén la IP de la PC con OBS: para Tailscale, ejecuta '), node('code', 'tailscale ip -4'), document.createTextNode(' y copia la dirección '), node('code', '100.x.x.x'), document.createTextNode('; para la red local, ejecuta '), node('code', 'ipconfig'), document.createTextNode(' y copia la dirección IPv4 del adaptador conectado al mismo router.'));
        const step4 = node('li'); step4.append(document.createTextNode('Elige Tailscale, red local o IP manual. Cada opción conserva su propia IP. Pulsa «Probar conexión» y después «Guardar y aplicar»; la selección queda en el .env y TriggerStudio se reinicia para usarla.'));
        const step5 = node('li'); step5.append(document.createTextNode('Para mostrar el overlay, agrega una fuente Navegador en OBS y usa '), node('code', 'http://<IP-de-Cortex>:2188/overlay.html'), document.createTextNode('. Usa la IP de Cortex por la misma vía: su IPv4 local si vas por red local, o su IP de Tailscale si vas por Tailscale.'));
        guideSteps.append(step1, step2, step3, step4, step5);
        const guideTip = node('p', 'Si la prueba no conecta, verifica que las PCs compartan la red local o estén conectadas a Tailscale y que el Firewall de Windows permita TCP 4455 en OBS. Si el overlay no carga, permite TCP 2188 en la PC con Cortex.');
        guide.append(guideSteps, guideTip);
        const guideToggle = button('Guía', () => {
          guide.hidden = !guide.hidden;
          guideToggle.setAttribute('aria-expanded', String(!guide.hidden));
        }, 'preflight-guide-toggle');
        guideToggle.setAttribute('aria-expanded', 'false'); guideToggle.title = 'Mostrar u ocultar la guía de conexión';
        controls.append(saveIp, testIp, guideToggle);
        const defaultStatus = !triggerStudioConnection.configured
          ? 'Aún no hay una IP guardada.'
          : triggerStudioConnection.passwordConfigured
            ? 'Activa · ' + ({ tailscale: 'Tailscale', lan: 'red local', manual: 'IP manual' }[triggerStudioConnection.mode] || 'red') + ' · puerto ' + (triggerStudioConnection.port || 4455)
            : 'Falta configurar la contraseña de OBS en TriggerStudio.';
        const feedback = node('span', triggerStudioFeedback || defaultStatus, 'preflight-trigger-status' + (triggerStudioFeedback ? (triggerStudioFeedbackOk ? ' is-ready' : ' is-off') : ''));
        connection.append(modeLabel, fieldLabel, controls, feedback, guide);
        row.append(connection);
      }
      return row;
    }));
    renderEndStreamServices(choices, profile);
  }
  async function loadTriggerStudioConnection() {
    try { triggerStudioConnection = await request('/api/trigger-studio/connection'); }
    catch { triggerStudioFeedback = 'No se pudo leer la configuración de TriggerStudio.'; triggerStudioFeedbackOk = false; }
    if (state) renderPreflightServices();
  }
  function renderEndStreamServices(choices, profile) {
    const box = $('end-stream-services');
    const selectedToStop = Array.isArray(profile.stopServices) ? profile.stopServices : profile.services;
    box.replaceChildren(...choices.map(module => {
      const label = node('label'), input = document.createElement('input'); input.type = 'checkbox'; input.dataset.stopServiceId = module.serviceId; input.checked = Array.isArray(selectedToStop) && selectedToStop.includes(module.serviceId); input.onchange = saveStreamProfile;
      label.append(input, document.createTextNode(module.name)); return label;
    }));
  }
  const preflightManual = { 'socialstream-dock': 'preflight-dock', 'rulo-overlay-visual': 'preflight-rulo-visible', 'obs-audio': 'preflight-audio' };
  function renderPreflightResults(checks) {
    const box = $('preflight-results'); box.hidden = false;
    const rows = checks.map(check => {
      let state = check.state;
      if (state === 'manual') state = $(preflightManual[check.id])?.checked ? 'ready' : 'manual';
      const label = { ready: 'LISTO', warn: 'REVISAR', fail: 'FALTA', manual: 'REVISAR' }[state] || 'REVISAR';
      const icon = { ready: '✓', warn: '⚠', fail: '×', manual: '⚠' }[state] || '⚠';
      return { ...check, state, label, icon };
    });
    const failures = rows.filter(row => row.state === 'fail').length;
    const manual = rows.filter(row => row.state === 'manual').length;
    const warnings = rows.filter(row => row.state === 'warn').length;
    const ready = rows.length > 0 && rows.every(row => row.state === 'ready');
    const blocker = rows.find(row => row.state === 'fail') || rows.find(row => row.state === 'manual') || rows.find(row => row.state === 'warn');
    const readiness = $('stream-readiness');
    readiness.className = 'stream-readiness ' + (ready ? 'ready' : failures ? 'blocked' : 'review');
    $('readiness-status').textContent = ready ? '✓ LISTO PARA EMITIR' : failures ? '× FALTA: ' + (blocker?.name || 'revisar chequeo') : '⚠ REVISAR ANTES DE EMITIR: ' + (blocker?.name || 'confirmaciones pendientes');
    $('readiness-detail').textContent = ready ? 'Todos los chequeos y confirmaciones del perfil están completos.' : blocker?.detail || 'Revisa los pendientes antes de salir al aire.';
    const readinessAction = $('readiness-action'); readinessAction.hidden = ready; readinessAction.onclick = () => {
      if (!blocker) return;
      if (blocker.id === 'chat-test') { $('preflight-recheck').click(); return; }
      if (preflightManual[blocker.id]) { $(preflightManual[blocker.id]).focus(); return; }
      if (blocker.id === 'test-mode') { const toggle = $('global-test-mode'); toggle.scrollIntoView({ behavior: 'smooth', block: 'center' }); toggle.focus(); return; }
      if (blocker.id === 'obs-scene') { $('preflight-expected-scene').focus(); return; }
      const line = [...box.querySelectorAll('.preflight-result')].find(item => item.dataset.checkId === blocker.id);
      if (!line) return;
      line.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const action = line.querySelector('button');
      if (action) action.focus(); else { line.tabIndex = -1; line.focus(); }
    };
    const status = node('strong', failures ? `${failures} pendiente${failures === 1 ? '' : 's'} · ${manual} confirmación${manual === 1 ? '' : 'es'}` : manual ? `Módulos listos · faltan ${manual} confirmación${manual === 1 ? '' : 'es'}` : warnings ? `Listo con ${warnings} observación${warnings === 1 ? '' : 'es'}` : 'Todo listo para salir al aire', 'preflight-summary');
    box.replaceChildren(status, ...rows.map(row => {
      const line = node('div', undefined, 'preflight-result ' + row.state), badge = node('b', undefined, 'preflight-result-state'); line.dataset.checkId = row.id;
      badge.append(node('span', row.icon, 'preflight-status-icon'), document.createTextNode(row.label));
      const detail = preflightManual[row.id] && row.state === 'ready' ? 'Confirmado para esta sesión.' : row.detail;
      line.append(badge, node('span', row.name + ' · ' + detail));
      const serviceId = row.id.startsWith('service:') ? row.id.slice('service:'.length) : null;
      const service = serviceId && services.find(item => item.id === serviceId);
      if (service) {
        const actions = node('div', undefined, 'preflight-result-actions');
        if (service.status === 'online') {
          actions.append(button('Reintentar', () => confirmAction('Reiniciar ' + service.name, 'El módulo se desconectará brevemente de sus overlays.', () => controlService(service, 'restart'))));
          actions.append(button('Apagar', () => confirmAction('Apagar ' + service.name, 'Sus overlays dejarán de recibir datos hasta que vuelvas a encender el módulo.', () => controlService(service, 'stop'))));
        } else actions.append(button('Encender', () => controlService(service, 'start'), 'service-start'));
        line.append(actions);
      } else if (row.state === 'fail' || row.state === 'warn') {
        line.append(button(row.id === 'ngrok' ? 'Reintentar' : 'Revisar otra vez', () => row.id === 'ngrok' ? retryNgrok() : runPreflight(false), 'preflight-retry'));
      }
      return line;
    }));
  }
  async function runPreflight(prepare = true) {
    const button = $('preflight-run'); button.disabled = true; button.textContent = prepare ? 'Iniciando módulos uno a uno…' : 'Revisando conexiones…'; $('preflight-results').hidden = true; $('stream-readiness').className = 'stream-readiness checking'; $('readiness-status').textContent = prepare ? 'Iniciando módulos…' : 'Chequeando…'; $('readiness-detail').textContent = prepare ? 'Cortex inicia cada módulo en secuencia y espera a que su panel responda antes de continuar.' : 'Cortex consulta el estado de los módulos y las conexiones seleccionadas.'; $('readiness-action').hidden = true;
    if (prepare) {
      prepareProgressLastValue = 0;
      renderPrepareProgress({ running: true, phase: 'checking', progress: 0, completed: 0, total: 0, startedAt: Date.now(), message: 'Consultando el estado de los módulos…' }, { keepProgress: false });
    } else prepareProgressPanel.hidden = true;
    try {
      const servicesToStart = [...document.querySelectorAll('#preflight-services [data-service-id]:checked')].map(input => input.dataset.serviceId);
      const features = ['rulo', 'socialstream', 'obs', 'ngrok'].filter(id => $('preflight-' + id).checked);
      let started = { results: [] };
      let prepareState = null;
      if (prepare) {
        Object.values(preflightManual).forEach(id => { $(id).checked = false; });
        preflightStartedAt = Date.now();
        const prepareRequest = request('/api/cortex-home/prepare', { services: servicesToStart, ngrok: $('preflight-ngrok').checked, trackProgress: true });
        startPrepareProgressPolling();
        started = await prepareRequest;
        stopPrepareProgressPolling();
        prepareState = await request('/api/cortex-home/prepare-status');
        renderPrepareProgress({ ...prepareState, running: true, phase: 'review', progress: 96, remainingSeconds: 0, message: 'Módulos encendidos; comprobando conexiones y requisitos del directo…' });
        const waitingFor = started.results.filter(item => item.ok && !item.alreadyReady && item.id !== 'ngrok').map(item => item.id);
        for (let attempt = 0; waitingFor.length && attempt < 12; attempt += 1) {
          const current = await request('/api/services');
          const online = new Set(current.filter(service => service.status === 'online').map(service => service.id));
          if (waitingFor.every(id => online.has(id))) break;
          button.textContent = `Esperando módulos… ${attempt + 1}/12`;
          const pendingId = waitingFor.find(id => !online.has(id));
          renderPrepareProgress({ ...prepareState, running: true, phase: 'review', progress: 96, remainingSeconds: Math.max(1, 12 - attempt), message: `Confirmando que ${services.find(service => service.id === pendingId)?.name || pendingId} aparece activo…` });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      let obsSceneLoadError = '';
      if (features.includes('obs')) {
        try { await loadObsScenes(); }
        catch (error) { obsSceneLoadError = error.message; }
      }
      const query = new URLSearchParams({ services: [...servicesToStart, ...features].join(','), since: String(preflightStartedAt), expectedScene: $('preflight-expected-scene').value, requiredSources: $('preflight-required-sources').value, profile: selectedStreamProfile() });
      const result = await request('/api/cortex-home/preflight?' + query.toString());
      if (obsSceneLoadError) {
        const sceneCheck = result.checks.find(check => check.id === 'obs-scene');
        if (sceneCheck?.state === 'fail') sceneCheck.detail = 'No se pudo consultar la escena de OBS: ' + obsSceneLoadError;
      }
      for (const failed of started.results.filter(item => !item.ok)) result.checks.push({ id: 'start:' + failed.id, name: failed.id === 'ngrok' ? 'ngrok' : (services.find(service => service.id === failed.id)?.name || failed.id), state: 'fail', detail: failed.error || 'No se pudo iniciar.' });
      for (const item of started.results.filter(result => result.desktopApp)) {
        const appName = services.find(service => service.id === item.id)?.name || 'TriggerStudio';
        result.checks.push({ id: 'service-app:' + item.id, name: 'Aplicación ' + appName, state: item.desktopApp.ok ? 'ready' : 'fail', detail: item.desktopApp.message || 'No se pudo abrir la aplicación.' });
      }
      renderPreflightResults(result.checks);
      try { await request('/api/cortex-home/preflight-history', { profile: $('stream-profile').selectedOptions[0].textContent, checks: result.checks }); await loadPreflightHistory(); } catch { /* El chequeo actual sigue disponible si el disco no acepta historial. */ }
      $('preflight-recheck').hidden = !features.includes('socialstream');
      await refreshOverview();
      const startupFailures = started.results.some(item => !item.ok);
      if (prepare) {
        const needsReview = startupFailures || result.checks.some(check => check.state === 'fail' || check.state === 'manual' || check.state === 'warn');
        preflightButtonState = startupFailures ? 'retry' : result.ready && !needsReview ? 'prepared' : 'review';
        renderPrepareProgress({ ...await request('/api/cortex-home/prepare-status'), running: false, phase: needsReview ? 'complete-with-issues' : 'complete', progress: 100, finishedAt: Date.now(), message: startupFailures ? 'Preparación terminada con módulos pendientes.' : needsReview ? 'Módulos iniciados · revisa los puntos pendientes.' : 'Preparación y revisión finalizadas; el directo está listo.' });
      }
      if (startupFailures) notice('Algunos módulos no pudieron iniciarse. Revisa los resultados.', true);
    } catch (error) {
      if (prepare) {
        stopPrepareProgressPolling();
        preflightButtonState = 'retry';
        renderPrepareProgress({ running: false, phase: 'failed', progress: prepareProgressLastValue, completed: 0, total: 0, startedAt: Date.now(), finishedAt: Date.now(), message: 'Preparación interrumpida: ' + error.message });
      }
      notice('No se pudo completar el chequeo: ' + error.message, true); $('stream-readiness').className = 'stream-readiness blocked'; $('readiness-status').textContent = '× NO SE PUDO COMPLETAR'; $('readiness-detail').textContent = error.message;
    }
    finally { setIdlePreflightButton(); }
  }
  $('preflight-run').onclick = () => runPreflight(true);
  $('preflight-recheck').onclick = () => runPreflight(false);
  try { $('stream-profile').value = localStorage.getItem('cortex-stream-profile') || 'radio'; } catch { /* Perfil local opcional. */ }
  applyStreamProfile();
  $('stream-profile').onchange = async () => { try { localStorage.setItem('cortex-stream-profile', selectedStreamProfile()); } catch { /* Perfil local opcional. */ } Object.values(preflightManual).forEach(id => { $(id).checked = false; }); applyStreamProfile(); restoreCachedOverview(); void refreshOverview(); if ($('preflight-obs').checked) { try { await loadObsScenes(); } catch { /* Se informa en el estado de OBS. */ } } await refreshObsLiveStatus(); if (!$('preflight-results').hidden) runPreflight(false); };
  $('save-stream-profile').onclick = saveStreamProfile;
  $('preflight-expected-scene').onchange = () => { saveStreamProfile(false); if (!$('preflight-results').hidden) runPreflight(false); };
  $('preflight-required-sources').onchange = () => { saveStreamProfile(false); if (!$('preflight-results').hidden) runPreflight(false); };
  async function loadObsScenes() {
    if (!$('preflight-obs').checked) return { scenes: [], skipped: true };
    const sceneData = await request('/api/cortex-home/obs-scenes');
    const sceneSelect = $('preflight-expected-scene'), expected = (streamProfiles()[selectedStreamProfile()] || {}).expectedScene || '';
    sceneSelect.replaceChildren(new Option('Selecciona escena…', ''), ...sceneData.scenes.map(name => new Option(name, name)));
    if (expected && sceneData.scenes.includes(expected)) sceneSelect.value = expected;
    return sceneData;
  }
  async function loadPreflightHistory() {
    try {
      const data = await request('/api/cortex-home/preflight-history'), box = $('preflight-history-list');
      box.replaceChildren(...(data.history || []).slice(-5).reverse().map(entry => {
        const row = node('details', undefined, 'preflight-history-row'), summary = node('summary', `${entry.profile || 'Directo'} · ${new Date(entry.at).toLocaleString('es')}`), counts = entry.checks.reduce((acc, check) => (acc[check.state] = (acc[check.state] || 0) + 1, acc), {}), checks = node('div', undefined, 'preflight-history-checks');
        summary.append(node('span', `${counts.ready || 0} listos · ${(counts.fail || 0) + (counts.manual || 0)} pendientes · ${counts.warn || 0} revisar`));
        for (const check of entry.checks) checks.append(node('p', `${{ ready: '✓ LISTO', warn: '⚠ REVISAR', fail: '× FALTA', manual: '⚠ REVISAR' }[check.state] || '⚠ REVISAR'} · ${check.name}: ${check.detail}`));
        row.append(summary, checks); return row;
      }));
      if (!(data.history || []).length) box.textContent = 'Todavía no hay chequeos guardados.';
    } catch { $('preflight-history-list').textContent = 'No se pudo cargar el historial.'; }
  }
  $('refresh-preflight-history').onclick = loadPreflightHistory;
  $('end-stream').onclick = () => confirmAction('Terminar directo', 'Se apagarán solo los módulos marcados en «Elegir qué módulos apagar al terminar» y se cerrará el túnel de estado de Cortex, si está activo.', async () => {
    try {
      const servicesToStop = [...document.querySelectorAll('#end-stream-services [data-stop-service-id]:checked')].map(input => input.dataset.stopServiceId);
      const result = await request('/api/cortex-home/end-stream', { services: servicesToStop });
      await refreshOverview(); $('preflight-results').hidden = true;
      const failures = result.results.filter(item => !item.ok);
      $('stream-readiness').className = 'stream-readiness ' + (failures.length ? 'blocked' : 'unknown');
      $('readiness-status').textContent = failures.length ? '× REVISAR CIERRE' : 'DIRECTO TERMINADO';
      $('readiness-detail').textContent = failures.length ? failures.map(item => item.id + ': ' + item.error).join(' · ') : 'Puedes preparar otro directo cuando quieras.';
      $('readiness-action').hidden = true;
      notice(failures.length ? 'Algunos elementos no se pudieron apagar: ' + failures.map(item => item.id).join(', ') : 'Directo terminado. Módulos seleccionados y túnel apagados.');
    } catch (error) { notice('No se pudo terminar el directo: ' + error.message, true); }
  });
  loadPreflightHistory();
  loadTriggerStudioConnection();
  async function retryNgrok() {
    try {
      const result = await request('/api/cortex-home/prepare', { services: [], ngrok: true });
      if (result.results.some(item => !item.ok)) notice(result.results.find(item => !item.ok)?.error || 'No se pudo iniciar ngrok.', true);
      await runPreflight(false);
    } catch (error) { notice('No se pudo iniciar ngrok: ' + error.message, true); }
  }
  Object.values(preflightManual).forEach(id => { $(id).onchange = () => { const rows = $('preflight-results'); if (!rows.hidden) runPreflight(false); }; });
  function spotifyInterpretationDescription(data) {
    if (data?.interpretationSource === 'ai' || data?.aiInterpreted === true) return '✨ Interpretación IA' + (data.aiModel ? ' · ' + data.aiModel : '');
    if (data?.interpretationSource === 'rules-fallback') return '↘ Parser local como respaldo de IA' + (data.aiFallbackReason ? ' · ' + data.aiFallbackReason : '');
    if (data?.interpretationSource === 'rules') return '⚙ Interpretación por reglas locales';
    if (data?.interpretationSource === 'manual') return '✋ Búsqueda manual';
    if (data?.aiAttempted === true) return '⚠ La IA no interpretó el pedido' + (data.aiFallbackReason ? ' · ' + data.aiFallbackReason : '');
    return 'No se detectó un pedido de música.';
  }
  function suggestedAliasSource(item) {
    if (item.query) return String(item.query).slice(0, 60);
    return String(item.comment || '')
      .replace(/^\s*(?:quiero(?:\s+(?:escuchar|o[ií]r))?|pon[eé]me|pon[eé]|pongan|pasame|p[aá]same|reproduce|reproducime|busca|buscar|dame)\s+/i, '')
      .replace(/^(?:un|una|el|la|los|las)?\s*(?:tema|temita|m[uú]sica|canci[oó]n)\s+(?:de|del)\s+/i, '')
      .replace(/^(?:de|del|a)\s+/i, '').trim().slice(0, 60);
  }
  $('spotify-preview-form').onsubmit = async event => {
    event.preventDefault();
    const submit = $('spotify-preview-submit'), output = $('spotify-preview-result');
    submit.disabled = true; submit.textContent = 'Analizando…'; output.hidden = true;
    const comment = $('spotify-preview-comment').value.trim();
    const requester = $('spotify-preview-requester').value.trim() || 'Prueba';
    try {
      const data = await request('/api/spotify-simulate-comment', { comment, requester, parseOnly: true });
      const artists = (data.track?.artists || []).map(artist => typeof artist === 'string' ? artist : artist?.name || '').filter(Boolean).join(', ');
      const track = data.track ? [data.track.name, artists].filter(Boolean).join(' — ') : 'Spotify no encontró un tema con esa interpretación.';
      output.className = 'operator-result ' + (data.ok ? 'ok' : 'fail');
      output.textContent = [data.ok ? '✓ ' + track : '⚠ ' + (data.error || track), spotifyInterpretationDescription(data), 'Vista previa segura: no reprodujo ni guardó esta prueba.'].filter(Boolean).join('\n');
    } catch (error) {
      const data = error.data || {};
      output.className = 'operator-result fail';
      output.textContent = ['✖ ' + (data.error || error.message), spotifyInterpretationDescription(data), 'No se reprodujo ningún tema ni se guardó esta prueba.'].filter(Boolean).join('\n');
    } finally { output.hidden = false; submit.disabled = false; submit.textContent = 'Analizar sin reproducir'; }
  };
  function renderSpotifyLearningInbox(data) {
    const list = $('spotify-learning-list'), status = $('spotify-learning-status');
    list.replaceChildren();
    if (!data.enabled) { status.textContent = 'El historial de análisis no está disponible en esta ejecución de Cortex.'; return; }
    const rows = Array.isArray(data.rows) ? data.rows : [];
    status.textContent = rows.length ? `${rows.length} pedido${rows.length === 1 ? '' : 's'} pendiente${rows.length === 1 ? '' : 's'} de revisar · últimos 90 días.` : 'No hay pedidos pendientes. Los nuevos fallos aparecerán aquí.';
    if (!rows.length) { list.append(node('p', 'Cuando Rulo no encuentre un tema o no entienda un pedido musical, podrás aprobar aquí una corrección para futuras búsquedas.')); return; }
    rows.forEach(item => {
      const row = node('article', undefined, 'spotify-learning-row');
      row.append(node('strong', `${item.requester || 'Chat'} · ${item.status === 'notfound' ? 'No encontrado en Spotify' : 'No entendido'} · ${new Date(Number(item.ts) || Date.now()).toLocaleString('es')}`));
      row.append(node('p', `Comentario: ${item.comment || item.query || 'Sin texto guardado.'}`));
      if (item.query) row.append(node('p', `Búsqueda que intentó: ${item.query}`));
      const source = item.parsed_source === 'ai' ? `✨ IA${item.ai_model ? ' · ' + item.ai_model : ''}` : item.parsed_source === 'rules-fallback' ? '↘ Parser local con respaldo de IA' : item.parsed_source === 'rules' ? '⚙ Parser local' : item.ai_interpreted ? `✨ IA${item.ai_model ? ' · ' + item.ai_model : ''}` : '';
      if (source) row.append(node('p', source));
      if (item.ai_fallback_reason || item.reason) row.append(node('p', `Detalle: ${item.ai_fallback_reason || item.reason}`));
      const fields = node('div', undefined, 'learning-alias-fields');
      const fromLabel = node('label', 'Texto escrito (editable)'), from = node('input'); from.type = 'text'; from.maxLength = 60; from.value = suggestedAliasSource(item); fromLabel.append(from);
      const toLabel = node('label', 'Corrección para futuras búsquedas'), to = node('input'); to.type = 'text'; to.maxLength = 60; to.placeholder = 'Ej.: Ke Personajes'; toLabel.append(to);
      fields.append(fromLabel, toLabel); row.append(fields);
      const actions = node('div', undefined, 'learning-row-actions');
      actions.append(button('Guardar corrección', async event => {
        const save = event.currentTarget; save.disabled = true;
        try {
          const alias = await request('/api/spotify-aliases', { from: from.value, to: to.value });
          await request('/api/spotify-learning-inbox/review', { ids: [item.id] });
          notice(`Corrección guardada: ${alias.entry.from} → ${alias.entry.to}. Rulo la aplicará a próximos pedidos.`);
          await loadSpotifyLearningInbox();
        } catch (error) { notice('No se pudo guardar la corrección: ' + error.message, true); save.disabled = false; }
      }, 'primary'));
      actions.append(button('Marcar revisado', async event => {
        const review = event.currentTarget; review.disabled = true;
        try { await request('/api/spotify-learning-inbox/review', { ids: [item.id] }); notice('Pedido marcado como revisado.'); await loadSpotifyLearningInbox(); }
        catch (error) { notice('No se pudo marcar como revisado: ' + error.message, true); review.disabled = false; }
      }));
      row.append(actions); list.append(row);
    });
  }
  async function loadSpotifyLearningInbox() {
    const status = $('spotify-learning-status');
    try { renderSpotifyLearningInbox(await request('/api/spotify-learning-inbox?dias=90&limite=100')); }
    catch (error) { status.textContent = 'No se pudo cargar la bandeja: ' + error.message; }
  }
  $('refresh-spotify-learning').onclick = loadSpotifyLearningInbox;
  async function loadRuloDataBackups() {
    const list = $('rulo-data-backup-list'), status = $('rulo-data-backup-status');
    try {
      const data = await request('/api/rulo-data-backups');
      const backups = Array.isArray(data.backups) ? data.backups : [];
      list.replaceChildren();
      status.textContent = backups.length ? `${backups.length} respaldos disponibles · se conservan hasta ${data.retention || 7}.` : 'Todavía no hay respaldos guardados.';
      backups.forEach(backup => {
        const row = node('article', undefined, 'rulo-data-backup-row');
        const heading = node('strong', new Date(backup.createdAt || 0).toLocaleString('es') + ` · ${backup.reason || 'respaldo'}`);
        const detail = node('small', backup.hasSpotifyConfig ? 'Incluye ajustes, vocabulario, respuestas y correcciones de Spotify.' : 'Respaldo anterior: incluye historial, pero no ajustes de Spotify.');
        const restore = button(backup.hasSpotifyConfig ? 'Restaurar' : 'Solo historial', () => confirmAction(
          'Restaurar configuración de Rulo',
          `Se reemplazarán los ajustes, vocabulario, respuestas y correcciones guardados por los de ${new Date(backup.createdAt || 0).toLocaleString('es')}. Cortex creará primero un respaldo de seguridad. La clave de IA no se modifica.`,
          async () => {
            restore.disabled = true;
            try {
              const result = await request('/api/rulo-data-backup-restore', { name: backup.name });
              notice(`Configuración restaurada. Respaldo de seguridad: ${result.safetyBackup}.`);
              await Promise.all([loadRuloDataBackups(), loadSpotifyAiPriority(), loadSpotifyAiReplyOptions(), refreshOverview()]);
            } catch (error) { notice('No se pudo restaurar el respaldo: ' + error.message, true); restore.disabled = false; }
          }
        ));
        restore.disabled = !backup.hasSpotifyConfig;
        row.append(heading, detail, restore); list.append(row);
      });
    } catch (error) { status.textContent = 'No se pudo cargar la lista de respaldos: ' + error.message; }
  }
  $('create-rulo-data-backup').onclick = async event => {
    const button = event.currentTarget; button.disabled = true; button.textContent = 'Creando…';
    try { const result = await request('/api/rulo-data-backup', {}); notice(`Respaldo creado: ${result.name}.`); await loadRuloDataBackups(); }
    catch (error) { notice('No se pudo crear el respaldo: ' + error.message, true); }
    finally { button.disabled = false; button.textContent = 'Crear respaldo ahora'; }
  };
  $('refresh-rulo-data-backups').onclick = loadRuloDataBackups;
  const OVERVIEW_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  function overviewCacheKey(profile) { return `cortex-home-overview-v1:${profile}`; }
  function cachedOverviewFields(data) {
    const serviceRows = Array.isArray(data?.services) ? data.services.slice(0, 80) : [];
    const spotify = data?.chatBotSpotify || {};
    const playback = data?.spotifyPlayback || {};
    const track = playback.track || {};
    return {
      services: serviceRows.map(item => ({ id: String(item?.id || '').slice(0, 80), name: String(item?.name || '').slice(0, 120), status: String(item?.status || '').slice(0, 30) })),
      spotifyConnected: data?.spotifyConnected === true,
      chatBotSpotify: {
        reachable: spotify.reachable === true,
        moduleEnabled: spotify.moduleEnabled === true,
        connected: spotify.connected === true,
        cortexDashboardConnected: spotify.cortexDashboardConnected === true,
        captureFacebook: spotify.captureFacebook === true,
        enabled: spotify.enabled === true
      },
      ruloEnabled: data?.ruloEnabled !== false,
      spotifyAi: { enabled: data?.spotifyAi?.enabled === true, keyPresent: data?.spotifyAi?.keyPresent === true, model: String(data?.spotifyAi?.model || '').slice(0, 120) },
      spotifyDevice: String(data?.spotifyDevice || '').slice(0, 120),
      spotifyDeviceUpdatedAt: Number(data?.spotifyDeviceUpdatedAt) || 0,
      spotifyPlayback: {
        track: track.name || track.artist ? { name: String(track.name || '').slice(0, 160), artist: String(track.artist || '').slice(0, 160) } : null,
        isPlaying: playback.isPlaying === true,
        receivedAt: Number(playback.receivedAt) || 0
      },
      ruloOverlayClients: data?.ruloOverlayClients !== null && data?.ruloOverlayClients !== undefined && Number.isFinite(Number(data.ruloOverlayClients)) ? Number(data.ruloOverlayClients) : null,
      ruloBotOverlayClients: data?.ruloBotOverlayClients !== null && data?.ruloBotOverlayClients !== undefined && Number.isFinite(Number(data.ruloBotOverlayClients)) ? Number(data.ruloBotOverlayClients) : null,
      obsReachable: typeof data?.obsReachable === 'boolean' ? data.obsReachable : null,
      obsProgram: { enabledSources: Array.isArray(data?.obsProgram?.enabledSources) ? data.obsProgram.enabledSources.map(name => String(name).slice(0, 100)).slice(0, 80) : [] }
    };
  }
  function overviewEndpoint(profile = selectedStreamProfile()) { return '/api/cortex-home/overview?profile=' + encodeURIComponent(profile); }
  function overviewStatusTime(timestamp) {
    const date = new Date(timestamp), today = new Date();
    const time = date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    return date.toDateString() === today.toDateString() ? time : `${date.toLocaleDateString('es', { day: '2-digit', month: '2-digit' })} ${time}`;
  }
  function resetOverviewStatus() {
    services = [];
    servicesAreStale = false;
    ['health-services', 'health-spotify', 'health-obs', 'health-ai', 'health-device', 'health-rulo-overlay', 'health-playing'].forEach(id => { $(id).textContent = 'Comprobando…'; $(id).className = ''; });
    $('home-rulo-power').disabled = true;
    $('home-rulo-power-status').textContent = 'Consultando estado…';
    $('connection').style.color = '';
    $('connection').title = '';
    if (state) { renderCards(); renderPreflightServices(); }
  }
  function restoreCachedOverview() {
    const profile = selectedStreamProfile();
    overviewLastUpdatedAt = 0;
    resetOverviewStatus();
    try {
      const saved = JSON.parse(localStorage.getItem(overviewCacheKey(profile)) || 'null');
      if (!saved || saved.version !== 1 || !Number.isFinite(Number(saved.savedAt)) || !saved.data || Date.now() - Number(saved.savedAt) > OVERVIEW_CACHE_MAX_AGE_MS) return false;
      overviewLastUpdatedAt = Number(saved.savedAt);
      applyOverview(saved.data, { cached: true });
      if (state) { renderCards(); renderPreflightServices(); }
      $('connection').textContent = `Guardado · ${overviewStatusTime(overviewLastUpdatedAt)} · verificando`;
      $('connection').title = 'Última consulta exitosa de este perfil; la comprobación actual sigue en curso.';
      $('connection').style.color = '#946b2b';
      return true;
    } catch { return false; }
  }
  async function refreshOverview() {
    const profile = selectedStreamProfile();
    if (overviewRequests.has(profile)) return overviewRequests.get(profile);
    const pending = (async () => {
      try {
        const data = await request(overviewEndpoint(profile));
        const savedAt = Date.now();
        try { localStorage.setItem(overviewCacheKey(profile), JSON.stringify({ version: 1, savedAt, data: cachedOverviewFields(data) })); } catch { /* Cache opcional; el estado actual sigue disponible. */ }
        if (profile === selectedStreamProfile()) { overviewLastUpdatedAt = savedAt; applyOverview(data); }
        return data;
      } catch {
        if (profile === selectedStreamProfile()) {
          $('connection').textContent = 'Cortex sin conexión';
          $('connection').style.color = '#946b2b';
          if (overviewLastUpdatedAt) { $('connection').textContent += ` · guardado ${overviewStatusTime(overviewLastUpdatedAt)}`; $('connection').title = 'Se conserva el último estado disponible porque Cortex no respondió a esta consulta.'; }
          else ['health-services', 'health-spotify', 'health-obs', 'health-ai', 'health-device', 'health-rulo-overlay', 'health-playing'].forEach(id => { $(id).textContent = 'Sin datos'; $(id).className = 'health-attention'; });
        }
        return null;
      }
    })();
    overviewRequests.set(profile, pending);
    try { return await pending; }
    finally { if (overviewRequests.get(profile) === pending) overviewRequests.delete(profile); }
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
  const initialHomeUrl = new URL(location.href);
  if (initialHomeUrl.searchParams.get('view') === 'databases') {
    activeDatabaseTab = initialHomeUrl.searchParams.get('db') === 'lottery' ? 'lottery' : 'audience';
    document.querySelectorAll('[data-db-tab]').forEach(tab => {
      const selected = tab.dataset.dbTab === activeDatabaseTab;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    document.querySelectorAll('[data-db-panel]').forEach(panel => { panel.hidden = panel.dataset.dbPanel !== activeDatabaseTab; });
    switchView('databases');
  }
  $('search').oninput = () => state && renderCards(); $('category').onchange = () => state && render(); $('profile').onchange = () => activate($('profile').value);
  $('theme-toggle').onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  $('btn-refresh-obs').onclick = async event => {
    const button = event.currentTarget, label = button.querySelector('[data-label]');
    button.disabled = true;
    label.textContent = 'Recargando…';
    try {
      const result = await request('/api/obs/refresh-sources', {});
      const errors = Array.isArray(result.errors) ? result.errors.length : 0;
      const message = `OBS actualizado: se recargaron ${result.count || 0} fuentes de navegador${errors ? `; ${errors} tuvieron errores` : ''}.`;
      notice(message, errors > 0);
    } catch (error) {
      notice('No se pudieron recargar las fuentes de OBS: ' + error.message, true);
    } finally {
      button.disabled = false;
      label.textContent = 'Recargar Fuentes OBS';
    }
  };
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
  async function loadAudienceStatus() {
    const label = $('audience-archive-status');
    try {
      const data = await request('/api/cortex-home/audience-status');
      const summary = data.summary;
      label.textContent = !data.enabled ? 'Archivo no disponible' : summary ? `${summary.comments} comentarios · ${summary.people} personas · ${data.identity?.coveragePercent ?? 0}% con ID estable` : 'Archivo listo';
    } catch { label.textContent = 'No se pudo consultar el archivo'; }
  }
  $('audience-query-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    const answer = $('audience-answer');
    button.disabled = true; button.textContent = 'Consultando…'; answer.hidden = true;
    try {
      const data = await request('/api/cortex-home/audience-query', { question: $('audience-question').value });
      answer.textContent = data.answer + (data.ai === false ? '\n\nRespuesta estadística directa. La IA no respondió: ' + (data.note || 'no está configurada.') : ''); answer.hidden = false;
      if (data.ok) await loadAudienceStatus();
    } catch (error) { answer.textContent = error.message; answer.hidden = false; }
    finally { button.disabled = false; button.textContent = 'Consultar archivo'; }
  };
  document.querySelectorAll('[data-audience-question]').forEach(button => { button.onclick = () => { $('audience-question').value = button.dataset.audienceQuestion; $('audience-question').focus(); }; });
  $('audience-report-button').onclick = async () => {
    const button = $('audience-report-button'); const output = $('audience-report'); const status = $('audience-report-status');
    button.disabled = true; button.textContent = 'Preparando resumen…'; output.hidden = true; status.textContent = '';
    try { const result = await request('/api/cortex-home/audience-report'); output.textContent = result.answer; output.hidden = false; status.textContent = result.report ? `Programa ${result.report.program_date}` : 'Sin programas archivados'; }
    catch (error) { output.textContent = error.message; output.hidden = false; }
    finally { button.disabled = false; button.textContent = 'Resumen del último programa'; }
  };
  loadAudienceStatus();
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
    void request('/api/cortex-base-url').then(value => { base = value; }).catch(() => {});
    void refreshOverview();
    try {
      state = await request('/api/cortex-home');
      render(); applyStreamProfile(); $('profile').disabled = false;
      if ($('preflight-obs').checked) void loadObsScenes().then(() => applyStreamProfile()).catch(() => { /* La lista de escenas se cargará al preparar un directo. */ });
      void refreshObsLiveStatus();
    } catch (e) { notice('No se pudo cargar Inicio. Comprueba que Cortex esté iniciado y recarga la página. ' + e.message, true); }
  }
  restoreCachedOverview();
  loadGlobalTestMode();
  loadSpotifyAiPriority();
  loadSpotifyAiReplyOptions();
  loadSpotifyLearningInbox();
  window.addEventListener('focus', loadSpotifyAiPriority);
  window.addEventListener('focus', loadSpotifyAiReplyOptions);
  load();
  setInterval(refreshObsLiveStatus, 8000);
  setInterval(async () => {
    if (document.hidden || busy) return;
    if (state) {
      try { const latest = await request('/api/cortex-home'); state = latest; render(); $('connection').textContent = 'Cortex conectado'; $('connection').style.color = ''; }
      catch { $('connection').textContent = 'Sin conexión'; }
    }
    await refreshOverview();
  }, 20000);
})();
