require('dotenv').config()
const { initPool, ensureTables, closePool } = require('./services/mysql')

async function setup() {
  console.log('Conectando a MySQL...')
  initPool()
  console.log('Creando tablas...')
  const ok = await ensureTables()
  if (ok) {
    console.log('Tablas creadas exitosamente.')
  } else {
    console.log('Error creando tablas.')
  }
  await closePool()
}

setup()
