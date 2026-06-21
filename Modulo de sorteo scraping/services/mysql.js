/**
 * Servicio MySQL remoto para espejar resultados de scraping.
 * Se conecta a la DB Hostinger y replica los datos scrapeados.
 * No reemplaza el cache JSON local — funciona en paralelo.
 */
const mysql = require('mysql2/promise')

let pool = null

function getConfig() {
  return {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: Number(process.env.MYSQL_PORT || 3306),
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 10000),
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 3),
    queueLimit: 0,
  }
}

/**
 * Crea el pool de conexiones. Llama una vez al arrancar.
 */
function initPool() {
  if (pool) return pool
  if (!process.env.MYSQL_HOST) {
    console.log('[mysql] no configurado (MYSQL_HOST vacío) — desactivado')
    return null
  }
  try {
    pool = mysql.createPool(getConfig())
    console.log('[mysql] pool iniciado')
    return pool
  } catch (err) {
    console.error('[mysql] error al crear pool:', err.message)
    return null
  }
}

/**
 * Obtiene el pool actual.
 */
function getPool() {
  if (!pool) return initPool()
  return pool
}

/**
 * Cierra el pool ordenadamente.
 */
async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
    console.log('[mysql] pool cerrado')
  }
}

const TABLE_RESULTADOS = `
CREATE TABLE IF NOT EXISTS resultados_sorteos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATE NOT NULL,
  sorteo VARCHAR(20) NOT NULL,
  resultado VARCHAR(50) DEFAULT NULL,
  source VARCHAR(50) DEFAULT 'scraper',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_fecha_sorteo (fecha, sorteo),
  INDEX idx_fecha (fecha),
  INDEX idx_sorteo (sorteo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`

const TABLE_SYNC_LOG = `
CREATE TABLE IF NOT EXISTS sync_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATE DEFAULT NULL,
  sorteo VARCHAR(20) DEFAULT NULL,
  status VARCHAR(30) NOT NULL,
  source VARCHAR(50) DEFAULT 'system',
  detail TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`

/**
 * Crea las tablas si no existen.
 */
async function ensureTables() {
  const p = getPool()
  if (!p) return false
  try {
    await p.query(TABLE_RESULTADOS)
    await p.query(TABLE_SYNC_LOG)
    console.log('[mysql] tablas aseguradas')
    return true
  } catch (err) {
    console.error('[mysql] error creando tablas:', err.message)
    return false
  }
}

/**
 * Guarda o actualiza un resultado en MySQL.
 * Usa INSERT … ON DUPLICATE KEY UPDATE para upsert.
 */
async function saveResult(fecha, sorteo, resultado, source = 'scraper') {
  const p = getPool()
  if (!p) return false
  try {
    const sql = `
      INSERT INTO resultados_sorteos (fecha, sorteo, resultado, source)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        resultado = VALUES(resultado),
        source = VALUES(source),
        updated_at = CURRENT_TIMESTAMP
    `
    await p.query(sql, [fecha, sorteo, resultado, source])
    return true
  } catch (err) {
    console.error(`[mysql] error guardando ${fecha}/${sorteo}:`, err.message)
    return false
  }
}

/**
 * Guarda un log de sincronización en MySQL.
 */
async function saveSyncLog({ fecha = null, sorteo = null, status, source = 'system', detail = '' }) {
  const p = getPool()
  if (!p) return false
  try {
    const sql = `
      INSERT INTO sync_logs (fecha, sorteo, status, source, detail)
      VALUES (?, ?, ?, ?, ?)
    `
    await p.query(sql, [fecha, sorteo, status, source, detail])
    return true
  } catch (err) {
    console.error(`[mysql] error guardando sync_log:`, err.message)
    return false
  }
}

/**
 * Obtiene resultados de MySQL para una fecha.
 */
async function getResultsByDate(fecha) {
  const p = getPool()
  if (!p) return []
  try {
    const [rows] = await p.query(
      'SELECT * FROM resultados_sorteos WHERE fecha = ? ORDER BY sorteo',
      [fecha]
    )
    return rows
  } catch (err) {
    console.error('[mysql] error consultando:', err.message)
    return []
  }
}

/**
 * Obtiene el último resultado de un sorteo en MySQL.
 */
async function getLatestResult(sorteo) {
  const p = getPool()
  if (!p) return null
  try {
    const [rows] = await p.query(
      'SELECT * FROM resultados_sorteos WHERE sorteo = ? ORDER BY fecha DESC, updated_at DESC LIMIT 1',
      [sorteo]
    )
    return rows.length ? rows[0] : null
  } catch (err) {
    console.error('[mysql] error consultando último:', err.message)
    return null
  }
}

/**
 * Obtiene todos los resultados ordenados por fecha DESC.
 */
async function getAllResults(limit = 100) {
  const p = getPool()
  if (!p) return []
  try {
    const [rows] = await p.query(
      'SELECT * FROM resultados_sorteos ORDER BY fecha DESC, sorteo ASC LIMIT ?',
      [limit]
    )
    return rows
  } catch (err) {
    console.error('[mysql] error consultando todos:', err.message)
    return []
  }
}

module.exports = {
  initPool,
  getPool,
  closePool,
  ensureTables,
  saveResult,
  saveSyncLog,
  getResultsByDate,
  getLatestResult,
  getAllResults,
}
