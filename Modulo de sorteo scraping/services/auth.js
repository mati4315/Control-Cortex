const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

function signAdminToken(payload) {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET no configurado')
  return jwt.sign(payload, secret, { expiresIn: '8h' })
}

function verifyAdminToken(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
}

async function comparePassword(plainText) {
  const hash = process.env.ADMIN_PASSWORD_HASH
  const fallbackPlain = process.env.ADMIN_PASSWORD

  if (hash) {
    return bcrypt.compare(plainText, hash)
  }

  return Boolean(fallbackPlain) && plainText === fallbackPlain
}

function verifyCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET
  if (!expected) return next()

  const received = req.query.secret || req.headers['x-cron-secret']
  if (received !== expected) {
    return res.status(401).json({ error: 'Secret inválido' })
  }

  next()
}

module.exports = {
  signAdminToken,
  verifyAdminToken,
  comparePassword,
  verifyCronSecret,
}
