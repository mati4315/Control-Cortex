(function () {
  const { getState, onChange, formatHandle, platformMeta } = window.BannerStudio;
  const root = document.body;
  const labelEl = document.getElementById('social-label');
  const handleEl = document.getElementById('social-handle');
  const iconEl = document.getElementById('current-icon');

  let loopTimer = null;
  let switchTimer = null;
  let currentIndex = 0;
  let currentItems = [];
  const TRANSITION_OUT_MS = 360;
  const TRANSITION_IN_DELAY_MS = 90;

  function visibleItems(state) {
    return state.items.filter((item) => item.visible);
  }

  function setTheme(platform) {
    root.dataset.loop = platform || 'web';
    const color = (platformMeta[platform] || platformMeta.web).color;
    root.style.setProperty('--card-bg-2', color);
  }

  function setItemContent(item) {
    if (!item) return;
    const platform = item.platform || 'web';
    const meta = platformMeta[platform] || platformMeta.web;
    labelEl.textContent = item.label || meta.label;
    handleEl.textContent = formatHandle(platform, item.handle);
    root.dataset.loop = platform;
    setTheme(platform);
  }

  function showOverlay() {
    root.classList.remove('is-hiding');
    root.classList.add('is-visible');
  }

  function hideOverlay() {
    root.classList.remove('is-visible');
    root.classList.add('is-hiding');
  }

  function cancelSwitch() {
    if (switchTimer) {
      clearTimeout(switchTimer);
      switchTimer = null;
    }
  }

  function renderItem(item, animate = false) {
    if (!item) return;
    if (!animate) {
      setItemContent(item);
      showOverlay();
      return;
    }

    cancelSwitch();
    hideOverlay();
    switchTimer = window.setTimeout(() => {
      setItemContent(item);
      window.setTimeout(() => {
        showOverlay();
      }, TRANSITION_IN_DELAY_MS);
      switchTimer = null;
    }, TRANSITION_OUT_MS);
  }

  function stopLoop() {
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }
    cancelSwitch();
  }

  function startLoop(state) {
    stopLoop();
    currentItems = visibleItems(state);
    currentIndex = 0;

    if (!currentItems.length) {
      labelEl.textContent = 'CDelu';
      handleEl.textContent = 'www.cdelu.ar';
      setTheme('web');
      showOverlay();
      return;
    }

    renderItem(currentItems[currentIndex], false);

    if (currentItems.length > 1) {
      loopTimer = setInterval(() => {
        currentIndex = (currentIndex + 1) % currentItems.length;
        renderItem(currentItems[currentIndex], true);
      }, Math.max(1500, Number(state.loopInterval) || 4200));
    }
  }

  onChange(startLoop);
  startLoop(getState());
})();
