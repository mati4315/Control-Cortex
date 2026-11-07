'use strict';
importScripts('facebook-stats.js');

const DEFAULTS = { serverBase: 'http://127.0.0.1:9765', apiToken: '', enabled: false, captureFacebook: false, accountLabel: '', instanceId: '' };
const avatarCache = new Map();

async function settings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const instanceId = String(stored.instanceId || crypto.randomUUID());
  if (instanceId !== stored.instanceId) await chrome.storage.local.set({ instanceId });
  return { ...DEFAULTS, ...stored, instanceId, serverBase: String(stored.serverBase || DEFAULTS.serverBase).replace(/\/$/, '') };
}

async function api(path, options = {}) {
  const config = await settings();
  if (!/^https?:\/\//i.test(config.serverBase)) throw new Error('La dirección del módulo debe empezar con http:// o https://');
  const response = await fetch(`${config.serverBase}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), ...(config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `El módulo respondió HTTP ${response.status}`);
  return data;
}

function safeFacebookPageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(url.hostname)) return '';
    url.search = '';
    url.hash = '';
    return url.href.slice(0, 500);
  } catch (_) { return ''; }
}

async function durableAvatar(value) {
  const source = String(value || '').trim();
  if (!/^https:\/\//i.test(source)) return source;
  if (avatarCache.has(source)) return avatarCache.get(source);
  const task = (async () => {
    const url = new URL(source);
    const host = url.hostname.toLowerCase();
    if (!(host.endsWith('.fbcdn.net') || host.endsWith('.fbsbx.com'))) return source;
    if (host.startsWith('static.')) return '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    let bitmap;
    try {
      const response = await fetch(url.href, { credentials: 'include', cache: 'force-cache', signal: controller.signal });
      if (!response.ok) return source;
      const blob = await response.blob();
      if (!/^image\//i.test(blob.type) || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return source;
      bitmap = await createImageBitmap(blob);
      const side = 72;
      const canvas = new OffscreenCanvas(side, side);
      const context = canvas.getContext('2d');
      if (!context) return source;
      context.drawImage(bitmap, 0, 0, side, side);
      const compact = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
      if (compact.size > 24000) return source;
      const bytes = new Uint8Array(await compact.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return `data:image/webp;base64,${btoa(binary)}`;
    } catch (_) {
      return source;
    } finally {
      clearTimeout(timeout);
      bitmap?.close?.();
    }
  })();
  avatarCache.set(source, task);
  if (avatarCache.size > 300) avatarCache.delete(avatarCache.keys().next().value);
  const result = await task;
  if (!result) avatarCache.delete(source);
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'facebook-insights') {
    settings().then(config => {
      if (!config.enabled || !config.captureFacebook) throw new Error('La captura está apagada.');
      const page = new URL(sender.url || sender.tab?.url || '');
      if (!/(^|\.)facebook\.com$/i.test(page.hostname)) throw new Error('Origen de estadísticas inválido.');
      if (!FacebookStats.isStatsPage(page.href)) throw new Error('Abre Estadísticas o STREAM_STATS de esta transmisión en Facebook.');
      const streamId = FacebookStats.streamId(page.href);
      if (!streamId) throw new Error('No se pudo identificar la transmisión de estadísticas.');
      return api('/api/facebook-insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId, accountLabel: config.accountLabel, metrics: message.payload?.metrics })
      });
    }).then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'facebook-chat-event') {
    const payload = { ...(message.payload || {}) };
    settings().then(config => {
      const tabId = Number.isInteger(sender.tab?.id) ? sender.tab.id : -1;
      const accountLabel = String(config.accountLabel || 'Cuenta Facebook').trim().slice(0, 100);
      const captureId = `${config.instanceId}:${tabId}`;
      const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
      payload.meta = {
        ...meta,
        captureId,
        tabId,
        accountLabel,
        streamId: String(meta.streamId || meta.videoId || '').slice(0, 180),
        pageUrl: safeFacebookPageUrl(sender.tab?.url || meta.pageUrl),
        captureMethod: 'dom'
      };
      return durableAvatar(payload.chatimg).then(chatimg => {
      payload.chatimg = chatimg;
      return api('/api/chat-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: payload }) });
      });
    })
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'capture-status') {
    settings().then(config => {
      const tabId = Number.isInteger(sender.tab?.id) ? sender.tab.id : -1;
      const payload = { ...(message.payload || {}) };
      payload.instanceId = config.instanceId;
      payload.tabId = tabId;
      payload.accountLabel = String(config.accountLabel || 'Cuenta Facebook').trim().slice(0, 100);
      payload.captureId = `${config.instanceId}:${tabId}`;
      payload.pageUrl = safeFacebookPageUrl(sender.tab?.url || payload.pageUrl);
      return api('/api/capture-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capture: payload }) });
    })
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'get-capture-config') {
    settings().then(data => sendResponse({ ok: true, config: { enabled: data.enabled, captureFacebook: data.captureFacebook, accountLabel: data.accountLabel, instanceId: data.instanceId } }));
    return true;
  }
  if (message.type === 'ping-module') {
    api('/api/status').then(data => sendResponse({ ok: true, status: data })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
