const socket = io();

// State Variables
let settings = {};
let countdownInterval = null;
let secondsRemaining = 300;
let totalDuration = 300;
let isTimerRunning = false;

// DOM Elements
const badgeText = document.getElementById('badge-text');
const liveBadge = document.getElementById('live-badge');
const logoWrapper = document.getElementById('logo-wrapper');
const logoImg = document.getElementById('logo-img');
const logoPlaceholder = document.getElementById('logo-placeholder');
const headerText = document.getElementById('header-text');
const titleText = document.getElementById('title-text');
const subtitleText = document.getElementById('subtitle-text');
const progressBar = document.getElementById('progress-bar');
const socialsList = document.getElementById('socials-list');
const currentFontLink = document.getElementById('current-font');

const minTens = document.getElementById('min-tens');
const minUnits = document.getElementById('min-units');
const secTens = document.getElementById('sec-tens');
const secUnits = document.getElementById('sec-units');

const bgImage = document.getElementById('bg-image');
const bgVideo = document.getElementById('bg-video');
const bgAudio = document.getElementById('bg-audio');

// --- Dynamic Font Loader ---
function applyFont(fontName) {
  if (!fontName) return;
  document.documentElement.style.setProperty('--font-family', `'${fontName}', sans-serif`);
}

function toAbsoluteUrl(url) {
  return new URL(url, window.location.origin).href;
}

function isSameSource(element, url) {
  if (!url) return !element.src;
  return element.src === toAbsoluteUrl(url);
}

// --- Background Renderer ---
let particles = [];
let shootingStars = [];
let canvas = document.getElementById('particles-canvas');
let ctx = canvas.getContext('2d');
let animationFrameId = null;
let particlesAnimationActive = false;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
  constructor(color, maxSpeed) {
    this.reset(true);
    this.color = color;
    this.maxSpeed = maxSpeed;
  }

  reset(init = false) {
    this.x = Math.random() * canvas.width;
    this.y = init ? Math.random() * canvas.height : canvas.height + 10;
    this.size = Math.random() * 2.5 + 0.5;
    this.speedY = (Math.random() * 0.8 + 0.2) * (settings.particlesSpeed || 1.5);
    this.speedX = (Math.random() * 0.4 - 0.2) * (settings.particlesSpeed || 1.5);
    this.alpha = Math.random() * 0.5 + 0.2;
    this.fade = Math.random() * 0.005 + 0.002;
  }

  update() {
    this.y -= this.speedY;
    this.x += this.speedX;
    
    // Fade particles slowly as they rise
    if (this.y < canvas.height * 0.2) {
      this.alpha -= this.fade;
    }

    if (this.y < -10 || this.x < -10 || this.x > canvas.width + 10 || this.alpha <= 0) {
      this.reset(false);
    }
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    
    // Draw simple shadow for glow performance
    if (settings.particlesGlow) {
      ctx.shadowBlur = 6;
      ctx.shadowColor = this.color;
    }
    
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.restore();
  }
}

class ShootingStar {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * (canvas.height * 0.4); // spawn in upper part
    this.len = Math.random() * 80 + 40;
    this.speedX = Math.random() * 15 + 10;
    this.speedY = Math.random() * 4 + 2;
    this.size = Math.random() * 1.5 + 0.5;
    this.alpha = 1;
    this.active = Math.random() < 0.05; // low chance to be active
  }

  update() {
    if (!this.active) return;
    this.x += this.speedX;
    this.y += this.speedY;
    this.alpha -= 0.015;

    if (this.alpha <= 0 || this.x > canvas.width || this.y > canvas.height) {
      this.reset();
    }
  }

  draw() {
    if (!this.active) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.strokeStyle = settings.primaryColor || '#00f0ff';
    ctx.lineWidth = this.size;
    ctx.shadowBlur = 10;
    ctx.shadowColor = settings.primaryColor || '#00f0ff';
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.len, this.y - (this.len * 0.2));
    ctx.stroke();
    ctx.restore();
  }
}

function initParticles() {
  particles = [];
  const count = settings.particlesCount || 100;
  const color = settings.particlesColor || settings.primaryColor || '#00f0ff';
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(color));
  }
  
  shootingStars = [];
  for (let i = 0; i < 3; i++) {
    shootingStars.push(new ShootingStar());
  }
}

function startParticlesAnimation() {
  if (particlesAnimationActive) return;
  particlesAnimationActive = true;
  animateParticles();
}

function stopParticlesAnimation() {
  particlesAnimationActive = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function animateParticles() {
  if (!particlesAnimationActive) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (settings.backgroundType === 'particles') {
    // Draw space dust
    particles.forEach(p => {
      p.update();
      p.draw();
    });

    // Draw occasional shooting stars
    shootingStars.forEach(star => {
      star.update();
      star.draw();
    });
  }

  animationFrameId = requestAnimationFrame(animateParticles);
}

// --- Apply Dynamic Settings ---
function updateTheme(newSettings) {
  const prevSettings = { ...settings };
  settings = { ...newSettings };
  const socialsChanged = JSON.stringify(prevSettings.socials || []) !== JSON.stringify(settings.socials || []);
  const mediaBackgroundChanged =
    prevSettings.backgroundType !== settings.backgroundType ||
    prevSettings.backgroundUrl !== settings.backgroundUrl;
  const mediaAudioSourceChanged =
    prevSettings.musicEnabled !== settings.musicEnabled ||
    prevSettings.musicUrl !== settings.musicUrl;

  // Set CSS Variables
  const root = document.documentElement;
  if (prevSettings.primaryColor !== settings.primaryColor) {
    root.style.setProperty('--primary-color', settings.primaryColor);
  }
  if (prevSettings.secondaryColor !== settings.secondaryColor) {
    root.style.setProperty('--secondary-color', settings.secondaryColor);
  }
  if (prevSettings.glowColor !== settings.glowColor) {
    root.style.setProperty('--glow-color', settings.glowColor);
  }
  if (prevSettings.backgroundColor !== settings.backgroundColor) {
    root.style.setProperty('--bg-color', settings.backgroundColor);
  }
  
  // Apply Font
  if (prevSettings.fontFamily !== settings.fontFamily) {
    applyFont(settings.fontFamily);
  }

  // Update Text Elements
  if (prevSettings.badgeText !== settings.badgeText) badgeText.textContent = settings.badgeText;
  if (prevSettings.headerText !== settings.headerText) headerText.textContent = settings.headerText;
  if (prevSettings.titleText !== settings.titleText) titleText.textContent = settings.titleText;
  if (prevSettings.subtitleText !== settings.subtitleText) subtitleText.textContent = settings.subtitleText;

  // Update Logo
  if (prevSettings.logoVisible !== settings.logoVisible) {
    logoWrapper.style.display = settings.logoVisible ? 'block' : 'none';
  }
  if (settings.logoVisible) {
    if (settings.logoUrl && !isSameSource(logoImg, settings.logoUrl)) {
      logoImg.src = settings.logoUrl;
    }
    if (settings.logoUrl) {
      logoImg.classList.remove('hidden');
      logoPlaceholder.classList.add('hidden');
    } else {
      logoImg.classList.add('hidden');
      logoPlaceholder.classList.remove('hidden');
    }
  }

  // Handle Background Types
  if (settings.backgroundType === 'video' && settings.backgroundUrl) {
    bgImage.classList.remove('active');
    bgImage.style.backgroundImage = '';
    bgVideo.classList.add('active');
    stopParticlesAnimation();
    if (!isSameSource(bgVideo, settings.backgroundUrl)) {
      bgVideo.src = settings.backgroundUrl;
      bgVideo.play().catch(e => console.log("Video playback delayed:", e));
    } else if (bgVideo.paused) {
      bgVideo.play().catch(e => console.log("Video playback delayed:", e));
    }
  } else if (settings.backgroundType === 'image' && settings.backgroundUrl) {
    bgVideo.classList.remove('active');
    bgVideo.pause();
    bgImage.classList.add('active');
    stopParticlesAnimation();
    if (mediaBackgroundChanged) {
      bgImage.style.backgroundImage = `url('${settings.backgroundUrl}')`;
    }
  } else {
    // default particles or color
    bgVideo.classList.remove('active');
    bgVideo.pause();
    bgImage.classList.remove('active');
    bgImage.style.backgroundImage = '';
    if (prevSettings.backgroundType !== settings.backgroundType || 
        prevSettings.particlesCount !== settings.particlesCount ||
        prevSettings.particlesColor !== settings.particlesColor ||
        prevSettings.particlesSpeed !== settings.particlesSpeed) {
      initParticles();
    }
    if (settings.backgroundType === 'particles') {
      startParticlesAnimation();
    } else {
      stopParticlesAnimation();
    }
  }

  // Update Background Audio
  if (settings.musicEnabled && settings.musicUrl) {
    if (!isSameSource(bgAudio, settings.musicUrl)) {
      bgAudio.src = settings.musicUrl;
    }
    if (prevSettings.musicVolume !== settings.musicVolume) {
      bgAudio.volume = settings.musicVolume;
    }
    
    // Play with error catch (required for web policies, works in OBS)
    if (mediaAudioSourceChanged || bgAudio.paused) {
      bgAudio.play().catch(e => {
        console.warn("Audio autoplay blocked by browser policy. Will play on interaction or inside OBS:", e);
      });
    }
  } else {
    bgAudio.pause();
  }

  // Update Socials Pill List
  if (socialsChanged) {
    renderSocials();
  }

  // If countdown length was modified in admin and timer is stopped, sync it
  if (!isTimerRunning && prevSettings.countdownTime !== settings.countdownTime) {
    totalDuration = settings.countdownTime;
    secondsRemaining = settings.countdownTime;
    updateTimerDisplay();
  }
}

function renderSocials() {
  socialsList.innerHTML = '';
  if (!settings.socials) return;

  settings.socials.forEach(social => {
    const handle = String(social.handle || '').trim();
    if (!social.visible || !handle) return;

    const pill = document.createElement('div');
    pill.className = 'social-pill';

    let iconClass = 'fa-solid fa-link';
    if (social.platform === 'twitch') iconClass = 'fa-brands fa-twitch';
    else if (social.platform === 'youtube') iconClass = 'fa-brands fa-youtube';
    else if (social.platform === 'twitter' || social.platform === 'x') iconClass = 'fa-brands fa-x-twitter';
    else if (social.platform === 'instagram') iconClass = 'fa-brands fa-instagram';
    else if (social.platform === 'tiktok') iconClass = 'fa-brands fa-tiktok';
    else if (social.platform === 'facebook') iconClass = 'fa-brands fa-facebook';

    pill.innerHTML = `
      <i class="${iconClass} social-icon"></i>
      <span class="social-handle">${escapeHtml(handle)}</span>
    `;

    socialsList.appendChild(pill);
  });
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text || '').replace(/[&<>"']/g, function(m) { return map[m]; });
}

// --- Timer Display Updates ---
function updateTimerDisplay() {
  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;

  const minStr = String(mins).padStart(2, '0');
  const secStr = String(secs).padStart(2, '0');

  // Update card digits on screen
  minTens.textContent = minStr[0];
  minUnits.textContent = minStr[1];
  secTens.textContent = secStr[0];
  secUnits.textContent = secStr[1];

  // Update progress bar
  const progressPercent = totalDuration > 0 ? (secondsRemaining / totalDuration) * 100 : 0;
  progressBar.style.width = `${progressPercent}%`;
}

// --- Timer Engine ---
function runTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  isTimerRunning = true;
  
  countdownInterval = setInterval(() => {
    if (secondsRemaining <= 0) {
      clearInterval(countdownInterval);
      isTimerRunning = false;
      secondsRemaining = 0;
      updateTimerDisplay();
      // Optional: Send event that timer finished
      return;
    }
    secondsRemaining--;
    updateTimerDisplay();
  }, 1000);
}

function pauseTimer() {
  isTimerRunning = false;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function resetTimer() {
  pauseTimer();
  secondsRemaining = settings.countdownTime || 300;
  totalDuration = settings.countdownTime || 300;
  updateTimerDisplay();
}

// --- GSAP Entrances ---
function runEntranceAnimations() {
  // GSAP Timeline
  const tl = gsap.timeline();
  
  tl.fromTo('body', { opacity: 0 }, { opacity: 1, duration: 1.5 });
  
  tl.fromTo('#live-badge', 
    { y: -50, opacity: 0 }, 
    { y: 0, opacity: 1, duration: 0.8, ease: 'back.out(1.7)' },
    '-=0.8'
  );
  
  tl.fromTo('#logo-wrapper', 
    { scale: 0, opacity: 0 }, 
    { scale: 1, opacity: 1, duration: 1, ease: 'elastic.out(1, 0.75)' },
    '-=0.5'
  );
  
  tl.fromTo('.titles-container *', 
    { y: 30, opacity: 0 }, 
    { y: 0, opacity: 1, duration: 0.8, stagger: 0.2, ease: 'power3.out' },
    '-=0.7'
  );
  
  tl.fromTo('.digit-box', 
    { scale: 0.7, opacity: 0, rotationX: -90 }, 
    { scale: 1, opacity: 1, rotationX: 0, duration: 0.8, stagger: 0.1, ease: 'back.out(1.5)' },
    '-=0.5'
  );
  
  tl.fromTo('.progress-bar-container', 
    { scaleX: 0, opacity: 0 }, 
    { scaleX: 1, opacity: 1, duration: 1, ease: 'power2.inOut' },
    '-=0.4'
  );

  tl.fromTo('.subtitle-container', 
    { opacity: 0, scale: 0.9 }, 
    { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' },
    '-=0.5'
  );

  tl.fromTo('.social-pill', 
    { x: -30, opacity: 0 }, 
    { x: 0, opacity: 1, duration: 0.6, stagger: 0.15, ease: 'power2.out' },
    '-=0.5'
  );
}

// --- Socket.io Event Handling ---
socket.on('initSettings', (initSettings) => {
  updateTheme(initSettings);
  resetTimer();
  // Run entrance animation on first load
  setTimeout(runEntranceAnimations, 100);
});

socket.on('settingsUpdated', (updatedSettings) => {
  updateTheme(updatedSettings);
});

socket.on('timerCommand', (cmd) => {
  switch (cmd.action) {
    case 'start':
      if (cmd.value !== undefined) {
        secondsRemaining = cmd.value;
      }
      if (cmd.totalDuration !== undefined) {
        totalDuration = cmd.totalDuration;
      }
      runTimer();
      break;
    case 'pause':
      pauseTimer();
      break;
    case 'reset':
      resetTimer();
      break;
    case 'sync':
      if (cmd.value !== undefined) {
        secondsRemaining = cmd.value;
        if (cmd.totalDuration !== undefined) {
          totalDuration = cmd.totalDuration;
        }
        updateTimerDisplay();
      }
      break;
  }
});

// Start Particle Canvas Loop
initParticles();

// Interaction fallback to allow audio playback if browser blocks it
document.body.addEventListener('click', () => {
  if (settings.musicEnabled && bgAudio.paused) {
    bgAudio.play().catch(e => console.log('Audio retry failed:', e));
  }
  if (settings.backgroundType === 'video' && bgVideo.paused) {
    bgVideo.play().catch(e => console.log('Video retry failed:', e));
  }
});
