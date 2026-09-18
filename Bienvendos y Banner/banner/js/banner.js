(function () {
  const { getState, onChange, updateState, formatHandle, platformMeta } = window.BannerStudio;
  const root = document.body;
  const labelEl = document.getElementById('social-label');
  const handleEl = document.getElementById('social-handle');
  const iconEl = document.getElementById('current-icon');

  let loopTimer = null;
  let switchTimer = null;
  let currentIndex = 0;
  let currentItems = [];
  let lastState = null;
  const TRANSITION_OUT_MS = 360;
  const TRANSITION_IN_DELAY_MS = 90;

  function visibleItems(state) {
    return state.items.filter((item) => item.visible);
  }

  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
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
    lastState = state;

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
        // Full cycle completed and randomMode is on -> reshuffle and restart
        if (currentIndex === 0 && lastState && lastState.randomMode) {
          var allItems = lastState.items.slice();
          var visibleIndices = [];
          var hiddenItems = [];
          allItems.forEach(function(item, idx) {
            if (item.visible) visibleIndices.push(idx);
            else hiddenItems.push(item);
          });
          var shuffledVis = shuffleArray(visibleItems(lastState));
          var newItems = [];
          var visIdx = 0;
          allItems.forEach(function(item) {
            if (item.visible) {
              newItems.push(shuffledVis[visIdx]);
              visIdx++;
            } else {
              newItems.push(item);
            }
          });
          window.BannerStudio.updateState({ items: newItems });
          // onChange will call startLoop again with shuffled state
          return;
        }
        renderItem(currentItems[currentIndex], true);
      }, Math.max(1500, Number(state.loopInterval) || 4200));
    }
  }

  onChange(startLoop);
  startLoop(getState());
})();
