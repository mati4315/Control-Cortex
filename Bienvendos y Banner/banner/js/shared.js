(function () {
  const STORAGE_KEY = 'cdelu-social-loop-v1';
  const CHANNEL_NAME = 'cdelu-social-loop-channel';

  const defaults = {
    loopInterval: 4200,
    pauseOnHover: false,
    items: [
      { id: 'instagram', platform: 'instagram', label: 'Instagram', handle: '/cdelu.ar', visible: true },
      { id: 'facebook-1', platform: 'facebook', label: 'Facebook', handle: '/cdeluArg', visible: true },
      { id: 'facebook-2', platform: 'facebook', label: 'Facebook', handle: '/cdeluweb', visible: true },
      { id: 'tiktok', platform: 'tiktok', label: 'TikTok', handle: '@cdelu.ar', visible: true },
      { id: 'web', platform: 'web', label: 'Web', handle: 'www.cdelu.ar', visible: true }
    ]
  };

  const platformMeta = {
    instagram: { label: 'Instagram', color: '#ff4fd8' },
    facebook: { label: 'Facebook', color: '#4267ff' },
    tiktok: { label: 'TikTok', color: '#00f2ea' },
    web: { label: 'Web', color: '#21d4fd' }
  };

  let state = loadState();
  const listeners = new Set();
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix = 'item') {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }

  function normalizeItem(item, index) {
    const fallbackPlatform = item && item.platform ? String(item.platform) : 'web';
    const platform = platformMeta[fallbackPlatform] ? fallbackPlatform : 'web';
    return {
      id: item && item.id ? String(item.id) : uid(`${platform}-${index}`),
      platform,
      label: item && item.label ? String(item.label) : platformMeta[platform].label,
      handle: item && typeof item.handle === 'string' ? item.handle : '',
      visible: item ? item.visible !== false : true
    };
  }

  function normalizeState(candidate) {
    const input = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      loopInterval: Number.isFinite(Number(input.loopInterval)) ? Math.max(1500, Number(input.loopInterval)) : defaults.loopInterval,
      pauseOnHover: !!input.pauseOnHover,
      items: Array.isArray(input.items) ? input.items.map(normalizeItem) : clone(defaults.items)
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(defaults);
      return normalizeState(JSON.parse(raw));
    } catch (err) {
      console.warn('Could not load banner state, using defaults.', err);
      return clone(defaults);
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (channel) channel.postMessage(state);
    listeners.forEach((listener) => listener(clone(state)));
  }

  function getState() {
    return clone(state);
  }

  function setState(nextState) {
    state = normalizeState(nextState);
    persist();
  }

  function updateState(patch) {
    const next = typeof patch === 'function' ? patch(clone(state)) : patch;
    setState({ ...state, ...next });
  }

  function resetState() {
    state = clone(defaults);
    persist();
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function iconSvg(platform, accent = 'currentColor') {
    const icons = {
      instagram: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="${accent}" stroke-width="1.8"></rect>
          <circle cx="12" cy="12" r="4.2" fill="none" stroke="${accent}" stroke-width="1.8"></circle>
          <circle cx="17.2" cy="6.8" r="1.2" fill="${accent}"></circle>
        </svg>`,
      facebook: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M14.6 8.2H16.5V5.2H14.2C11.6 5.2 10 6.8 10 9.6V11.6H7.9V14.8H10V21H13.4V14.8H15.7L16.2 11.6H13.4V10.1C13.4 8.9 13.8 8.2 14.6 8.2Z" fill="${accent}"></path>
        </svg>`,
      tiktok: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M14.5 3.8c.7 1.8 2.2 3.1 4.1 3.3v3.1c-1.5 0-2.9-.4-4.1-1.1v5.8c0 3.2-2.6 5.8-5.8 5.8S3 18.1 3 14.9s2.6-5.8 5.8-5.8c.4 0 .8 0 1.2.1v3.3c-.3-.1-.7-.2-1-.2-1.5 0-2.8 1.2-2.8 2.8 0 1.5 1.3 2.8 2.8 2.8 1.6 0 2.9-1.2 2.9-2.8V3.8h2.6Z" fill="${accent}"></path>
        </svg>`,
      web: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="${accent}" stroke-width="1.8"></circle>
          <ellipse cx="12" cy="12" rx="4.2" ry="8.5" fill="none" stroke="${accent}" stroke-width="1.4"></ellipse>
          <path d="M3.5 12H20.5" fill="none" stroke="${accent}" stroke-width="1.4"></path>
        </svg>`
    };
    return icons[platform] || icons.web;
  }

  function formatHandle(platform, handle) {
    const clean = String(handle || '').trim();
    if (platform === 'web') return clean.replace(/^https?:\/\//i, '');
    return clean;
  }

  function subscribe() {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        state = normalizeState(JSON.parse(event.newValue));
        listeners.forEach((listener) => listener(clone(state)));
      } catch (err) {
        console.warn('State sync failed.', err);
      }
    });

    if (channel) {
      channel.onmessage = (event) => {
        state = normalizeState(event.data);
        listeners.forEach((listener) => listener(clone(state)));
      };
    }
  }

  subscribe();

  window.BannerStudio = {
    defaults: clone(defaults),
    getState,
    setState,
    updateState,
    resetState,
    onChange,
    iconSvg,
    formatHandle,
    platformMeta,
    uid
  };
})();
