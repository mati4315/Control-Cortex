const { DRAW_ORDER, DRAWS } = require('./constants')
const { getSettingsObject } = require('./config')
const { getResult, saveResult, getResultsByDate, saveSyncLog } = require('./database')
const { scrapeIafas } = require('./scraper')
const { emitUpdate } = require('./websocket')
const { today, isWithinWindow, msUntilDraw, getWindowForDraw } = require('./time')
const mysql = require('./mysql')

function drawEnabled(settings, drawKey) {
  return Boolean(settings[`draw_enabled_${drawKey}`])
}

function buildLiveItem(drawKey, fecha, cachedRow = null) {
  const settings = getSettingsObject()
  const draw = DRAWS[drawKey]
  const withinWindow = isWithinWindow(drawKey, fecha)
  const hasResult = Boolean(cachedRow?.resultado)

  let estado = 'pending'
  if (hasResult) estado = 'closed'
  else if (withinWindow) estado = 'live'

  return {
    sorteo: drawKey,
    label: draw.label,
    horario: settings[`draw_time_${drawKey}`] || draw.time,
    enabled: drawEnabled(settings, drawKey),
    estado,
    resultado: cachedRow?.resultado || null,
    fecha,
    timeLeftMs: msUntilDraw(drawKey, fecha),
    window: getWindowForDraw(drawKey, fecha),
    updatedAt: cachedRow?.updated_at || null,
  }
}

function getLiveSnapshot(fecha = today()) {
  const rows = getResultsByDate(fecha)
  const index = new Map(rows.map((row) => [row.sorteo, row]))
  return DRAW_ORDER.map((drawKey) => buildLiveItem(drawKey, fecha, index.get(drawKey) || null))
}

async function syncDraw({ fecha = today(), sorteo, force = false, source = 'manual' }) {
  const settings = getSettingsObject()
  if (!DRAWS[sorteo]) {
    return { ok: false, error: 'Sorteo inválido' }
  }

  if (!drawEnabled(settings, sorteo)) {
    saveSyncLog({ fecha, sorteo, status: 'skipped', source, detail: 'draw_disabled' })
    return { ok: true, skipped: true, reason: 'draw_disabled', fecha, sorteo }
  }

  const cached = getResult(fecha, sorteo)
  const withinWindow = isWithinWindow(sorteo, fecha)

  if (!force && fecha === today() && !withinWindow && !cached) {
    saveSyncLog({ fecha, sorteo, status: 'skipped', source, detail: 'outside_window' })
    return { ok: true, skipped: true, reason: 'outside_window', fecha, sorteo, resultado: null }
  }

  // Si ya tenemos el resultado exitosamente y no estamos forzando, NO volvemos a consultar la API
  if (!force && cached?.resultado) {
    return {
      ok: true,
      scraped: false,
      fecha,
      sorteo,
      resultado: cached.resultado,
      cached: true,
      reason: 'already_obtained',
    }
  }

  const scraped = await scrapeIafas(fecha, sorteo)

  if (scraped.resultado) {
    const changed = cached?.resultado !== scraped.resultado
    saveResult(fecha, sorteo, scraped.resultado, source)
    // Espejar a MySQL remoto (best-effort, no bloquea)
    mysql.saveResult(fecha, sorteo, scraped.resultado, source)
    saveSyncLog({
      fecha,
      sorteo,
      status: changed ? 'updated' : 'cache_refresh',
      source,
      detail: scraped.reason || 'scraped',
      payload: { resultado: scraped.resultado, changed },
    })

    const payload = {
      fecha,
      sorteo,
      resultado: scraped.resultado,
      estado: 'closed',
      changed,
      source,
      timestamp: Date.now(),
    }

    emitUpdate('update', payload)
    return { ok: true, scraped: true, fecha, sorteo, resultado: scraped.resultado, cached: false, changed }
  }

  if (cached?.resultado) {
    saveSyncLog({
      fecha,
      sorteo,
      status: 'fallback_cache',
      source,
      detail: scraped.reason || 'cache_hit',
      payload: { resultado: cached.resultado, error: scraped.error || null },
    })

    return {
      ok: true,
      scraped: false,
      fecha,
      sorteo,
      resultado: cached.resultado,
      cached: true,
      reason: scraped.reason || 'cache_hit',
    }
  }

  saveSyncLog({
    fecha,
    sorteo,
    status: scraped.skipped ? 'skipped' : 'miss',
    source,
    detail: scraped.reason || 'not_found',
    payload: { error: scraped.error || null },
  })

  return {
    ok: true,
    scraped: false,
    fecha,
    sorteo,
    resultado: null,
    cached: false,
    reason: scraped.reason || 'not_found',
  }
}

async function syncMany({ fecha = today(), sorteos = DRAW_ORDER, force = false, source = 'scheduler' }) {
  const results = []
  for (const sorteo of sorteos) {
    results.push(await syncDraw({ fecha, sorteo, force, source }))
  }
  return results
}

module.exports = {
  syncDraw,
  syncMany,
  getLiveSnapshot,
}
