const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const http = require('http')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')

const apiRoutes = require('./routes/api')
const adminRoutes = require('./routes/admin')
const { getSettingsObject } = require('./services/config')
const { startScheduler } = require('./services/scheduler')
const websocket = require('./services/websocket')
const mysql = require('./services/mysql')

const app = express()
const server = http.createServer(app)
const settings = getSettingsObject()

app.use(helmet({ contentSecurityPolicy: false }))
app.use(compression())
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }))
app.use(morgan('combined'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: Number(settings.rate_limit_per_minute || 100),
  standardHeaders: true,
  legacyHeaders: false,
}))

app.use(express.static(path.join(__dirname, 'public')))
app.use('/api/admin', adminRoutes)
app.use('/api', apiRoutes)

app.get('/', (_, res) => {
  res.redirect('/dashboard.html')
})

if (settings.enable_websocket !== false) {
  websocket.init(server, process.env.DASHBOARD_ORIGIN || '*')
  console.log('[ws] habilitado')
} else {
  console.log('[ws] deshabilitado por configuración')
}

// Inicializar MySQL remoto (best-effort, si no hay conexión no rompe nada)
mysql.initPool()
mysql.ensureTables()

startScheduler()

const PORT = Number(process.env.PORT || 3000)
server.listen(PORT, () => {
  console.log(`Servidor IAFAS iniciado en http://localhost:${PORT}`)
  console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`)
})
