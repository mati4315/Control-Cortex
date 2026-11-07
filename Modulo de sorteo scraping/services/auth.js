const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b)
}

function signAdminToken(payload) {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32 || secret === 'cambia_esta_clave_larga') throw new Error('JWT_SECRET debe tener al menos 32 caracteres aleatorios')
  return jwt.sign(payload, secret, { expiresIn: '8h' })
}

function verifyAdminToken(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET no configurado')
    req.admin = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
}

async function comparePassword(plainText) {
  const hash = process.env.ADMIN_PASSWORD_HASH
  if (!hash || !/^\$2[aby]\$\d{2}\$/.test(hash)) return false
  return bcrypt.compare(String(plainText || ''), hash)
}

function verifyCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET
  if (!expected || expected.length < 32) {
    return res.status(503).json({ error: 'CRON_SECRET no está configurado con una clave segura.' })
  }

  const received = req.headers['x-cron-secret']
  if (!safeEqual(received, expected)) {
    return res.status(401).json({ error: 'Secret inválido' })
  }

  next()
}

module.exports = {
  signAdminToken,
  verifyAdminToken,
  comparePassword,
  verifyCronSecret,
  safeEqual,
}
