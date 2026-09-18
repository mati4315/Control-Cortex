const socket = io();

// State
let settings = {};
let secondsRemaining = 300;
let defaultDuration = 300;
let isTimerRunning = false;
let adminTimerInterval = null;

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

// Tabs
const navButtons = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Subtabs
const subTabBtns = document.querySelectorAll('.sub-tab-btn');
const subTabContents = document.querySelectorAll('.sub-tab-content');

// Connection Events
socket.on('connect', () => {
  statusIndicator.className = 'status-indicator online';
  statusText.textContent = 'CONECTADO';
});

socket.on('disconnect', () => {
  statusIndicator.className = 'status-indicator offline';
  statusText.textContent = 'DESCONECTADO';
  stopLocalTimer();
});

// Tab Navigation
navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    navButtons.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(`tab-${tabId}`).classList.add('active');
  });
});

// Sub-tabs (Media)
subTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    subTabBtns.forEach(b => b.classList.remove('active'));
    subTabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const subId = btn.getAttribute('data-sub');
    document.getElementById(`sub-${subId}`).classList.add('active');
  });
});

// --- Initialize Settings ---
socket.on('initSettings', (initSettings) => {
  settings = initSettings;
  populateFormFields();
  
  // Initialize banner config
  initBannerFromSettings(initSettings);
  
  // Timer Sync on startup
  defaultDuration = settings.countdownTime || 300;
  secondsRemaining = defaultDuration;
  updateTimerDisplay();
});

socket.on('settingsUpdated', (updatedSettings) => {
  settings = updatedSettings;
  
  // Update fields silently
  refreshMediaPreviews();
  
  // Update banner if included
  if (updatedSettings.banner) {
    applyBannerConfig(updatedSettings.banner);
    document.getElementById('banner-loop-interval').value = bannerConfig.loopInterval;
    var randomCheck = document.getElementById('check-banner-random');
    if (randomCheck) randomCheck.checked = bannerConfig.randomMode;
    renderBannerEditor();
  }
  
  // If timer is not running and default time changed, reset display
  if (!isTimerRunning && defaultDuration !== settings.countdownTime) {
    defaultDuration = settings.countdownTime;
    secondsRemaining = defaultDuration;
    updateTimerDisplay();
  }
});

// Sync timer commands from overlay or other admin views
socket.on('timerCommand', (cmd) => {
  switch (cmd.action) {
    case 'start':
      if (cmd.value !== undefined) secondsRemaining = cmd.value;
      if (cmd.totalDuration !== undefined) defaultDuration = cmd.totalDuration;
      startLocalTimer();
      break;
    case 'pause':
      stopLocalTimer();
      break;
    case 'reset':
      stopLocalTimer();
      secondsRemaining = settings.countdownTime || 300;
      defaultDuration = settings.countdownTime || 300;
      updateTimerDisplay();
      break;
    case 'sync':
      if (cmd.value !== undefined) {
        secondsRemaining = cmd.value;
        if (cmd.totalDuration !== undefined) defaultDuration = cmd.totalDuration;
        updateTimerDisplay();
      }
      break;
  }
});

function populateFormFields() {
  // Texts
  document.getElementById('input-badge-text').value = settings.badgeText;
  document.getElementById('input-header-text').value = settings.headerText;
  document.getElementById('input-title-text').value = settings.titleText;
  document.getElementById('input-subtitle-text').value = settings.subtitleText;

  // Colors
  setColorFields('primary', settings.primaryColor);
  setColorFields('secondary', settings.secondaryColor);
  setColorFields('glow', settings.glowColor);
  setColorFields('bg', settings.backgroundColor);

  // Fonts & Particles
  document.getElementById('select-font').value = settings.fontFamily;
  
  document.getElementById('range-particles-count').value = settings.particlesCount;
  document.getElementById('val-particles-count').textContent = settings.particlesCount;
  
  document.getElementById('range-particles-speed').value = settings.particlesSpeed;
  document.getElementById('val-particles-speed').textContent = settings.particlesSpeed;
  
  document.getElementById('check-particles-glow').checked = settings.particlesGlow;

  // Media Settings
  document.getElementById('select-bg-type').value = settings.backgroundType;
  document.getElementById('check-logo-visible').checked = settings.logoVisible;
  document.getElementById('check-music-enabled').checked = settings.musicEnabled;
  
  document.getElementById('range-music-volume').value = Math.round(settings.musicVolume * 100);
  document.getElementById('val-music-volume').textContent = Math.round(settings.musicVolume * 100);

  // Default time fields
  const mins = Math.floor(settings.countdownTime / 60);
  const secs = settings.countdownTime % 60;
  document.getElementById('input-timer-minutes').value = mins;
  document.getElementById('input-timer-seconds').value = secs;

  refreshMediaPreviews();
  renderSocialsInputs();
  populateObsFields(settings);
}

function setColorFields(prefix, value) {
  document.getElementById(`input-${prefix}-color`).value = value;
  document.getElementById(`text-${prefix}-color`).value = value;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

function updateMediaPreviews() {
  // Logo preview
  const logoImg = document.getElementById('logo-preview-img');
  const logoPlaceholder = document.getElementById('logo-preview-placeholder');
  if (settings.logoUrl) {
    logoImg.src = settings.logoUrl;
    logoImg.classList.remove('hidden');
    logoPlaceholder.classList.add('hidden');
  } else {
    logoImg.classList.add('hidden');
    logoPlaceholder.classList.remove('hidden');
  }

  // Background preview
  const bgPreview = document.getElementById('bg-preview-box');
  bgPreview.innerHTML = '';
  
  if (settings.backgroundType === 'particles') {
    bgPreview.innerHTML = `<span class="preview-text"><i class="fa-solid fa-wand-magic-sparkles"></i> Sistema de Partículas Activo</span>`;
  } else if (settings.backgroundType === 'video' && settings.backgroundUrl) {
    bgPreview.innerHTML = `<video src="${settings.backgroundUrl}" autoplay muted loop style="width: 100%; height: 100%; object-fit: cover;"></video>`;
  } else if (settings.backgroundType === 'image' && settings.backgroundUrl) {
    bgPreview.innerHTML = `<img src="${settings.backgroundUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
  } else {
    bgPreview.innerHTML = `<span class="preview-text"><i class="fa-solid fa-fill-drip"></i> Fondo Color Gradiente</span>`;
  }
}

function refreshMediaPreviews() {
  const logoImg = document.getElementById('logo-preview-img');
  const logoPlaceholder = document.getElementById('logo-preview-placeholder');

  if (settings.logoUrl) {
    logoImg.src = settings.logoUrl;
    logoImg.classList.remove('hidden');
    logoPlaceholder.classList.add('hidden');
  } else {
    logoImg.classList.add('hidden');
    logoPlaceholder.classList.remove('hidden');
  }

  const bgPreview = document.getElementById('bg-preview-box');
  bgPreview.replaceChildren();

  if (settings.backgroundType === 'particles') {
    const label = document.createElement('span');
    label.className = 'preview-text';
    label.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Sistema de Particulas Activo';
    bgPreview.appendChild(label);
  } else if (settings.backgroundType === 'video' && settings.backgroundUrl) {
    const video = document.createElement('video');
    video.src = settings.backgroundUrl;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    bgPreview.appendChild(video);
  } else if (settings.backgroundType === 'image' && settings.backgroundUrl) {
    const image = document.createElement('img');
    image.src = settings.backgroundUrl;
    image.alt = 'Vista previa de fondo';
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.objectFit = 'cover';
    bgPreview.appendChild(image);
  } else {
    const label = document.createElement('span');
    label.className = 'preview-text';
    label.innerHTML = '<i class="fa-solid fa-fill-drip"></i> Fondo Color Gradiente';
    bgPreview.appendChild(label);
  }
}

// --- Live Color Picker Synchronization ---
const colorPrefixes = ['primary', 'secondary', 'glow', 'bg'];
colorPrefixes.forEach(prefix => {
  const picker = document.getElementById(`input-${prefix}-color`);
  const text = document.getElementById(`text-${prefix}-color`);
  
  picker.addEventListener('input', (e) => {
    text.value = e.target.value;
    emitLiveColorChange(prefix, e.target.value);
  });

  text.addEventListener('input', (e) => {
    const val = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(val)) {
      picker.value = val;
      emitLiveColorChange(prefix, val);
    }
  });
});

function emitLiveColorChange(prefix, value) {
  let update = {};
  if (prefix === 'primary') update.primaryColor = value;
  if (prefix === 'secondary') update.secondaryColor = value;
  if (prefix === 'glow') update.glowColor = value;
  if (prefix === 'bg') update.backgroundColor = value;

  socket.emit('updateSettings', update);
}

// --- Live Slider & Checkbox Listeners ---
document.getElementById('range-particles-count').addEventListener('input', (e) => {
  document.getElementById('val-particles-count').textContent = e.target.value;
  socket.emit('updateSettings', { particlesCount: parseInt(e.target.value) });
});

document.getElementById('range-particles-speed').addEventListener('input', (e) => {
  document.getElementById('val-particles-speed').textContent = e.target.value;
  socket.emit('updateSettings', { particlesSpeed: parseFloat(e.target.value) });
});

document.getElementById('check-particles-glow').addEventListener('change', (e) => {
  socket.emit('updateSettings', { particlesGlow: e.target.checked });
});

document.getElementById('check-logo-visible').addEventListener('change', (e) => {
  socket.emit('updateSettings', { logoVisible: e.target.checked });
});

document.getElementById('check-music-enabled').addEventListener('change', (e) => {
  socket.emit('updateSettings', { musicEnabled: e.target.checked });
});

document.getElementById('range-music-volume').addEventListener('input', (e) => {
  document.getElementById('val-music-volume').textContent = e.target.value;
  socket.emit('updateSettings', { musicVolume: parseFloat(e.target.value) / 100 });
});

document.getElementById('select-bg-type').addEventListener('change', (e) => {
  socket.emit('updateSettings', { backgroundType: e.target.value });
  setTimeout(refreshMediaPreviews, 50);
});

// --- Text Form Submit ---
document.getElementById('form-texts').addEventListener('submit', (e) => {
  e.preventDefault();
  const update = {
    badgeText: document.getElementById('input-badge-text').value,
    headerText: document.getElementById('input-header-text').value,
    titleText: document.getElementById('input-title-text').value,
    subtitleText: document.getElementById('input-subtitle-text').value
  };
  socket.emit('updateSettings', update);
  alertNotification('Textos guardados y aplicados!');
});

// --- Style/Colors Form Submit ---
document.getElementById('form-colors').addEventListener('submit', (e) => {
  e.preventDefault();
  const update = {
    primaryColor: document.getElementById('input-primary-color').value,
    secondaryColor: document.getElementById('input-secondary-color').value,
    glowColor: document.getElementById('input-glow-color').value,
    backgroundColor: document.getElementById('input-bg-color').value
  };
  socket.emit('updateSettings', update);
  alertNotification('Colores aplicados!');
});

document.getElementById('form-particles-typography').addEventListener('submit', (e) => {
  e.preventDefault();
  const update = {
    fontFamily: document.getElementById('select-font').value,
    particlesCount: parseInt(document.getElementById('range-particles-count').value),
    particlesSpeed: parseFloat(document.getElementById('range-particles-speed').value),
    particlesGlow: document.getElementById('check-particles-glow').checked
  };
  socket.emit('updateSettings', update);
  alertNotification('Estilo de fuentes y partículas guardado!');
});

// --- Timer Controls ---
const timerDisplay = document.getElementById('admin-timer-display');
const btnStart = document.getElementById('btn-timer-start');
const btnPause = document.getElementById('btn-timer-pause');
const btnReset = document.getElementById('btn-timer-reset');
const liveStatePill = document.getElementById('live-timer-state');

function updateTimerDisplay() {
  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startLocalTimer() {
  if (adminTimerInterval) clearInterval(adminTimerInterval);
  isTimerRunning = true;
  liveStatePill.textContent = 'EN CURSO';
  liveStatePill.className = 'live-pill running';
  
  adminTimerInterval = setInterval(() => {
    if (secondsRemaining <= 0) {
      stopLocalTimer();
      secondsRemaining = 0;
      updateTimerDisplay();
      return;
    }
    secondsRemaining--;
    updateTimerDisplay();
  }, 1000);
}

function stopLocalTimer() {
  isTimerRunning = false;
  liveStatePill.textContent = 'PAUSADO';
  liveStatePill.className = 'live-pill';
  if (adminTimerInterval) {
    clearInterval(adminTimerInterval);
    adminTimerInterval = null;
  }
}

btnStart.addEventListener('click', () => {
  socket.emit('controlTimer', { action: 'start', value: secondsRemaining });
});

btnPause.addEventListener('click', () => {
  socket.emit('controlTimer', { action: 'pause' });
});

btnReset.addEventListener('click', () => {
  socket.emit('controlTimer', { action: 'reset' });
});

// Quick adjustments
document.querySelectorAll('[data-adjust]').forEach(btn => {
  btn.addEventListener('click', () => {
    const adjustment = parseInt(btn.getAttribute('data-adjust'));
    secondsRemaining = Math.max(0, secondsRemaining + adjustment);
    updateTimerDisplay();
    socket.emit('controlTimer', { action: 'sync', value: secondsRemaining });
  });
});

// Save Default Countdown Time
document.getElementById('btn-save-default-time').addEventListener('click', () => {
  const mins = parseInt(document.getElementById('input-timer-minutes').value) || 0;
  const secs = parseInt(document.getElementById('input-timer-seconds').value) || 0;
  const total = (mins * 60) + secs;
  
  if (total <= 0) {
    alert('Introduce un tiempo válido mayor a 0 segundos.');
    return;
  }
  
  defaultDuration = total;
  secondsRemaining = total;
  updateTimerDisplay();
  
  socket.emit('updateSettings', { countdownTime: total });
  socket.emit('controlTimer', { action: 'reset' });
  alertNotification('Duración inicial guardada y reestablecida!');
});

// --- Social Media Management ---
const socialInputsContainer = document.getElementById('social-inputs-container');
const btnAddSocial = document.getElementById('btn-add-social');

function renderSocialsInputs() {
  socialInputsContainer.innerHTML = '';
  if (!settings.socials || settings.socials.length === 0) {
    socialInputsContainer.innerHTML = `<p class="preview-text" id="no-socials-msg">No hay redes sociales configuradas. Presiona "Añadir Red Social" para empezar.</p>`;
    return;
  }

  settings.socials.forEach((social, index) => {
    createSocialInputRow(social, index);
  });
}

function createSocialInputRow(social, index) {
  const msg = document.getElementById('no-socials-msg');
  if (msg) msg.remove();

  const row = document.createElement('div');
  row.className = 'social-input-row';
  row.dataset.index = index;

  row.innerHTML = `
    <select class="social-platform-select">
      <option value="twitch" ${social.platform === 'twitch' ? 'selected' : ''}>Twitch</option>
      <option value="youtube" ${social.platform === 'youtube' ? 'selected' : ''}>YouTube</option>
      <option value="twitter" ${social.platform === 'twitter' || social.platform === 'x' ? 'selected' : ''}>X (Twitter)</option>
      <option value="instagram" ${social.platform === 'instagram' ? 'selected' : ''}>Instagram</option>
      <option value="tiktok" ${social.platform === 'tiktok' ? 'selected' : ''}>TikTok</option>
      <option value="facebook" ${social.platform === 'facebook' ? 'selected' : ''}>Facebook</option>
      <option value="custom" ${social.platform === 'custom' ? 'selected' : ''}>Otro Link</option>
    </select>
    <input type="text" class="social-handle-input" value="${escapeHtml(social.handle)}" placeholder="Ej. /tucanal o @usuario">
    <label class="checkbox-container" style="width: auto; padding-right: 10px;">
      <input type="checkbox" class="social-visible-checkbox" ${social.visible ? 'checked' : ''}>
      <span class="checkmark"></span>
      Visible
    </label>
    <button type="button" class="btn-remove-row" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
  `;

  // Row remove action
  row.querySelector('.btn-remove-row').addEventListener('click', () => {
    row.remove();
    // Update no-socials message if empty
    if (socialInputsContainer.children.length === 0) {
      socialInputsContainer.innerHTML = `<p class="preview-text" id="no-socials-msg">No hay redes sociales configuradas. Presiona "Añadir Red Social" para empezar.</p>`;
    }
  });

  socialInputsContainer.appendChild(row);
}

btnAddSocial.addEventListener('click', () => {
  const newIndex = socialInputsContainer.querySelectorAll('.social-input-row').length;
  createSocialInputRow({ platform: 'twitch', handle: '', visible: true }, newIndex);
});

document.getElementById('form-socials').addEventListener('submit', (e) => {
  e.preventDefault();
  const rows = socialInputsContainer.querySelectorAll('.social-input-row');
  const newSocials = [];

  rows.forEach((row, index) => {
    const platform = row.querySelector('.social-platform-select').value;
    const handle = row.querySelector('.social-handle-input').value;
    const visible = row.querySelector('.social-visible-checkbox').checked;

    newSocials.push({
      id: `${platform}-${index}`,
      platform,
      handle,
      visible
    });
  });

  socket.emit('updateSettings', { socials: newSocials });
  alertNotification('Redes sociales actualizadas!');
});

// --- AJAX File Upload Handling ---
setupFileUpload('file-logo', 'logo-dropzone', 'logo-progress', '/api/upload-logo');
setupFileUpload('file-video', 'video-dropzone', 'video-progress', '/api/upload-bg-video');
setupFileUpload('file-image', 'image-dropzone', 'image-progress', '/api/upload-bg-image');
setupFileUpload('file-music', 'music-dropzone', 'music-progress', '/api/upload-bg-music');

function setupFileUpload(inputId, dropzoneId, progressId, uploadUrl) {
  const fileInput = document.getElementById(inputId);
  const dropzone = document.getElementById(dropzoneId);
  const progressBarFill = document.querySelector(`#${progressId} .progress-bar-fill`);
  const progressContainer = document.getElementById(progressId);

  // Drag over effects
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelected(fileInput.files[0], progressBarFill, progressContainer, uploadUrl);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0], progressBarFill, progressContainer, uploadUrl);
    }
  });
}

function handleFileSelected(file, progressBarFill, progressContainer, uploadUrl) {
  const formData = new FormData();
  // Get the name expected by multer based on the URL endpoint
  let fieldName = 'logo';
  if (uploadUrl.includes('bg-video')) fieldName = 'bgVideo';
  if (uploadUrl.includes('bg-image')) fieldName = 'bgImage';
  if (uploadUrl.includes('bg-music')) fieldName = 'bgMusic';

  formData.append(fieldName, file);

  // Set up XMLHttpRequest to track progress
  const xhr = new XMLHttpRequest();
  
  progressContainer.style.display = 'block';
  progressBarFill.style.width = '0%';

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percentage = Math.round((e.loaded / e.total) * 100);
      progressBarFill.style.width = percentage + '%';
    }
  });

  xhr.addEventListener('load', () => {
    progressContainer.style.display = 'none';
    if (xhr.status === 200) {
      const res = JSON.parse(xhr.responseText);
      if (res.success) {
        alertNotification('Archivo subido con éxito!');
      } else {
        alert('Error en la subida del archivo.');
      }
    } else {
      alert('Error en la comunicación con el servidor.');
    }
  });

  xhr.addEventListener('error', () => {
    progressContainer.style.display = 'none';
    alert('Error al realizar la petición de subida.');
  });

  xhr.open('POST', uploadUrl);
  xhr.send(formData);
}

// --- Toast / Notification Helper ---
function alertNotification(message) {
  // Create toast container if not exists
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.background = '#1a182e';
  toast.style.color = '#fff';
  toast.style.border = '1px solid #00f0ff';
  toast.style.boxShadow = '0 0 10px rgba(0, 240, 255, 0.2)';
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = '8px';
  toast.style.fontSize = '14px';
  toast.style.fontWeight = '600';
  toast.style.animation = 'slideIn 0.3s ease';
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-circle-check';
  icon.style.color = '#00e676';
  icon.style.marginRight = '8px';
  toast.appendChild(icon);
  toast.appendChild(document.createTextNode(String(message)));

  container.appendChild(toast);

  // Fade out
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s ease';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// =============================================
// OBS CONTROL TAB LOGIC
// =============================================

// DOM refs for OBS tab
const obsConnBadge   = document.getElementById('obs-conn-badge');
const obsStatusBar   = document.getElementById('obs-status-bar');
const obsStatusIcon  = document.getElementById('obs-status-icon');
const obsStatusLabel = document.getElementById('obs-status-label');
const obsStatusDetail = document.getElementById('obs-status-detail');
const btnTriggerObs  = document.getElementById('btn-trigger-obs');
const obsResultMsg   = document.getElementById('obs-result-msg');

// Populate OBS fields when settings load
function populateObsFields(s) {
  if (!s) return;
  if (document.getElementById('input-obs-host'))     document.getElementById('input-obs-host').value     = s.obsHost     || '127.0.0.1';
  if (document.getElementById('input-obs-port'))     document.getElementById('input-obs-port').value     = s.obsPort     || 4455;
  if (document.getElementById('input-obs-password')) document.getElementById('input-obs-password').value = s.obsPassword || '';
  if (document.getElementById('input-obs-scene'))    document.getElementById('input-obs-scene').value    = s.obsScene    || '';
  if (document.getElementById('check-obs-auto'))     document.getElementById('check-obs-auto').checked   = !!s.obsAutoTransition;
}

// Update OBS UI based on status
function updateObsStatusUI(connected, connecting, errorMsg) {
  const badge   = obsConnBadge;
  const bar     = obsStatusBar;
  const icon    = obsStatusIcon;
  const label   = obsStatusLabel;
  const detail  = obsStatusDetail;

  // Clear previous states
  badge.className = 'obs-live-badge';
  bar.className   = 'obs-status-bar';
  icon.className  = 'obs-status-icon';

  if (connecting) {
    badge.classList.add('connecting');
    bar.classList.add('connecting');
    icon.classList.add('connecting');
    icon.innerHTML  = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    badge.textContent = 'CONECTANDO…';
    label.textContent  = 'Intentando conectar a OBS…';
    detail.textContent = 'Espera unos segundos';
    if (btnTriggerObs) btnTriggerObs.disabled = true;
  } else if (connected) {
    badge.classList.add('connected');
    bar.classList.add('connected');
    icon.classList.add('connected');
    icon.innerHTML  = '<i class="fa-solid fa-circle-check"></i>';
    badge.textContent = 'CONECTADO';
    label.textContent  = '¡Conectado a OBS WebSocket!';
    detail.textContent = `Host: ${(settings.obsHost || '127.0.0.1')}:${(settings.obsPort || 4455)}`;
    if (btnTriggerObs) btnTriggerObs.disabled = false;
  } else {
    badge.textContent = 'DESCONECTADO';
    icon.innerHTML  = '<i class="fa-solid fa-circle-xmark"></i>';
    label.textContent  = 'Sin conexión con OBS';
    if (errorMsg) {
      detail.textContent = `Error: ${errorMsg}`;
    } else {
      detail.textContent = 'Configura los datos y presiona "Conectar"';
    }
    if (btnTriggerObs) btnTriggerObs.disabled = true;
  }
}

// Listen for OBS status from server
socket.on('obsStatus', (data) => {
  updateObsStatusUI(data.connected, data.connecting, data.error);
});

// Save OBS connection config
document.getElementById('form-obs-config').addEventListener('submit', (e) => {
  e.preventDefault();
  const update = {
    obsHost:     document.getElementById('input-obs-host').value.trim()    || '127.0.0.1',
    obsPort:     parseInt(document.getElementById('input-obs-port').value) || 4455,
    obsPassword: document.getElementById('input-obs-password').value
  };
  socket.emit('updateSettings', update);
  alertNotification('Configuración OBS guardada. Reconectando…');
});

// Test / Connect OBS button
document.getElementById('btn-test-obs').addEventListener('click', () => {
  // First save current field values then test
  const update = {
    obsHost:     document.getElementById('input-obs-host').value.trim()    || '127.0.0.1',
    obsPort:     parseInt(document.getElementById('input-obs-port').value) || 4455,
    obsPassword: document.getElementById('input-obs-password').value
  };
  socket.emit('updateSettings', update);
  // Small delay to let server process settings update, then test
  setTimeout(() => {
    updateObsStatusUI(false, true, null); // Show "connecting" immediately
    socket.emit('testObsConnection');
  }, 200);
});

// Save scene & auto-transition
document.getElementById('btn-save-obs-scene').addEventListener('click', () => {
  const sceneName = document.getElementById('input-obs-scene').value.trim();
  const autoTrans = document.getElementById('check-obs-auto').checked;
  if (!sceneName) {
    alert('Ingresa un nombre de escena válido.');
    return;
  }
  socket.emit('updateSettings', { obsScene: sceneName, obsAutoTransition: autoTrans });
  alertNotification(`Escena "${sceneName}" guardada. Auto-transición: ${autoTrans ? 'ON' : 'OFF'}`);
});

// Auto-transition checkbox live change
document.getElementById('check-obs-auto').addEventListener('change', (e) => {
  socket.emit('updateSettings', { obsAutoTransition: e.target.checked });
});

// Manual scene transition button
if (btnTriggerObs) {
  btnTriggerObs.addEventListener('click', () => {
    const sceneName = document.getElementById('input-obs-scene').value.trim() || settings.obsScene;
    if (!sceneName) {
      showObsResult(false, 'Debes configurar un nombre de escena primero.');
      return;
    }
    // Visual feedback
    btnTriggerObs.disabled = true;
    btnTriggerObs.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Cambiando escena…</span><div class="btn-transition-glow"></div>';
    socket.emit('triggerObsTransition');
  });
}

// Handle OBS transition result
socket.on('obsTransitionResult', (result) => {
  // Restore button
  if (btnTriggerObs) {
    btnTriggerObs.disabled = false;
    btnTriggerObs.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Cambiar a Escena Ahora</span><div class="btn-transition-glow"></div>';
  }

  if (result.success) {
    showObsResult(true, `✓ Escena cambiada a "${result.sceneName}" exitosamente`);
    alertNotification(`Transición a "${result.sceneName}" completada!`);
  } else {
    showObsResult(false, `✗ Error: ${result.error}`);
  }
});

function showObsResult(isSuccess, message) {
  if (!obsResultMsg) return;
  obsResultMsg.className = 'obs-result-msg ' + (isSuccess ? 'success' : 'error');
  obsResultMsg.textContent = message;
  // Auto hide after 6s
  clearTimeout(obsResultMsg._hideTimer);
  obsResultMsg._hideTimer = setTimeout(() => {
    obsResultMsg.className = 'obs-result-msg';
  }, 6000);
}

// =============================================
// BANNER SOCIAL TAB LOGIC
// =============================================

const BANNER_STORAGE_KEY = 'cdelu-social-loop-v1';

const bannerDefaults = {
  loopInterval: 4200,
  pauseOnHover: false,
  randomMode: false,
  items: [
    { id: 'instagram', platform: 'instagram', label: 'Instagram', handle: '/cdelu.ar', visible: true },
    { id: 'facebook-1', platform: 'facebook', label: 'Facebook', handle: '/cdeluArg', visible: true },
    { id: 'facebook-2', platform: 'facebook', label: 'Facebook', handle: '/cdeluweb', visible: true },
    { id: 'tiktok', platform: 'tiktok', label: 'TikTok', handle: '@cdelu.ar', visible: true },
    { id: 'web', platform: 'web', label: 'Web', handle: 'www.cdelu.ar', visible: true }
  ]
};

const bannerPlatformMeta = {
  instagram: { label: 'Instagram', color: '#ff4fd8' },
  facebook: { label: 'Facebook', color: '#4267ff' },
  tiktok: { label: 'TikTok', color: '#00f2ea' },
  telegram: { label: 'Telegram', color: '#2aabee' },
  web: { label: 'Web', color: '#21d4fd' }
};

let bannerConfig = JSON.parse(JSON.stringify(bannerDefaults));

function bannerUid(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.round(Math.random() * 1e6);
}

function persistBannerToLocalStorage(config) {
  try {
    localStorage.setItem(BANNER_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Failed to save banner to localStorage:', e);
  }
}

function loadBannerFromLocalStorage() {
  try {
    const raw = localStorage.getItem(BANNER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.loopInterval === 'number' && Array.isArray(parsed.items)) {
        return parsed;
      }
    }
  } catch (e) {}
  return null;
}

function applyBannerConfig(config) {
  if (!config || typeof config !== 'object') return;
  bannerConfig = {
    loopInterval: Number.isFinite(Number(config.loopInterval)) ? Math.max(1500, Number(config.loopInterval)) : bannerDefaults.loopInterval,
    pauseOnHover: !!config.pauseOnHover,
    randomMode: !!config.randomMode,
    items: Array.isArray(config.items) && config.items.length > 0
      ? config.items.map(function(item, idx) {
          return {
            id: item && item.id ? String(item.id) : bannerUid('item'),
            platform: item && item.platform && bannerPlatformMeta[item.platform] ? item.platform : 'web',
            label: item && item.label ? String(item.label) : 'Web',
            handle: item && typeof item.handle === 'string' ? item.handle : '',
            visible: item ? item.visible !== false : true
          };
        })
      : bannerDefaults.items.map(function(item) { return JSON.parse(JSON.stringify(item)); })
  };
  persistBannerToLocalStorage(bannerConfig);
}

// Called when settings are loaded from server
function initBannerFromSettings(settingsObj) {
  if (settingsObj && settingsObj.banner) {
    applyBannerConfig(settingsObj.banner);
  } else {
    var stored = loadBannerFromLocalStorage();
    applyBannerConfig(stored || bannerDefaults);
  }
  renderBannerEditor();
  document.getElementById('banner-loop-interval').value = bannerConfig.loopInterval;
  var randomCheck = document.getElementById('check-banner-random');
  if (randomCheck) randomCheck.checked = bannerConfig.randomMode;
}

function renderBannerEditor() {
  var list = document.getElementById('banner-editor-list');
  if (!list) return;
  list.innerHTML = '';

  bannerConfig.items.forEach(function(item) {
    list.appendChild(createBannerEditorRow(item));
  });
}

function createBannerEditorRow(item) {
  var row = document.createElement('div');
  row.className = 'banner-editor-row';
  row.dataset.id = item.id;

  var platform = document.createElement('select');
  Object.keys(bannerPlatformMeta).forEach(function(key) {
    var opt = document.createElement('option');
    opt.value = key;
    opt.textContent = bannerPlatformMeta[key].label;
    if (item.platform === key) opt.selected = true;
    platform.appendChild(opt);
  });

  var label = document.createElement('input');
  label.type = 'text';
  label.value = item.label;
  label.placeholder = 'Etiqueta';

  var handle = document.createElement('input');
  handle.type = 'text';
  handle.value = item.handle;
  handle.placeholder = item.platform === 'web' ? 'www.cdelu.ar' : '/cdelu.ar';

  var visibleWrap = document.createElement('label');
  visibleWrap.className = 'mini-toggle';
  visibleWrap.innerHTML = '<input type="checkbox"><span>Visible</span>';
  var visible = visibleWrap.querySelector('input');
  visible.checked = item.visible;

  var remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-remove-row';
  remove.title = 'Eliminar';
  remove.innerHTML = '<i class="fa-solid fa-trash-can"></i>';

  row.appendChild(platform);
  row.appendChild(label);
  row.appendChild(handle);
  row.appendChild(visibleWrap);
  row.appendChild(remove);

  platform.addEventListener('change', function() {
    if (platform.value === 'web') {
      handle.placeholder = 'www.cdelu.ar';
    } else if (platform.value === 'telegram') {
      handle.placeholder = '@tucanal';
    } else {
      handle.placeholder = '/' + platform.value;
    }
  });

  remove.addEventListener('click', function() {
    row.remove();
    syncBannerItems();
  });

  row._controls = { platform: platform, label: label, handle: handle, visible: visible };

  platform.addEventListener('change', syncBannerItems);
  label.addEventListener('input', syncBannerItems);
  handle.addEventListener('input', syncBannerItems);
  visible.addEventListener('change', syncBannerItems);

  return row;
}

function syncBannerItems() {
  var rows = document.querySelectorAll('#banner-editor-list .banner-editor-row');
  var items = [];
  rows.forEach(function(row) {
    var ctrl = row._controls;
    if (!ctrl) return;
    items.push({
      id: row.dataset.id || bannerUid('item'),
      platform: ctrl.platform.value,
      label: ctrl.label.value.trim() || bannerPlatformMeta[ctrl.platform.value].label,
      handle: ctrl.handle.value.trim(),
      visible: ctrl.visible.checked
    });
  });
  bannerConfig.items = items.length > 0 ? items : bannerDefaults.items.map(function(i) { return JSON.parse(JSON.stringify(i)); });
}

function saveBannerToServer() {
  syncBannerItems();
  bannerConfig.loopInterval = Math.max(1500, parseInt(document.getElementById('banner-loop-interval').value, 10) || 4200);
  document.getElementById('banner-loop-interval').value = bannerConfig.loopInterval;
  persistBannerToLocalStorage(bannerConfig);
  socket.emit('updateBanner', bannerConfig);
  alertNotification('Banner guardado y aplicado!');
}

function resetBannerToDefaults() {
  if (!confirm('Estas seguro de que quieres restaurar el banner a su configuracion base?')) return;
  bannerConfig = JSON.parse(JSON.stringify(bannerDefaults));
  persistBannerToLocalStorage(bannerConfig);
  document.getElementById('banner-loop-interval').value = bannerConfig.loopInterval;
  renderBannerEditor();
  socket.emit('updateBanner', bannerConfig);
  alertNotification('Banner restaurado a valores base!');
}

// Live loop interval update
var bannerLoopInput = document.getElementById('banner-loop-interval');
if (bannerLoopInput) {
  bannerLoopInput.addEventListener('input', function() {
    var val = Math.max(1500, parseInt(bannerLoopInput.value, 10) || 4200);
    bannerConfig.loopInterval = val;
    persistBannerToLocalStorage(bannerConfig);
    socket.emit('updateBanner', bannerConfig);
  });
}

// Random mode checkbox
var bannerRandomCheck = document.getElementById('check-banner-random');
if (bannerRandomCheck) {
  bannerRandomCheck.addEventListener('change', function() {
    bannerConfig.randomMode = bannerRandomCheck.checked;
    persistBannerToLocalStorage(bannerConfig);
    socket.emit('updateBanner', bannerConfig);
  });
}

// Add banner item button
var btnAddBannerItem = document.getElementById('btn-add-banner-item');
if (btnAddBannerItem) {
  btnAddBannerItem.addEventListener('click', function() {
    var newItem = { id: bannerUid('social'), platform: 'instagram', label: 'Instagram', handle: '', visible: true };
    bannerConfig.items.push(newItem);
    var list = document.getElementById('banner-editor-list');
    if (list) {
      list.appendChild(createBannerEditorRow(newItem));
    }
    persistBannerToLocalStorage(bannerConfig);
    socket.emit('updateBanner', bannerConfig);
  });
}

// Shuffle banner items randomly
function shuffleBannerItems() {
  syncBannerItems();
  var items = bannerConfig.items;
  if (items.length <= 1) return;
  // Fisher-Yates shuffle
  for (var i = items.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
  bannerConfig.items = items;
  persistBannerToLocalStorage(bannerConfig);
  renderBannerEditor();
  socket.emit('updateBanner', bannerConfig);
}

// Save banner button
var btnSaveBanner = document.getElementById('btn-save-banner');
if (btnSaveBanner) {
  btnSaveBanner.addEventListener('click', saveBannerToServer);
}

// Shuffle banner button
var btnShuffleBanner = document.getElementById('btn-shuffle-banner');
if (btnShuffleBanner) {
  btnShuffleBanner.addEventListener('click', function() {
    shuffleBannerItems();
    alertNotification('Orden aleatorio aplicado!');
  });
}

// Reset banner button
var btnResetBanner = document.getElementById('btn-reset-banner');
if (btnResetBanner) {
  btnResetBanner.addEventListener('click', resetBannerToDefaults);
}

// Listen for banner updates from server
socket.on('bannerUpdated', function(updatedBanner) {
  if (updatedBanner && typeof updatedBanner === 'object') {
    applyBannerConfig(updatedBanner);
    document.getElementById('banner-loop-interval').value = bannerConfig.loopInterval;
    var randomCheck = document.getElementById('check-banner-random');
    if (randomCheck) randomCheck.checked = bannerConfig.randomMode;
    renderBannerEditor();
    // Refresh preview iframe
    var iframe = document.getElementById('banner-preview-iframe');
    if (iframe) {
      iframe.src = iframe.src;
    }
  }
});
