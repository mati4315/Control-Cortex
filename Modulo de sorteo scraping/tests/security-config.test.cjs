'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseOriginList, makeOriginCallback, productionWarnings } = require('../services/security-config')

test('los orígenes locales son el valor inicial y producción descarta el comodín', () => {
  assert.deepEqual(parseOriginList('', undefined, false), ['http://localhost:8872', 'http://127.0.0.1:8872'])
  assert.deepEqual(parseOriginList('*', ['http://localhost:8872'], true), [])
  assert.deepEqual(parseOriginList('https://a.example, https://b.example', [], true), ['https://a.example', 'https://b.example'])
})

test('la política CORS acepta solo orígenes configurados y llamadas de servidor', async () => {
  const origin = makeOriginCallback(['https://loteria.example'], true)
  const check = value => new Promise((resolve, reject) => origin(value, (error, allowed) => error ? reject(error) : resolve(allowed)))
  assert.equal(await check('https://loteria.example'), true)
  assert.equal(await check('https://evil.example'), false)
  assert.equal(await check(undefined), true)
})

test('la revisión de configuración advierte sobre claves y comodines inseguros sin revelar sus valores', () => {
  const warnings = productionWarnings({ NODE_ENV:'production', JWT_SECRET:'placeholder', ADMIN_USERNAME:'admin', ADMIN_PASSWORD_HASH:'', CRON_SECRET:'', CORS_ORIGIN:'*', DASHBOARD_ORIGIN:'*' })
  assert.ok(warnings.length >= 5)
  assert.ok(warnings.every(warning => !warning.includes('placeholder')))
  const missingOrigins = productionWarnings({ NODE_ENV:'production', JWT_SECRET:'x'.repeat(32), ADMIN_USERNAME:'admin', ADMIN_PASSWORD_HASH:'$2b$10$hash', CRON_SECRET:'x'.repeat(32) })
  assert.ok(missingOrigins.some(warning => warning.startsWith('CORS_ORIGIN')))
  assert.ok(missingOrigins.some(warning => warning.startsWith('DASHBOARD_ORIGIN')))
})
