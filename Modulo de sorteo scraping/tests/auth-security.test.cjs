'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { comparePassword, verifyCronSecret, safeEqual } = require('../services/auth')

function mockResponse() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
}

test('no acepta la contraseña en texto plano del entorno', async () => {
  const previousHash = process.env.ADMIN_PASSWORD_HASH
  const previousPassword = process.env.ADMIN_PASSWORD
  delete process.env.ADMIN_PASSWORD_HASH
  process.env.ADMIN_PASSWORD = 'admin123'
  try { assert.equal(await comparePassword('admin123'), false) }
  finally {
    if (previousHash === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = previousHash
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previousPassword
  }
})

test('el cron falla cerrado sin secreto y no lee secretos desde la URL', () => {
  const previous = process.env.CRON_SECRET
  delete process.env.CRON_SECRET
  try {
    const res = mockResponse(); let nextCalled = false
    verifyCronSecret({ query:{ secret:'url-secret' }, headers:{} }, res, () => { nextCalled = true })
    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 503)
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous }
})

test('el cron compara el secreto del encabezado y acepta solo coincidencia completa', () => {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 's'.repeat(40)
  try {
    const accepted = mockResponse(); let acceptedNext = false
    verifyCronSecret({ headers:{ 'x-cron-secret':process.env.CRON_SECRET } }, accepted, () => { acceptedNext = true })
    assert.equal(acceptedNext, true)
    const rejected = mockResponse()
    verifyCronSecret({ headers:{ 'x-cron-secret':'wrong' } }, rejected, () => {})
    assert.equal(rejected.statusCode, 401)
    assert.equal(safeEqual('s'.repeat(40), 's'.repeat(40)), true)
    assert.equal(safeEqual('s'.repeat(40), 's'.repeat(39)), false)
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous }
})
