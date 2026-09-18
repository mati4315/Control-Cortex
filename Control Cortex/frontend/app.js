// Configuration
const API_BASE_URL = window.location.origin.includes('http') ? window.location.origin : 'http://localhost:4000';
const WS_BASE_URL = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + (window.location.host || 'localhost:4000');

// App State
let services = [];
let selectedServiceId = null;
const logBuffers = {}; // Map of serviceId -> array of log objects
const maxLogBufferSize = 200; // Keep last 200 logs in memory per service

// Socket connection
let socket = null;

// DOM Elements
const servicesContainer = document.getElementById('services-container');
const terminalOutput = document.getElementById('terminal-output');
const terminalTabName = document.getElementById('terminal-tab-name');
const activeLogServiceName = document.getElementById('active-log-service-name');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnDownloadLogs = document.getElementById('btn-download-logs');
const chkAutoscroll = document.getElementById('chk-autoscroll');
const btnStartAll = document.getElementById('btn-start-all');
const btnStopAll = document.getElementById('btn-stop-all');

// Modal Elements
const addServiceModal = document.getElementById('add-service-modal');
const btnOpenAddModal = document.getElementById('btn-open-add-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const addServiceForm = document.getElementById('add-service-form');
const btnAddEnvRow = document.getElementById('btn-add-env-row');
const envRowsContainer = document.getElementById('env-rows');
const formErrorMsg = document.getElementById('form-error-msg');
const formSubmitSpinner = document.getElementById('form-submit-spinner');
const btnSubmitText = document.getElementById('btn-submit-text');

// System Stats Elements
const globalCpuFill = document.getElementById('global-cpu-fill');
const globalCpuVal = document.getElementById('global-cpu-val');
const globalRamFill = document.getElementById('global-ram-fill');
const globalRamVal = document.getElementById('global-ram-val');
const activeServicesCount = document.getElementById('active-services-count');
const totalServicesCount = document.getElementById('total-services-count');
const toastContainer = document.getElementById('toast-container');
const servicesCpuVal = document.getElementById('services-cpu-val');
const servicesRamVal = document.getElementById('services-ram-val');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  fetchServices();
  setupWebSocket();
  setupEventListeners();
});

// Event Listeners Setup
function setupEventListeners() {
  // Modal toggle
  btnOpenAddModal.addEventListener('click', () => {
    addServiceModal.classList.add('active');
    addServiceForm.reset();
    envRowsContainer.innerHTML = `
      <div class="env-row">
        <input type="text" class="env-key" placeholder="Key (ej. PORT)" value="PORT" autocomplete="off">
        <input type="text" class="env-val" placeholder="Value (ej. 3000)" autocomplete="off">
        <button type="button" class="btn-remove-env"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;
    setupRemoveEnvRowButtons();
  });

  const closeModal = () => {
    addServiceModal.classList.remove('active');
    formErrorMsg.style.display = 'none';
  };

  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);
  
  // Close modal when clicking outside content
  addServiceModal.addEventListener('click', (e) => {
    if (e.target === addServiceModal) closeModal();
  });

  // Dynamic environment variables addition
  btnAddEnvRow.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'env-row';
    row.innerHTML = `
      <input type="text" class="env-key" placeholder="Key" autocomplete="off">
      <input type="text" class="env-val" placeholder="Value" autocomplete="off">
      <button type="button" class="btn-remove-env"><i class="fa-solid fa-trash-can"></i></button>
    `;
    envRowsContainer.appendChild(row);
    setupRemoveEnvRowButtons();
  });

  // Add service form submission
  addServiceForm.addEventListener('submit', handleAddServiceSubmit);

  // Terminal actions
  btnClearLogs.addEventListener('click', () => {
    if (selectedServiceId) {
      logBuffers[selectedServiceId] = [];
      renderLogs();
    }
  });

  btnDownloadLogs.addEventListener('click', downloadActiveLogs);

  // Batch Actions
  if (btnStartAll) {
    btnStartAll.addEventListener('click', () => {
      if (confirm('¿Estás seguro de que deseas INICIAR todos los microservicios?')) {
        controlAllServices('start');
      }
    });
  }
  if (btnStopAll) {
    btnStopAll.addEventListener('click', () => {
      if (confirm('¿Estás seguro de que deseas DETENER todos los microservicios?')) {
        controlAllServices('stop');
      }
    });
  }

  // OBS Refresh Sources Buttons
  const btnRefreshObs = document.getElementById('btn-refresh-obs');
  if (btnRefreshObs) {
    btnRefreshObs.addEventListener('click', refreshObsBrowserSources);
  }
  const btnRefreshObsAction = document.getElementById('btn-refresh-obs-action');
  if (btnRefreshObsAction) {
    btnRefreshObsAction.addEventListener('click', refreshObsBrowserSources);
  }
}

// Function to send signal to OBS to refresh all browser sources without cache
async function refreshObsBrowserSources() {
  const btnHeader = document.getElementById('btn-refresh-obs');
  const btnAction = document.getElementById('btn-refresh-obs-action');
  
  const buttons = [btnHeader, btnAction].filter(Boolean);
  buttons.forEach(btn => {
    btn.disabled = true;
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'fa-solid fa-arrows-rotate fa-spin';
  });

  try {
    const res = await fetch(`${API_BASE_URL}/api/obs/refresh-sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    
    if (res.ok && data.success) {
      showToast(`¡OBS Actualizado! Se recargaron ${data.count} fuentes web (Banner, Clima, etc.)`, 'success');
    } else {
      throw new Error(data.details || data.error || 'No se pudo conectar con OBS');
    }
  } catch (err) {
    console.error('Error refreshing OBS sources:', err);
    showToast(`Error al refrescar OBS: ${err.message}`, 'danger');
  } finally {
    buttons.forEach(btn => {
      btn.disabled = false;
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-arrows-rotate';
    });
  }
}

// Remove env row binding
function setupRemoveEnvRowButtons() {
  document.querySelectorAll('.btn-remove-env').forEach(btn => {
    btn.onclick = (e) => {
      e.currentTarget.parentElement.remove();
    };
  });
}

// Toast notification helper
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconClass = 'fa-circle-check';
  if (type === 'danger') iconClass = 'fa-circle-xmark';
  if (type === 'warning') iconClass = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass} toast-icon"></i>
    <span>${message}</span>
  `;
  toastContainer.appendChild(toast);
  
  // Force reflow
  toast.offsetHeight;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// Fetch list of services from Backend API
async function fetchServices() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/services`);
    if (!response.ok) throw new Error('Error al cargar la lista de servicios');
    
    services = await response.ok ? await response.json() : [];
    
    // Initialize empty log buffers for new services
    services.forEach(service => {
      if (!logBuffers[service.id]) {
        logBuffers[service.id] = [];
      }
    });

    renderServicesGrid();
    updateHeaderStats();
  } catch (error) {
    console.error('Fetch services failed:', error);
    showToast(error.message, 'danger');
    servicesContainer.innerHTML = `
      <div class="loading-state">
        <i class="fa-solid fa-triangle-exclamation text-danger" style="font-size: 2rem;"></i>
        <p>No se pudo conectar con el servidor Control Cortex en ${API_BASE_URL}</p>
        <button class="btn btn-secondary btn-sm" onclick="fetchServices()">Reintentar</button>
      </div>
    `;
  }
}

// Render Services Cards inside Grid
function renderServicesGrid() {
  if (services.length === 0) {
    servicesContainer.innerHTML = '';
    renderSpotifyCard();
    return;
  }

  servicesContainer.innerHTML = '';
  services.forEach(service => {
    const card = document.createElement('div');
    const isSelected = service.id === selectedServiceId;
    
    card.className = `service-card status-${service.status} ${isSelected ? 'active-selected' : ''}`;
    card.id = `card-${service.id}`;
    card.setAttribute('data-id', service.id);

    // Format uptime
    let uptimeStr = 'Offline';
    if (service.status === 'online' && service.uptime > 0) {
      const sec = Math.floor(service.uptime / 1000);
      const hrs = Math.floor(sec / 3600);
      const mins = Math.floor((sec % 3600) / 60);
      const secs = sec % 60;
      uptimeStr = `${hrs > 0 ? hrs + 'h ' : ''}${mins > 0 ? mins + 'm ' : ''}${secs}s`;
    }

    // Format memory
    const memoryMB = service.memory ? (service.memory / (1024 * 1024)).toFixed(1) + ' MB' : '0 MB';

    // Dashboard button configuration
    const hasDashboard = !!service.dashboardUrl;
    const dashboardBtn = hasDashboard 
      ? `<a href="${service.dashboardUrl}" target="_blank" class="btn btn-secondary btn-icon" title="Abrir Panel" onclick="event.stopPropagation();">
          <i class="fa-solid fa-up-right-from-square"></i>
         </a>`
      : `<button class="btn btn-secondary btn-icon" disabled title="Sin dashboard web">
          <i class="fa-solid fa-up-right-from-square"></i>
         </button>`;

    // Status action controls
    let controlBtn = '';
    if (service.status === 'online') {
      controlBtn = `
        <button class="btn btn-danger btn-sm action-stop-btn" onclick="event.stopPropagation(); controlService('${service.id}', 'stop')">
          <i class="fa-solid fa-square"></i> Detener
        </button>
        <button class="btn btn-secondary btn-sm action-restart-btn" title="Reiniciar" onclick="event.stopPropagation(); controlService('${service.id}', 'restart')">
          <i class="fa-solid fa-arrows-rotate"></i>
        </button>
      `;
    } else {
      controlBtn = `
        <button class="btn btn-success btn-sm action-start-btn" onclick="event.stopPropagation(); controlService('${service.id}', 'start')">
          <i class="fa-solid fa-play"></i> Iniciar
        </button>
      `;
    }

    card.innerHTML = `
      <div class="card-top">
        <div class="card-title-info">
          <h3>${service.name}</h3>
          <span class="card-desc">${service.description || 'Sin descripción'}</span>
        </div>
        <span class="card-status status-badge-${service.status}">
          <i class="fa-solid fa-circle" style="font-size: 0.5rem; margin-right: 4px;"></i> ${service.status}
        </span>
      </div>

      <div class="card-middle">
        <div class="metric-item">
          <span class="metric-label">CPU</span>
          <span class="metric-val" id="cpu-${service.id}">${service.status === 'online' ? service.cpu + '%' : '0%'}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Memoria</span>
          <span class="metric-val" id="mem-${service.id}">${service.status === 'online' ? memoryMB : '0 MB'}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Uptime</span>
          <span class="metric-val" id="uptime-${service.id}">${uptimeStr}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Restarts</span>
          <span class="metric-val" id="restarts-${service.id}">${service.status === 'online' ? service.restarts : '0'}</span>
        </div>
      </div>

      <div class="card-actions">
        <div class="action-buttons">
          ${controlBtn}
          ${dashboardBtn}
        </div>
        <button class="btn btn-icon btn-secondary btn-delete" title="Eliminar servicio" onclick="event.stopPropagation(); confirmDeleteService('${service.id}', '${service.name}')">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    // Click behavior to show console logs
    card.addEventListener('click', () => selectServiceForLogs(service.id));
    servicesContainer.appendChild(card);
  });

  // Inject Spotify card at the end of the grid
  renderSpotifyCard();
}

// ─── Spotify Card ─────────────────────────────────────────────────────────────
const SPOTIFY_STORAGE_KEY = 'cortex_spotify_config';
// URL base de Cortex: se resuelve desde /api/cortex-base-url (IP LAN detectada por el backend).
// El valor inicial es solo respaldo si el endpoint no responde.
let CORTEX_BASE_URL     = 'http://192.168.4.100:4000';
let SPOTIFY_BASE_URL    = CORTEX_BASE_URL + '/ssn/spotify-overlay.html';
let SPOTIFY_LYRICS_URL  = CORTEX_BASE_URL + '/spotify-lyrics-overlay.html';
let RULO_OVERLAY_URL    = CORTEX_BASE_URL + '/rulo-bot-overlay.html';
let RULO_CHAT_DOCK_URL  = CORTEX_BASE_URL + '/rulo-chat-historial.html';
let RULO_DASHBOARD_URL  = CORTEX_BASE_URL + '/rulo-dashboard.html';

function applyCortexBaseUrl(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(clean)) return false;
  CORTEX_BASE_URL    = clean;
  SPOTIFY_BASE_URL   = CORTEX_BASE_URL + '/ssn/spotify-overlay.html';
  SPOTIFY_LYRICS_URL = CORTEX_BASE_URL + '/spotify-lyrics-overlay.html';
  RULO_OVERLAY_URL   = CORTEX_BASE_URL + '/rulo-bot-overlay.html';
  RULO_CHAT_DOCK_URL = CORTEX_BASE_URL + '/rulo-chat-historial.html';
  RULO_DASHBOARD_URL = CORTEX_BASE_URL + '/rulo-dashboard.html';
  return true;
}

fetch('/api/cortex-base-url')
  .then(r => r.json())
  .then(data => {
    if (!data || !applyCortexBaseUrl(data.baseUrl)) return;
    if (document.getElementById('card-spotify')) renderSpotifyCard();
  })
  .catch(() => {});

function loadSpotifyConfig() {
  try { return JSON.parse(localStorage.getItem(SPOTIFY_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveSpotifyConfig(cfg) {
  localStorage.setItem(SPOTIFY_STORAGE_KEY, JSON.stringify(cfg));
}

function buildSpotifyOverlayUrl(cfg) {
  const session = (cfg.sessionId || '').trim();
  if (!session) return '';

  const base = cfg.showlyrics ? SPOTIFY_LYRICS_URL : SPOTIFY_BASE_URL;
  const flags = [];
  if (cfg.hidepaused)   flags.push('hidepaused');
  if (cfg.hideinactive) flags.push('hideinactive');
  if (cfg.hideart)      flags.push('hideart');
  if (cfg.hidealbum)    flags.push('hidealbum');
  if (cfg.hideprogress) flags.push('hideprogress');
  if (cfg.hidedevice)   flags.push('hidedevice');
  if (cfg.hidestatus)   flags.push('hidestatus');
  if (cfg.compact)      flags.push('compact');
  if (cfg.showqueue)    flags.push('showqueue');
  if (cfg.showlyrics)   flags.push('lyrics');
  if (cfg.showlyrics)   flags.push('cortexrelay');

  let qs = `session=${encodeURIComponent(session)}`;
  qs += `&ln=${encodeURIComponent(cfg.lang || 'es')}`;
  flags.forEach(f => { qs += `&${f}`; });
  if (cfg.style && cfg.style !== 'spotify') qs += `&style=${encodeURIComponent(cfg.style)}`;
  if (cfg.accent && cfg.accent !== '#1db954') qs += `&accent=${encodeURIComponent(cfg.accent)}`;

  return `${base}?${qs}`;
}

function buildRuloOverlayUrl(cfg) {
  const session = (cfg.sessionId || '').trim();
  return session ? `${RULO_OVERLAY_URL}?session=${encodeURIComponent(session)}` : '';
}

function renderSpotifyCard() {
  document.getElementById('card-spotify')?.remove();
  const cfg = loadSpotifyConfig();
  const overlayUrl = buildSpotifyOverlayUrl(cfg);
  const ruloUrl = buildRuloOverlayUrl(cfg);

  const card = document.createElement('div');
  card.className = 'service-card spotify-card';
  card.id = 'card-spotify';

  card.innerHTML = `
    <div class="card-top">
      <div class="card-title-info">
        <h3><i class="fa-brands fa-spotify" style="color:#1db954;margin-right:6px;"></i>Spotify Now Playing</h3>
        <span class="card-desc">Overlay de canción actual para OBS via SocialStream Ninja</span>
      </div>
      <span class="card-status status-badge-spotify">
        <i class="fa-solid fa-circle" style="font-size:0.5rem;margin-right:4px;"></i> hosteado
      </span>
    </div>

    <div class="spotify-config">
      <div class="spotify-fields">
        <div class="spotify-field-group">
          <label>Session ID <small>(de SocialStream Ninja)</small></label>
          <input type="text" id="sp-session"
            placeholder="ej: XJ9hQ2JDHH"
            value="${escapeHTML(cfg.sessionId || '')}"
            onclick="event.stopPropagation()" />
        </div>
        <div class="spotify-field-group">
          <label>Idioma</label>
          <select id="sp-lang" onclick="event.stopPropagation()">
            <option value="es" ${(!cfg.lang||cfg.lang==='es')?'selected':''}>Español (es)</option>
            <option value="en" ${cfg.lang==='en'?'selected':''}>English (en)</option>
            <option value="pt" ${cfg.lang==='pt'?'selected':''}>Português (pt)</option>
          </select>
        </div>
      </div>

      <div class="spotify-device-target">
        <div class="spotify-field-group">
          <label>Dispositivo que debe reproducir <small>(vacío = automático)</small></label>
          <input type="text" id="sp-device-target"
            placeholder="Ej: PC OBS o NOTEBOOK-MATI"
            value="${escapeHTML(cfg.deviceTargetName || '')}"
            onclick="event.stopPropagation()" />
        </div>
        <div class="sp-device-help">
          <i class="fa-solid fa-circle-info"></i>
          Escribí el nombre exacto o una parte del nombre que aparece en <strong>!spotifydevices</strong>. Se usa para evitar que el pedido cambie la PC equivocada.
        </div>
      </div>

      <div class="spotify-options-grid">
        <label class="sp-opt"><input type="checkbox" id="sp-hidepaused"   ${cfg.hidepaused   ? 'checked':''} onclick="event.stopPropagation()"> Ocultar si pausado</label>
        <label class="sp-opt"><input type="checkbox" id="sp-hideinactive" ${cfg.hideinactive ? 'checked':''} onclick="event.stopPropagation()"> Ocultar si inactivo</label>
        <label class="sp-opt"><input type="checkbox" id="sp-hideart"      ${cfg.hideart      ? 'checked':''} onclick="event.stopPropagation()"> Sin carátula</label>
        <label class="sp-opt"><input type="checkbox" id="sp-hidealbum"    ${cfg.hidealbum    ? 'checked':''} onclick="event.stopPropagation()"> Sin álbum</label>
        <label class="sp-opt"><input type="checkbox" id="sp-hideprogress" ${cfg.hideprogress ? 'checked':''} onclick="event.stopPropagation()"> Sin barra progreso</label>
        <label class="sp-opt"><input type="checkbox" id="sp-hidedevice"   ${cfg.hidedevice   ? 'checked':''} onclick="event.stopPropagation()"> Sin dispositivo</label>
        <label class="sp-opt"><input type="checkbox" id="sp-hidestatus"   ${cfg.hidestatus   ? 'checked':''} onclick="event.stopPropagation()"> Sin estado</label>
        <label class="sp-opt"><input type="checkbox" id="sp-compact"      ${cfg.compact      ? 'checked':''} onclick="event.stopPropagation()"> Compacto</label>
        <label class="sp-opt"><input type="checkbox" id="sp-showqueue"    ${cfg.showqueue    ? 'checked':''} onclick="event.stopPropagation()"> Mostrar cola</label>
        <label class="sp-opt" style="color:#1db954;font-weight:600;"><input type="checkbox" id="sp-showlyrics" ${cfg.showlyrics ? 'checked':''} onclick="event.stopPropagation()"> 🎵 Letras sincronizadas</label>
        <label class="sp-opt sp-offset-opt" style="color:#1db954;font-weight:600;"><input type="checkbox" id="sp-skiptenseconds" ${cfg.skipTenSeconds ? 'checked':''} onclick="event.stopPropagation()"> Quitar los <input type="number" id="sp-skipseconds" min="1" max="120" step="1" value="${Number(cfg.skipSeconds) > 0 ? Math.min(120, Math.round(Number(cfg.skipSeconds))) : 10}" onclick="event.stopPropagation()"> segundos</label>
      </div>

      <div class="spotify-style-row">
        <div class="spotify-field-group" style="flex:1">
          <label>Tema / Estilo</label>
          <select id="sp-style" onclick="event.stopPropagation()">
            <option value="spotify" ${(!cfg.style||cfg.style==='spotify')?'selected':''}>Spotify (default)</option>
            <option value="minimal" ${cfg.style==='minimal'?'selected':''}>Minimal</option>
            <option value="glass"   ${cfg.style==='glass'  ?'selected':''}>Glass</option>
            <option value="comic"   ${cfg.style==='comic'  ?'selected':''}>Comic</option>
            <option value="ticker"  ${cfg.style==='ticker' ?'selected':''}>Ticker (horizontal)</option>
          </select>
        </div>
        <div class="spotify-field-group sp-accent-group">
          <label>Color acento</label>
          <input type="color" id="sp-accent"
            value="${cfg.accent || '#1db954'}"
            onclick="event.stopPropagation()" />
        </div>
      </div>

      <div class="spotify-url-box" id="sp-url-row" style="${overlayUrl ? '' : 'display:none'}">
        <span class="sp-url-label">URL para OBS Browser Source:</span>
        <div class="sp-url-line">
          <code id="sp-url-text">${escapeHTML(overlayUrl)}</code>
          <button class="btn btn-secondary btn-sm" title="Copiar URL" onclick="event.stopPropagation(); copySpotifyUrl()">
            <i class="fa-solid fa-copy"></i>
          </button>
          <a class="btn btn-secondary btn-sm" href="${escapeHTML(overlayUrl)}" target="_blank"
             id="sp-open-btn" title="Abrir overlay en el navegador" onclick="event.stopPropagation()">
            <i class="fa-solid fa-up-right-from-square"></i>
          </a>
        </div>
        <div class="sp-obs-hint">
          <i class="fa-solid fa-circle-info"></i>
          En OBS: Agregar fuente → <strong>Navegador</strong> → pegar URL arriba. Ancho: <strong>900px</strong>, Alto: <strong>130px</strong>.
        </div>
      </div>
      <div class="spotify-url-box" id="sp-url-empty" style="${overlayUrl ? 'display:none' : ''}">
        <span style="color:#888;font-size:0.82rem;">
          <i class="fa-solid fa-circle-info" style="margin-right:4px;color:#1db954;"></i>
          Ingresá tu Session ID y hacé clic en <strong>Guardar</strong> para generar la URL.
        </span>
      </div>

      <div class="spotify-url-box rulo-url-box">
        <span class="sp-url-label"><i class="fa-solid fa-wand-magic-sparkles" style="color:#9fd50b;margin-right:4px;"></i>Rulo: respuestas de Anormalia</span>
        <div class="sp-url-line">
          <span class="sp-rulo-url-kind">Dashboard:</span>
          <code id="rulo-dashboard-url">${escapeHTML(RULO_DASHBOARD_URL)}</code>
          <button class="btn btn-secondary btn-sm" title="Copiar dashboard de Rulo" onclick="event.stopPropagation(); copyTextToClipboard('${RULO_DASHBOARD_URL}', 'Dashboard de Rulo copiado')"><i class="fa-solid fa-copy"></i></button>
          <a class="btn btn-secondary btn-sm" href="${RULO_DASHBOARD_URL}" target="_blank" title="Abrir dashboard de Rulo" onclick="event.stopPropagation()"><i class="fa-solid fa-up-right-from-square"></i></a>
        </div>
        <div class="sp-url-line" id="rulo-overlay-row" style="${ruloUrl ? '' : 'display:none'}">
          <span class="sp-rulo-url-kind">OBS:</span>
          <code id="rulo-overlay-url">${escapeHTML(ruloUrl)}</code>
          <button class="btn btn-secondary btn-sm" title="Copiar overlay de Rulo" onclick="event.stopPropagation(); copyRuloUrl()"><i class="fa-solid fa-copy"></i></button>
          <a class="btn btn-secondary btn-sm" id="rulo-overlay-open" href="${escapeHTML(ruloUrl)}" target="_blank" title="Abrir overlay de Rulo" onclick="event.stopPropagation()"><i class="fa-solid fa-up-right-from-square"></i></a>
        </div>
        <div class="sp-url-line">
          <span class="sp-rulo-url-kind">Historial:</span>
          <code>${RULO_CHAT_DOCK_URL}</code>
          <button class="btn btn-secondary btn-sm" title="Copiar dock de Rulo" onclick="event.stopPropagation(); copyTextToClipboard('${RULO_CHAT_DOCK_URL}', 'Dock de Rulo copiado')"><i class="fa-solid fa-copy"></i></button>
          <a class="btn btn-secondary btn-sm" href="${RULO_CHAT_DOCK_URL}" target="_blank" title="Abrir dock de Rulo" onclick="event.stopPropagation()"><i class="fa-solid fa-up-right-from-square"></i></a>
        </div>
        <div class="sp-obs-hint"><i class="fa-solid fa-circle-info"></i> Rulo muestra solamente las respuestas del bot y tiene diseño configurable independiente.</div>
      </div>
    </div>

    <div class="card-actions" style="margin-top:10px;">
      <div class="action-buttons">
        <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); saveAndBuildSpotify()">
          <i class="fa-solid fa-floppy-disk"></i> Guardar
        </button>
        <a href="https://socialstream.ninja/spotify.html" target="_blank"
           class="btn btn-secondary btn-sm"
           title="Abrir configuración de Spotify en SSN"
           onclick="event.stopPropagation()">
          <i class="fa-brands fa-spotify"></i> Config SSN
        </a>
      </div>
    </div>
  `;

  servicesContainer.appendChild(card);
}

function saveAndBuildSpotify() {
  const cfg = {
    sessionId:    (document.getElementById('sp-session')?.value      || '').trim(),
    lang:         document.getElementById('sp-lang')?.value           || 'es',
    hidepaused:   document.getElementById('sp-hidepaused')?.checked   || false,
    hideinactive: document.getElementById('sp-hideinactive')?.checked || false,
    hideart:      document.getElementById('sp-hideart')?.checked      || false,
    hidealbum:    document.getElementById('sp-hidealbum')?.checked    || false,
    hideprogress: document.getElementById('sp-hideprogress')?.checked || false,
    hidedevice:   document.getElementById('sp-hidedevice')?.checked   || false,
    hidestatus:   document.getElementById('sp-hidestatus')?.checked   || false,
    compact:      document.getElementById('sp-compact')?.checked      || false,
    showqueue:    document.getElementById('sp-showqueue')?.checked    || false,
    showlyrics:   document.getElementById('sp-showlyrics')?.checked   || false,
    style:        document.getElementById('sp-style')?.value          || 'spotify',
    accent:       document.getElementById('sp-accent')?.value         || '#1db954',
    deviceTargetName: (document.getElementById('sp-device-target')?.value || '').trim(),
    skipTenSeconds: document.getElementById('sp-skiptenseconds')?.checked || false,
    skipSeconds: Math.min(120, Math.max(1, Math.round(Number(document.getElementById('sp-skipseconds')?.value) || 10))),
  };
  saveSpotifyConfig(cfg);

  fetch('/api/spotify-device-target', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName: cfg.deviceTargetName })
  }).catch(() => showToast('No se pudo guardar el dispositivo de Spotify en Cortex.', 'warning'));

  fetch('/api/spotify-playback-offset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: cfg.skipTenSeconds, seconds: cfg.skipSeconds })
  }).catch(() => showToast('No se pudo guardar el salto configurable.', 'warning'));

  const url      = buildSpotifyOverlayUrl(cfg);
  const urlRow   = document.getElementById('sp-url-row');
  const emptyRow = document.getElementById('sp-url-empty');
  const urlText  = document.getElementById('sp-url-text');
  const openBtn  = document.getElementById('sp-open-btn');
  const ruloUrlRow = document.getElementById('rulo-overlay-row');
  const ruloUrlText = document.getElementById('rulo-overlay-url');
  const ruloOpenBtn = document.getElementById('rulo-overlay-open');

  if (url) {
    if (urlText)  urlText.textContent    = url;
    if (openBtn)  openBtn.href           = url;
    if (urlRow)   urlRow.style.display   = '';
    if (emptyRow) emptyRow.style.display = 'none';
  } else {
    if (urlRow)   urlRow.style.display   = 'none';
    if (emptyRow) emptyRow.style.display = '';
  }
  if (ruloUrl) {
    if (ruloUrlText) ruloUrlText.textContent = ruloUrl;
    if (ruloOpenBtn) ruloOpenBtn.href = ruloUrl;
    if (ruloUrlRow) ruloUrlRow.style.display = '';
  } else if (ruloUrlRow) {
    ruloUrlRow.style.display = 'none';
  }

  showToast('Configuración de Spotify guardada ✓', 'success');
}

function copySpotifyUrl() {
  const url = document.getElementById('sp-url-text')?.textContent || '';
  if (!url) return;
  navigator.clipboard.writeText(url)
    .then(()  => showToast('URL copiada al portapapeles 📋', 'success'))
    .catch(()  => showToast('No se pudo copiar. Copiala manualmente.', 'warning'));
}

function copyTextToClipboard(value, message) {
  if (!value) return;
  navigator.clipboard.writeText(value)
    .then(() => showToast(message || 'Copiado al portapapeles', 'success'))
    .catch(() => showToast('No se pudo copiar. Copialo manualmente.', 'warning'));
}

function copyRuloUrl() {
  copyTextToClipboard(document.getElementById('rulo-overlay-url')?.textContent || '', 'URL de Rulo copiada');
}
// ─── Fin Spotify Card ─────────────────────────────────────────────────────────

// Select a service and display its logs
function selectServiceForLogs(serviceId) {
  selectedServiceId = serviceId;
  const service = services.find(s => s.id === serviceId);
  
  if (!service) return;

  // Visual selection indicators
  document.querySelectorAll('.service-card').forEach(card => card.classList.remove('active-selected'));
  const selectedCard = document.getElementById(`card-${serviceId}`);
  if (selectedCard) selectedCard.classList.add('active-selected');

  // Update console headers
  terminalTabName.textContent = `${service.id}.log`;
  activeLogServiceName.textContent = service.name;
  btnDownloadLogs.removeAttribute('disabled');

  // Render inline control buttons for this service
  renderSelectedServiceControls(service);

  renderLogs();
}

// Render Start / Stop / Restart / Delete buttons in the console panel for the selected service
function renderSelectedServiceControls(service) {
  const container = document.getElementById('selected-service-controls');
  if (!container) return;

  const isOnline = service.status === 'online';
  const isRestarting = service.status === 'restarting';
  const escapedName = service.name.replace(/'/g, "\\'");

  container.innerHTML = `
    ${ isOnline || isRestarting
      ? `<button class="btn btn-danger btn-sm console-ctrl-btn" id="console-btn-stop"
            onclick="controlService('${service.id}', 'stop')" title="Detener servicio">
            <i class="fa-solid fa-square"></i> Detener
          </button>
          <button class="btn btn-secondary btn-sm console-ctrl-btn" id="console-btn-restart"
            onclick="controlService('${service.id}', 'restart')" title="Reiniciar servicio">
            <i class="fa-solid fa-arrows-rotate"></i> Reiniciar
          </button>`
      : `<button class="btn btn-success btn-sm console-ctrl-btn" id="console-btn-start"
            onclick="controlService('${service.id}', 'start')" title="Iniciar servicio">
            <i class="fa-solid fa-play"></i> Iniciar
          </button>`
    }
    <button class="btn btn-secondary btn-sm console-ctrl-btn btn-delete" id="console-btn-delete"
      onclick="confirmDeleteService('${service.id}', '${escapedName}')" title="Eliminar servicio">
      <i class="fa-solid fa-trash-can"></i> Eliminar
    </button>
  `;
}

// Render active logs in terminal
function renderLogs() {
  terminalOutput.innerHTML = '';
  
  const logs = logBuffers[selectedServiceId] || [];
  
  if (logs.length === 0) {
    terminalOutput.innerHTML = `
      <div class="log-line log-system">
        <span class="log-time">[${new Date().toLocaleTimeString()}]</span> [Cortex] Esperando logs o eventos de PM2 para este servicio...
      </div>
    `;
    return;
  }

  logs.forEach(log => {
    const logLine = document.createElement('div');
    logLine.className = `log-line log-${log.stream}`;
    
    // Format timestamp nicely
    const timeStr = new Date(log.timestamp).toLocaleTimeString();
    
    logLine.innerHTML = `<span class="log-time">[${timeStr}]</span> ${escapeHTML(log.message.trim())}`;
    terminalOutput.appendChild(logLine);
  });

  if (chkAutoscroll.checked) {
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }
}

// Control Service Actions: start, stop, restart
async function controlService(id, action) {
  try {
    const card = document.getElementById(`card-${id}`);
    const btns = card.querySelectorAll('button:not(.btn-delete)');
    btns.forEach(btn => btn.setAttribute('disabled', 'true'));

    showToast(`Ejecutando acción "${action}" en ${id}...`, 'warning');

    const response = await fetch(`${API_BASE_URL}/api/services/${id}/${action}`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || `Error al ejecutar ${action}`);
    }

    showToast(`Acción "${action}" completada con éxito.`, 'success');
  } catch (error) {
    console.error('Control service failed:', error);
    showToast(error.message, 'danger');
  } finally {
    // Re-enable state check after a tiny delay
    setTimeout(() => {
      fetchServices();
    }, 1000);
  }
}

// Control all services in batch (start-all, stop-all)
async function controlAllServices(action) {
  try {
    showToast(`Ejecutando acción "${action === 'start' ? 'Iniciar Todos' : 'Detener Todos'}"...`, 'warning');
    
    if (btnStartAll) btnStartAll.setAttribute('disabled', 'true');
    if (btnStopAll) btnStopAll.setAttribute('disabled', 'true');

    const response = await fetch(`${API_BASE_URL}/api/services/${action}-all`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || `Error al ejecutar ${action} todos`);
    }

    showToast(`Acción "${action === 'start' ? 'Iniciar Todos' : 'Detener Todos'}" completada con éxito.`, 'success');
  } catch (error) {
    console.error(`Batch action ${action} failed:`, error);
    showToast(error.message, 'danger');
  } finally {
    if (btnStartAll) btnStartAll.removeAttribute('disabled');
    if (btnStopAll) btnStopAll.removeAttribute('disabled');
    setTimeout(() => {
      fetchServices();
    }, 1000);
  }
}

// Trigger browser download of logs
function downloadActiveLogs() {
  if (!selectedServiceId) return;
  const service = services.find(s => s.id === selectedServiceId);
  const logs = logBuffers[selectedServiceId] || [];
  
  if (logs.length === 0) {
    showToast('La consola está vacía.', 'warning');
    return;
  }

  const logText = logs.map(l => `[${l.timestamp}] [${l.stream.toUpperCase()}] ${l.message.trim()}`).join('\n');
  const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `logs-${service.id}-${new Date().toISOString().slice(0,10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Delete Service confirmation & call
function confirmDeleteService(id, name) {
  if (confirm(`¿Estás seguro de que quieres eliminar el servicio "${name}"? Se detendrá la ejecución en PM2 si está activo y se removerá de la lista.`)) {
    deleteService(id);
  }
}

async function deleteService(id) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/services/${id}`, {
      method: 'DELETE'
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Error al eliminar el servicio');

    showToast(`Servicio eliminado correctamente.`, 'success');
    
    if (selectedServiceId === id) {
      selectedServiceId = null;
      activeLogServiceName.textContent = 'Selecciona un servicio';
      terminalTabName.textContent = 'bash';
      btnDownloadLogs.setAttribute('disabled', 'true');
      const ctrlContainer = document.getElementById('selected-service-controls');
      if (ctrlContainer) ctrlContainer.innerHTML = '';
      terminalOutput.innerHTML = `
        <div class="console-placeholder">
          <i class="fa-solid fa-keyboard placeholder-icon"></i>
          <p>Selecciona un servicio de la lista de la izquierda para ver su output en tiempo real.</p>
        </div>
      `;
    }

    fetchServices();
  } catch (error) {
    console.error('Delete service failed:', error);
    showToast(error.message, 'danger');
  }
}

// Submit Handlers for Adding Microservices
async function handleAddServiceSubmit(e) {
  e.preventDefault();
  formErrorMsg.style.display = 'none';
  btnSubmitText.style.display = 'none';
  formSubmitSpinner.style.display = 'inline-block';

  try {
    const id = document.getElementById('srv-id').value.trim();
    const name = document.getElementById('srv-name').value.trim();
    const description = document.getElementById('srv-desc').value.trim();
    const directory = document.getElementById('srv-dir').value.trim();
    const script = document.getElementById('srv-script').value.trim();
    const dashboardUrl = document.getElementById('srv-url').value.trim();

    // Reconstruct env vars
    const env = {};
    document.querySelectorAll('.env-row').forEach(row => {
      const key = row.querySelector('.env-key').value.trim();
      const val = row.querySelector('.env-val').value.trim();
      if (key) {
        env[key] = val;
      }
    });

    const payload = { id, name, description, directory, script, dashboardUrl, env };

    const response = await fetch(`${API_BASE_URL}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Error al guardar el microservicio');
    }

    showToast(`Servicio "${name}" registrado con éxito.`, 'success');
    addServiceModal.classList.remove('active');
    fetchServices();
  } catch (error) {
    console.error('Save service failed:', error);
    formErrorMsg.textContent = error.message;
    formErrorMsg.style.display = 'block';
  } finally {
    btnSubmitText.style.display = 'inline-block';
    formSubmitSpinner.style.display = 'none';
  }
}

// WebSocket connection setup
function setupWebSocket() {
  socket = new WebSocket(WS_BASE_URL);

  socket.onopen = () => {
    console.log('Control Cortex WebSocket connected');
    showToast('Conectado al servidor de orquestación en tiempo real.', 'success');
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'metrics':
          handleWebSocketMetrics(data);
          break;
        case 'log':
          handleWebSocketLog(data);
          break;
        case 'status_change':
          handleWebSocketStatusChange(data);
          break;
        case 'service_added':
        case 'service_deleted':
          fetchServices();
          break;
      }
    } catch (e) {
      console.error('Error parsing WS message:', e);
    }
  };

  socket.onclose = () => {
    console.warn('Control Cortex WebSocket connection closed. Attempting reconnect in 5s...');
    showToast('Conexión perdida con el backend de orquestación. Reintentando...', 'warning');
    setTimeout(setupWebSocket, 5000);
  };

  socket.onerror = (err) => {
    console.error('WS Connection error:', err);
    socket.close();
  };
}

// Real-time system and service metrics processing
function handleWebSocketMetrics(data) {
  // Update Global Header Stats
  const sys = data.system;
  globalCpuFill.style.width = `${sys.cpuPercentage}%`; // Optional load percentage
  globalCpuVal.textContent = `${sys.cpuPercentage > 0 ? sys.cpuPercentage : 'CPU Activa'}`;
  
  // Calculate system memory usage
  globalRamFill.style.width = `${sys.memoryPercentage.toFixed(0)}%`;
  globalRamVal.textContent = `${sys.memoryPercentage.toFixed(0)}% (${(sys.totalMemoryGB - sys.freeMemoryGB).toFixed(1)}GB / ${parseFloat(sys.totalMemoryGB).toFixed(0)}GB)`;

  // Update specific process metrics on the cards
  const servicesMetrics = data.services;
  
  servicesMetrics.forEach(metric => {
    const service = services.find(s => s.id === metric.id);
    if (!service) return;

    // Mutate state memory
    service.status = metric.status;
    service.cpu = metric.cpu;
    service.memory = metric.memory;
    service.uptime = metric.uptime;
    service.restarts = metric.restarts;

    // Direct DOM updates to avoid full rendering cycles
    const cpuEl = document.getElementById(`cpu-${metric.id}`);
    const memEl = document.getElementById(`mem-${metric.id}`);
    const uptimeEl = document.getElementById(`uptime-${metric.id}`);
    const restartsEl = document.getElementById(`restarts-${metric.id}`);
    const cardEl = document.getElementById(`card-${metric.id}`);

    if (cpuEl) cpuEl.textContent = metric.status === 'online' ? metric.cpu + '%' : '0%';
    if (memEl) {
      const memoryMB = metric.memory ? (metric.memory / (1024 * 1024)).toFixed(1) + ' MB' : '0 MB';
      memEl.textContent = metric.status === 'online' ? memoryMB : '0 MB';
    }
    if (uptimeEl) {
      let uptimeStr = 'Offline';
      if (metric.status === 'online' && metric.uptime > 0) {
        const sec = Math.floor(metric.uptime / 1000);
        const hrs = Math.floor(sec / 3600);
        const mins = Math.floor((sec % 3600) / 60);
        const secs = sec % 60;
        uptimeStr = `${hrs > 0 ? hrs + 'h ' : ''}${mins > 0 ? mins + 'm ' : ''}${secs}s`;
      }
      uptimeEl.textContent = uptimeStr;
    }
    if (restartsEl) restartsEl.textContent = metric.status === 'online' ? metric.restarts : '0';

    // Synchronize Card border classes and badge
    if (cardEl) {
      // Clean previous status classes
      cardEl.className = cardEl.className
        .replace(/status-\w+/g, '')
        .trim();
      cardEl.classList.add(`status-${metric.status}`);
      
      const badge = cardEl.querySelector('.card-status');
      if (badge) {
        badge.className = `card-status status-badge-${metric.status}`;
        badge.innerHTML = `<i class="fa-solid fa-circle" style="font-size: 0.5rem; margin-right: 4px;"></i> ${metric.status}`;
      }

      // Check if button states need updating without full render
      const actionContainer = cardEl.querySelector('.action-buttons');
      const hasOnlineBtns = !!cardEl.querySelector('.action-stop-btn');
      
      if (metric.status === 'online' && !hasOnlineBtns) {
        // Switch to Stop/Restart controls
        actionContainer.innerHTML = `
          <button class="btn btn-danger btn-sm action-stop-btn" onclick="event.stopPropagation(); controlService('${metric.id}', 'stop')">
            <i class="fa-solid fa-square"></i> Detener
          </button>
          <button class="btn btn-secondary btn-sm action-restart-btn" title="Reiniciar" onclick="event.stopPropagation(); controlService('${metric.id}', 'restart')">
            <i class="fa-solid fa-arrows-rotate"></i>
          </button>
          ${service.dashboardUrl ? `<a href="${service.dashboardUrl}" target="_blank" class="btn btn-secondary btn-icon" title="Abrir Panel" onclick="event.stopPropagation();"><i class="fa-solid fa-up-right-from-square"></i></a>` : `<button class="btn btn-secondary btn-icon" disabled><i class="fa-solid fa-up-right-from-square"></i></button>`}
        `;
      } else if (metric.status !== 'online' && hasOnlineBtns) {
        // Switch to Start controls
        actionContainer.innerHTML = `
          <button class="btn btn-success btn-sm action-start-btn" onclick="event.stopPropagation(); controlService('${metric.id}', 'start')">
            <i class="fa-solid fa-play"></i> Iniciar
          </button>
          ${service.dashboardUrl ? `<a href="${service.dashboardUrl}" target="_blank" class="btn btn-secondary btn-icon" title="Abrir Panel" onclick="event.stopPropagation();"><i class="fa-solid fa-up-right-from-square"></i></a>` : `<button class="btn btn-secondary btn-icon" disabled><i class="fa-solid fa-up-right-from-square"></i></button>`}
        `;
      }
    }
  });

  // Sync console controls if the selected service status changed via metrics
  if (selectedServiceId) {
    const selectedService = services.find(s => s.id === selectedServiceId);
    if (selectedService) renderSelectedServiceControls(selectedService);
  }

  // Update Services Total metrics
  if (data.servicesTotal) {
    const srvCpu = data.servicesTotal.cpu || 0;
    const srvMem = data.servicesTotal.memory || 0;
    const srvMemMB = (srvMem / (1024 * 1024)).toFixed(1);
    if (servicesCpuVal) servicesCpuVal.textContent = `${srvCpu}%`;
    if (servicesRamVal) servicesRamVal.textContent = `${srvMemMB} MB`;
  }

  updateHeaderStats();
}

// Real-time log relay from WebSocket
function handleWebSocketLog(data) {
  const { serviceId, stream, timestamp, message } = data;

  // Initialize buffer if not exists
  if (!logBuffers[serviceId]) {
    logBuffers[serviceId] = [];
  }

  // Push to buffer
  const logObj = { stream, timestamp, message };
  logBuffers[serviceId].push(logObj);

  // Cap size
  if (logBuffers[serviceId].length > maxLogBufferSize) {
    logBuffers[serviceId].shift();
  }

  // If this service is currently selected in console, append log directly
  if (selectedServiceId === serviceId) {
    const logLine = document.createElement('div');
    logLine.className = `log-line log-${stream}`;
    
    const timeStr = new Date(timestamp).toLocaleTimeString();
    logLine.innerHTML = `<span class="log-time">[${timeStr}]</span> ${escapeHTML(message.trim())}`;
    
    // Check if there was placeholder, remove it
    const placeholder = terminalOutput.querySelector('.console-placeholder');
    if (placeholder) {
      terminalOutput.innerHTML = '';
    }

    terminalOutput.appendChild(logLine);

    if (chkAutoscroll.checked) {
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
  }
}

// Handle service status changes broadcast
function handleWebSocketStatusChange(data) {
  const { id, status } = data;
  const service = services.find(s => s.id === id);
  if (service) {
    service.status = status;
    const cardEl = document.getElementById(`card-${id}`);
    if (cardEl) {
      cardEl.className = cardEl.className.replace(/status-\w+/g, '').trim() + ` status-${status}`;
      const badge = cardEl.querySelector('.card-status');
      if (badge) {
        badge.className = `card-status status-badge-${status}`;
        badge.innerHTML = `<i class="fa-solid fa-circle" style="font-size: 0.5rem; margin-right: 4px;"></i> ${status}`;
      }
    }
    // Keep console controls in sync if this is the currently selected service
    if (selectedServiceId === id) {
      renderSelectedServiceControls(service);
    }
  }
  updateHeaderStats();
}

// Update Active/Total counter badges in Header
function updateHeaderStats() {
  const activeCount = services.filter(s => s.status === 'online').length;
  activeServicesCount.textContent = activeCount;
  totalServicesCount.textContent = services.length;
}

// Utility to escape HTML elements safely
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
