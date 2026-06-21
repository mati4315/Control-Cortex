const { DRAW_ORDER, DRAWS } = require('./constants')
const { getSetting, saveSetting, getAllSettings } = require('./database')

const DEFAULT_SETTINGS = {
  scraper_url: process.env.SCRAPER_URL || 'https://servicios.iafas.gov.ar/ServicioExtracto/ultimoExtracto',
  scraper_timeout_ms: Number(process.env.SCRAPER_TIMEOUT_MS || 12000),
  scraper_retries: Number(process.env.SCRAPER_RETRIES || 3),
  cache_ttl_seconds: Number(process.env.CACHE_TTL_SECONDS || 900),
  rate_limit_per_minute: Number(process.env.RATE_LIMIT_PER_MINUTE || 100),
  timezone: process.env.TZ || 'America/Argentina/Buenos_Aires',
  maintenance_mode: false,
  enable_websocket: String(process.env.ENABLE_WEBSOCKET || 'true').toLowerCase() === 'true',
  enable_scheduler: String(process.env.ENABLE_SCHEDULER || 'false').toLowerCase() === 'true',
  scheduler_pattern: process.env.SCHEDULER_PATTERN || '*/2 * * * *',
}

for (const key of DRAW_ORDER) {
  DEFAULT_SETTINGS[`draw_enabled_${key}`] = true
  DEFAULT_SETTINGS[`draw_time_${key}`] = DRAWS[key].time
}

function bootstrapSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const current = getSetting(key)
    if (current === null || current === undefined) {
      saveSetting(key, value)
    }
  }
}

function getAppSetting(key) {
  const fromDb = getSetting(key)
  if (fromDb !== null && fromDb !== undefined) return fromDb
  return DEFAULT_SETTINGS[key]
}

function getSettingsObject() {
  const rows = getAllSettings()
  const settings = { ...DEFAULT_SETTINGS }
  for (const row of rows) settings[row.key] = row.value
  return settings
}

function setSettingsBulk(payload = {}) {
  for (const [key, value] of Object.entries(payload)) {
    saveSetting(key, normalizeValue(value))
  }
}

function normalizeValue(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
    const n = Number(value)
    if (!Number.isNaN(n)) return n
  }
  return value
}

bootstrapSettings()

module.exports = {
  DEFAULT_SETTINGS,
  bootstrapSettings,
  getAppSetting,
  getSettingsObject,
  setSettingsBulk,
}
