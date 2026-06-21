const express = require('express')
const rateLimit = require('express-rate-limit')
const { DRAWS, DRAW_ORDER } = require('../services/constants')
const { comparePassword, signAdminToken, verifyAdminToken, verifyCronSecret } = require('../services/auth')
const { getSettingsObject, setSettingsBulk } = require('../services/config')
const { getSyncLogs, clearResults, saveAuditLog } = require('../services/database')
const mysql = require('../services/mysql')
const { today } = require('../services/time')
const { syncDraw, syncMany, getLiveSnapshot } = require('../services/sync')

const router = express.Router()

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
})

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {}

  if (username !== process.env.ADMIN_USERNAME) {
    return res.status(401).json({ error: 'Credenciales inválidas' })
  }

  const ok = await comparePassword(password || '')
  if (!ok) {
    return res.status(401).json({ error: 'Credenciales inválidas' })
  }

  const token = signAdminToken({ username })
  saveAuditLog({ action: 'admin_login', actor: username, detail: 'login_ok' })
  return res.json({ ok: true, token })
})

router.get('/sync-window', verifyCronSecret, async (req, res) => {
  const sorteo = req.query.slot ? String(req.query.slot).toLowerCase() : null
  const fecha = today()

  if (sorteo) {
    if (!DRAWS[sorteo]) return res.status(400).json({ error: 'slot inválido' })
    const result = await syncDraw({ fecha, sorteo, source: 'cron_window' })
    return res.json({ ok: true, ...result })
  }

  // Si no hay slot específico, revisa todos. El syncDraw saltará los que estén fuera de horario.
  const results = await syncMany({ fecha, sorteos: DRAW_ORDER, source: 'cron_window' })
  res.json({ ok: true, fecha, results })
})

router.use(verifyAdminToken)

router.get('/settings', (_, res) => {
  res.json(getSettingsObject())
})

router.put('/settings', (req, res) => {
  setSettingsBulk(req.body || {})
  saveAuditLog({ action: 'settings_update', actor: req.admin.username, payload: req.body || {} })
  res.json({ ok: true, settings: getSettingsObject() })
})

router.get('/status', (_, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
    fecha: today(),
    dashboard: '/dashboard.html',
    live: getLiveSnapshot(today()),
  })
})

router.get('/logs', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)))
  res.json({ items: getSyncLogs(limit) })
})

router.post('/sync-now', async (req, res) => {
  const fecha = req.body?.fecha || today()
  const sorteo = req.body?.sorteo ? String(req.body.sorteo).toLowerCase() : null
  const force = req.body?.force !== false

  if (sorteo && !DRAWS[sorteo]) {
    return res.status(400).json({ error: 'Sorteo inválido' })
  }

  const results = sorteo
    ? [await syncDraw({ fecha, sorteo, force, source: 'admin_manual' })]
    : await syncMany({ fecha, sorteos: DRAW_ORDER, force, source: 'admin_manual' })

  saveAuditLog({ action: 'sync_now', actor: req.admin.username, payload: { fecha, sorteo, force } })
  res.json({ ok: true, fecha, results })
})

router.get('/mysql/status', async (_, res) => {
  const pool = mysql.getPool()
  if (!pool) {
    return res.json({ ok: false, mysql: 'no configurado' })
  }
  try {
    const [rows] = await pool.query('SELECT 1 AS ping')
    const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM resultados_sorteos')
    const [latest] = await pool.query(
      'SELECT * FROM resultados_sorteos ORDER BY updated_at DESC LIMIT 10'
    )
    res.json({
      ok: true,
      mysql: 'conectado',
      total_resultados: countRows[0].total,
      ultimos: latest,
    })
  } catch (err) {
    res.json({ ok: false, mysql: 'error', error: err.message })
  }
})

router.post('/mysql/sync-all', async (req, res) => {
  // Sincroniza todos los resultados del JSON local hacia MySQL
  const { getLatestResults } = require('../services/database')
  const local = getLatestResults(10000)
  let ok = 0
  let fail = 0
  for (const row of local) {
    const saved = await mysql.saveResult(row.fecha, row.sorteo, row.resultado, row.source || 'sync')
    if (saved) ok++
    else fail++
  }
  saveAuditLog({ action: 'mysql_sync_all', actor: req.admin.username, payload: { local: local.length, ok, fail } })
  res.json({ ok: true, total_local: local.length, sincronizados: ok, fallos: fail })
})

router.post('/clear-cache', (req, res) => {
  clearResults()
  saveAuditLog({ action: 'clear_cache', actor: req.admin.username })
  res.json({ ok: true })
})

module.exports = router
