'use strict'

const LOCAL_DASHBOARD_ORIGINS = ['http://localhost:8872', 'http://127.0.0.1:8872']

function parseOriginList(value, fallback = LOCAL_DASHBOARD_ORIGINS, production = false) {
  const source = String(value || '').trim()
  const values = source ? source.split(',') : fallback
  const origins = [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))]
  if (production) return origins.filter(origin => origin !== '*')
  return origins
}

function makeOriginCallback(allowedOrigins, production = false) {
  const origins = Array.isArray(allowedOrigins) ? allowedOrigins : []
  return (origin, callback) => {
    if (!origin) return callback(null, true)
    const allowed = (origins.includes('*') && !production) || origins.includes(String(origin))
    return callback(null, allowed)
  }
}

function productionWarnings(env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() !== 'production') return []
  const warnings = []
  if (!env.JWT_SECRET || String(env.JWT_SECRET).length < 32 || env.JWT_SECRET === 'cambia_esta_clave_larga') warnings.push('JWT_SECRET debe ser una clave aleatoria de al menos 32 caracteres.')
  if (!String(env.ADMIN_USERNAME || '').trim()) warnings.push('ADMIN_USERNAME debe tener un valor propio.')
  if (!/^\$2[aby]\$\d{2}\$/.test(String(env.ADMIN_PASSWORD_HASH || ''))) warnings.push('ADMIN_PASSWORD_HASH debe contener un hash bcrypt; las contraseñas en texto plano ya no se aceptan.')
  if (!env.CRON_SECRET || String(env.CRON_SECRET).length < 32) warnings.push('CRON_SECRET debe ser una clave aleatoria de al menos 32 caracteres.')
  if (!String(env.CORS_ORIGIN || '').trim()) warnings.push('CORS_ORIGIN debe listar los orígenes exactos autorizados para la API.')
  if (!String(env.DASHBOARD_ORIGIN || '').trim()) warnings.push('DASHBOARD_ORIGIN debe listar los orígenes exactos autorizados para WebSocket.')
  if (String(env.CORS_ORIGIN || '').split(',').some(origin => origin.trim() === '*')) warnings.push('CORS_ORIGIN no debe usar * en producción.')
  if (String(env.DASHBOARD_ORIGIN || '').split(',').some(origin => origin.trim() === '*')) warnings.push('DASHBOARD_ORIGIN no debe usar * en producción.')
  return warnings
}

module.exports = { LOCAL_DASHBOARD_ORIGINS, parseOriginList, makeOriginCallback, productionWarnings }
