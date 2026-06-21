const fs = require('fs')
const path = require('path')

const dbPath = path.join(__dirname, '..', 'database.json')

const DEFAULT_DB = {
  resultados: [],
  settings: {},
  sync_logs: [],
  audit_logs: [],
  counters: {
    resultados: 1,
    sync_logs: 1,
    audit_logs: 1,
  },
}

function ensureDbFile() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(DEFAULT_DB, null, 2), 'utf8')
  }
}

function loadDb() {
  ensureDbFile()
  try {
    const raw = fs.readFileSync(dbPath, 'utf8')
    return { ...DEFAULT_DB, ...JSON.parse(raw) }
  } catch {
    return structuredClone(DEFAULT_DB)
  }
}

function saveDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8')
}

function nowIso() {
  return new Date().toISOString()
}

function saveResult(fecha, sorteo, resultado, source = 'scraper') {
  const db = loadDb()
  const existing = db.resultados.find((row) => row.fecha === fecha && row.sorteo === sorteo)

  if (existing) {
    existing.resultado = resultado
    existing.source = source
    existing.updated_at = nowIso()
  } else {
    db.resultados.push({
      id: db.counters.resultados++,
      fecha,
      sorteo,
      resultado,
      source,
      created_at: nowIso(),
      updated_at: nowIso(),
    })
  }

  saveDb(db)
}

function getResult(fecha, sorteo) {
  return loadDb().resultados.find((row) => row.fecha === fecha && row.sorteo === sorteo) || null
}

function getResultsByDate(fecha) {
  return loadDb().resultados
    .filter((row) => row.fecha === fecha)
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
}

function getLatestResults(limit = 100) {
  return loadDb().resultados
    .slice()
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, limit)
}

function clearResults() {
  const db = loadDb()
  db.resultados = []
  db.counters.resultados = 1
  saveDb(db)
}

function saveSetting(key, value) {
  const db = loadDb()
  db.settings[key] = {
    value,
    updated_at: nowIso(),
  }
  saveDb(db)
}

function getSetting(key) {
  const row = loadDb().settings[key]
  return row ? row.value : null
}

function getAllSettings() {
  const db = loadDb()
  return Object.entries(db.settings)
    .map(([key, row]) => ({ key, value: row.value, updated_at: row.updated_at }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function saveSyncLog({ fecha = null, sorteo = null, status, source = 'system', detail = '', payload = null }) {
  const db = loadDb()
  db.sync_logs.push({
    id: db.counters.sync_logs++,
    fecha,
    sorteo,
    status,
    source,
    detail,
    payload,
    created_at: nowIso(),
  })
  saveDb(db)
}

function getSyncLogs(limit = 100) {
  return loadDb().sync_logs
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
}

function saveAuditLog({ action, actor = 'system', detail = '', payload = null }) {
  const db = loadDb()
  db.audit_logs.push({
    id: db.counters.audit_logs++,
    action,
    actor,
    detail,
    payload,
    created_at: nowIso(),
  })
  saveDb(db)
}

module.exports = {
  saveResult,
  getResult,
  getResultsByDate,
  getLatestResults,
  clearResults,
  saveSetting,
  getSetting,
  getAllSettings,
  saveSyncLog,
  getSyncLogs,
  saveAuditLog,
}
