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
    servicesContainer.innerHTML = `
      <div class="console-placeholder">
        <i class="fa-solid fa-folder-open placeholder-icon" style="font-size: 2.5rem;"></i>
        <p>No hay microservicios registrados todavía.</p>
      </div>
    `;
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
}

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
