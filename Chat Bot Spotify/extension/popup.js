'use strict';

const $ = id => document.getElementById(id);
const defaults = { serverBase: 'http://127.0.0.1:9765', apiToken: '', enabled: false, captureFacebook: false, accountLabel: 'Cuenta Facebook', videoUrl: '' };

function setStatus(message, kind = '') { $('status').textContent = message; $('status').className = `status ${kind}`; }

async function load() {
  const config = { ...defaults, ...await chrome.storage.local.get(defaults) };
  $('server').value = config.serverBase;
  $('token').value = config.apiToken;
  $('accountLabel').value = config.accountLabel || defaults.accountLabel;
  $('enabled').checked = config.enabled;
  $('capture').checked = config.captureFacebook;
  $('videoUrl').value = config.videoUrl;
  check();
}

async function check() {
  const base = $('server').value.trim().replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/api/status`);
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || `HTTP ${response.status}`);
    setStatus(`${status.enabled ? 'Módulo activo' : 'Módulo apagado'} · Facebook ${status.captureFacebook ? 'listo' : 'apagado'} · API conectada`, 'ok');
  } catch (error) { setStatus(`No conecta con el módulo: ${error.message}`, 'err'); }
}

async function save() {
  const config = {
    serverBase: $('server').value.trim().replace(/\/$/, ''),
    apiToken: $('token').value.trim(),
    accountLabel: $('accountLabel').value.trim().slice(0, 100) || defaults.accountLabel,
    enabled: $('enabled').checked,
    captureFacebook: $('capture').checked
  };
  await chrome.storage.local.set(config);
  await check();
}

$('save').addEventListener('click', save);
$('openLiveProducer').addEventListener('click', async () => {
  const input = $('videoUrl').value.trim();
  const streamId = FacebookStats.streamId(input);
  if (!streamId) {
    $('producerStatus').textContent = 'Pega un enlace de video o Live Producer con su ID numérico.';
    return;
  }
  $('openLiveProducer').disabled = true;
  try {
    await chrome.storage.local.set({ videoUrl: input });
    const inputUrl = new URL(input);
    const streamStatsRequested = /\/live\/producer\/dashboard\/\d+\/stream_stats(?:\/|$)/i.test(inputUrl.pathname);
    const insightsRequested = /\/live\/producer\/(?:v2\/\d+\/insights|dashboard\/\d+\/insights)(?:\/|$)/i.test(inputUrl.pathname);
    const statsUrl = streamStatsRequested
      ? `https://www.facebook.com/live/producer/dashboard/${streamId}/STREAM_STATS/`
      : insightsRequested
        ? inputUrl.href
        : `https://www.facebook.com/live/producer/v2/${streamId}/insights`;
    const destinations = [
      { key: 'insights', url: statsUrl },
      { key: 'comments', url: `https://www.facebook.com/live/producer/dashboard/${streamId}/COMMENTS/` }
    ];
    const saved = await chrome.storage.local.get([
      'insightsTabId', 'insightsStreamId', 'commentsTabId', 'commentsStreamId'
    ]);
    const opened = {};
    for (const destination of destinations) {
      const previousTabId = saved[`${destination.key}TabId`];
      let tab;
      if (saved[`${destination.key}StreamId`] === streamId && Number.isInteger(previousTabId)) {
        try { tab = await chrome.tabs.update(previousTabId, { url: destination.url, active: false }); } catch (_) {}
      }
      if (!tab) tab = await chrome.tabs.create({ url: destination.url, active: false });
      opened[`${destination.key}TabId`] = tab.id;
      opened[`${destination.key}StreamId`] = streamId;
    }
    await chrome.storage.local.set(opened);
    const commentsTab = await chrome.tabs.get(opened.commentsTabId);
    await chrome.tabs.update(commentsTab.id, { active: true });
    $('producerStatus').textContent = `Pestañas de ${streamStatsRequested ? 'STREAM_STATS' : 'estadísticas'} y comentarios abiertas. Captura los comentarios nuevos con la extensión activa.`;
  } catch (error) { $('producerStatus').textContent = error.message; }
  finally { $('openLiveProducer').disabled = false; }
});
load();
