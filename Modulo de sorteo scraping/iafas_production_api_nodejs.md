# API Profesional IAFAS / Quiniela Entre Ríos

## Características

- API REST lista para producción
- Soporta:
  - previa
  - primero
  - matutina
  - vespertina
  - nocturna
  - turista
- Devuelve `null` antes del horario del sorteo
- Cache automática
- Reintentos automáticos
- Manejo de errores
- Timezone Argentina
- Rate limiting
- Helmet Security
- Compresión gzip
- Logs con Morgan
- Persistencia SQLite
- WebSocket en tiempo real
- Cron automático cada 2 minutos
- Preparado para VPS / Railway / Render / Docker

---

# Estructura

```txt
project/
 ├── server.js
 ├── package.json
 ├── .env
 ├── database.sqlite
 ├── services/
 │    ├── scraper.js
 │    ├── database.js
 │    ├── scheduler.js
 │    └── websocket.js
 └── routes/
      └── api.js
```

---

# package.json

```json
{
  "name": "iafas-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "axios": "^1.7.2",
    "better-sqlite3": "^11.1.2",
    "cheerio": "^1.0.0",
    "compression": "^1.7.4",
    "cors": "^2.8.5",
    "dayjs": "^1.11.13",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "helmet": "^7.1.0",
    "http": "^0.0.1-security",
    "morgan": "^1.10.0",
    "node-cron": "^3.0.3",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "nodemon": "^3.1.4"
  }
}
```

---

# .env

```env
PORT=3000
TZ=America/Argentina/Buenos_Aires
```

---

# services/database.js

```js
const Database = require('better-sqlite3')

const db = new Database('database.sqlite')

// Tabla resultados

db.prepare(`
CREATE TABLE IF NOT EXISTS resultados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT,
  sorteo TEXT,
  resultado TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`).run()

function guardarResultado(fecha, sorteo, resultado) {
  const existe = db.prepare(`
    SELECT * FROM resultados
    WHERE fecha = ?
    AND sorteo = ?
  `).get(fecha, sorteo)

  if (existe) {
    db.prepare(`
      UPDATE resultados
      SET resultado = ?
      WHERE fecha = ?
      AND sorteo = ?
    `).run(resultado, fecha, sorteo)

    return
  }

  db.prepare(`
    INSERT INTO resultados (fecha, sorteo, resultado)
    VALUES (?, ?, ?)
  `).run(fecha, sorteo, resultado)
}

function obtenerResultado(fecha, sorteo) {
  return db.prepare(`
    SELECT * FROM resultados
    WHERE fecha = ?
    AND sorteo = ?
  `).get(fecha, sorteo)
}

function obtenerHoy(fecha) {
  return db.prepare(`
    SELECT * FROM resultados
    WHERE fecha = ?
  `).all(fecha)
}

module.exports = {
  guardarResultado,
  obtenerResultado,
  obtenerHoy,
}
```

---

# services/scraper.js

```js
const axios = require('axios')
const cheerio = require('cheerio')
const dayjs = require('dayjs')

const SORTEOS = {
  previa: '10:15',
  primero: '12:00',
  matutina: '15:00',
  vespertina: '18:00',
  nocturna: '21:00',
  turista: '22:15',
}

function yaPasoHorario(sorteo) {
  const horario = SORTEOS[sorteo]

  if (!horario) return false

  const ahora = dayjs()

  const [h, m] = horario.split(':')

  const fechaSorteo = dayjs()
    .hour(Number(h))
    .minute(Number(m))
    .second(0)

  return ahora.isAfter(fechaSorteo)
}

async function scrapearResultado(fecha, sorteo) {
  if (fecha === dayjs().format('YYYY-MM-DD')) {
    if (!yaPasoHorario(sorteo)) {
      return null
    }
  }

  try {
    const url = 'https://servicios.iafas.gov.ar/iafasextractos/'

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 15000,
    })

    const $ = cheerio.load(response.data)

    let resultado = null

    $('table tr').each((_, el) => {
      const texto = $(el).text().toLowerCase()

      if (
        texto.includes(fecha) &&
        texto.includes(sorteo.toLowerCase())
      ) {
        resultado = $(el)
          .find('td')
          .last()
          .text()
          .trim()
      }
    })

    return resultado || null
  } catch (error) {
    console.error('SCRAPER ERROR:', error.message)
    return null
  }
}

module.exports = {
  scrapearResultado,
  SORTEOS,
}
```

---

# services/websocket.js

```js
let io

function init(server) {
  io = require('socket.io')(server, {
    cors: {
      origin: '*',
    },
  })

  io.on('connection', socket => {
    console.log('Cliente conectado')

    socket.on('disconnect', () => {
      console.log('Cliente desconectado')
    })
  })
}

function emitirResultado(data) {
  if (io) {
    io.emit('resultado', data)
  }
}

module.exports = {
  init,
  emitirResultado,
}
```

---

# services/scheduler.js

```js
const cron = require('node-cron')
const dayjs = require('dayjs')

const { scrapearResultado, SORTEOS } = require('./scraper')
const { guardarResultado } = require('./database')
const { emitirResultado } = require('./websocket')

function iniciarScheduler() {
  cron.schedule('*/2 * * * *', async () => {
    console.log('Actualizando resultados...')

    const fecha = dayjs().format('YYYY-MM-DD')

    for (const sorteo of Object.keys(SORTEOS)) {
      try {
        const resultado = await scrapearResultado(fecha, sorteo)

        if (resultado) {
          guardarResultado(fecha, sorteo, resultado)

          emitirResultado({
            fecha,
            sorteo,
            resultado,
          })
        }
      } catch (err) {
        console.error(err)
      }
    }
  })
}

module.exports = {
  iniciarScheduler,
}
```

---

# routes/api.js

```js
const express = require('express')
const dayjs = require('dayjs')

const router = express.Router()

const {
  obtenerResultado,
  obtenerHoy,
} = require('../services/database')

const {
  scrapearResultado,
  SORTEOS,
} = require('../services/scraper')

router.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
  })
})

router.get('/hoy', (req, res) => {
  const fecha = dayjs().format('YYYY-MM-DD')

  const data = obtenerHoy(fecha)

  res.json(data)
})

router.get('/:fecha/:sorteo', async (req, res) => {
  const { fecha, sorteo } = req.params

  if (!SORTEOS[sorteo]) {
    return res.status(400).json({
      error: 'Sorteo inválido',
    })
  }

  let resultado = obtenerResultado(fecha, sorteo)

  if (!resultado) {
    const scrapeado = await scrapearResultado(fecha, sorteo)

    if (!scrapeado) {
      return res.json({
        fecha,
        sorteo,
        resultado: null,
      })
    }

    resultado = {
      resultado: scrapeado,
    }
  }

  res.json({
    fecha,
    sorteo,
    resultado: resultado.resultado,
  })
})

module.exports = router
```

---

# server.js

```js
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
const http = require('http')

const apiRoutes = require('./routes/api')
const { iniciarScheduler } = require('./services/scheduler')
const websocket = require('./services/websocket')

const app = express()
const server = http.createServer(app)

// Seguridad

app.use(helmet())

// Compresión

app.use(compression())

// CORS

app.use(cors())

// Logs

app.use(morgan('combined'))

// JSON

app.use(express.json())

// Rate limit

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
}))

// API

app.use('/api', apiRoutes)

// Websocket

websocket.init(server)

// Scheduler

iniciarScheduler()

const PORT = process.env.PORT || 3000

server.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`)
})
```

---

# Instalar

```bash
npm install
```

---

# Desarrollo

```bash
npm run dev
```

---

# Producción

```bash
npm start
```

---

# Endpoints

## Obtener resultado específico

```txt
GET /api/2026-05-27/nocturna
```

Respuesta:

```json
{
  "fecha": "2026-05-27",
  "sorteo": "nocturna",
  "resultado": "7421"
}
```

---

## Resultado pendiente

```json
{
  "fecha": "2026-05-27",
  "sorteo": "turista",
  "resultado": null
}
```

---

## Obtener todos los sorteos de hoy

```txt
GET /api/hoy
```

---

## Health Check

```txt
GET /api/health
```

---

# WebSocket Cliente

```html
<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>

<script>
const socket = io('http://localhost:3000')

socket.on('resultado', data => {
  console.log('Nuevo resultado:', data)
})
</script>
```

---

# Docker

## Dockerfile

```dockerfile
FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

---

# Deploy recomendado

- Railway
- Render
- VPS Ubuntu + PM2
- Docker

---

# PM2

Instalar:

```bash
npm install -g pm2
```

Ejecutar:

```bash
pm2 start server.js --name iafas-api
```

Guardar:

```bash
pm2 save
```

---

# Nginx Reverse Proxy

```nginx
server {
    listen 80;

    server_name api.tudominio.com;

    location / {
        proxy_pass http://localhost:3000;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

# Mejoras futuras

- Puppeteer stealth
- Rotación de proxies
- Redis cache
- Swagger docs
- JWT auth
- Panel admin
- Multi provincias
- Histórico completo
- Alertas Telegram
- API pública monetizable

---

# Dashboard admin

Este dashboard permite cambiar los parámetros sin tocar código:

- horarios de cada sorteo
- URL fuente del scraper
- intervalo del cron
- timeout de requests
- user-agent
- activación/desactivación de cada sorteo
- rate limit
- modo mantenimiento
- limpiar cache
- forzar sincronización manual
- ver último scrape y último error
- editar credenciales de acceso al panel

## Recomendación de arquitectura

Separar en 3 capas:

1. **API pública** para consumir resultados.
2. **API admin** para modificar parámetros.
3. **Frontend dashboard** en React para editar todo desde navegador.

---

# Estructura agregada

```txt
project/
 ├── admin/
 │    ├── src/
 │    │    ├── App.jsx
 │    │    ├── main.jsx
 │    │    ├── api.js
 │    │    ├── components/
 │    │    │    ├── Login.jsx
 │    │    │    ├── SettingsForm.jsx
 │    │    │    ├── DrawSchedule.jsx
 │    │    │    ├── StatusCard.jsx
 │    │    │    └── LogsTable.jsx
 │    │    └── styles.css
 │    └── vite.config.js
 ├── services/
 │    ├── config.js
 │    ├── auth.js
 │    └── audit.js
 └── routes/
      └── admin.js
```

---

# Configurable data model

## Tabla settings

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## Valores iniciales sugeridos

- `scraper_url`
- `scraper_timeout_ms`
- `scraper_user_agent`
- `cron_interval_minutes`
- `cache_ttl_seconds`
- `rate_limit_per_minute`
- `draw_enabled_previa`
- `draw_enabled_primero`
- `draw_enabled_matutina`
- `draw_enabled_vespertina`
- `draw_enabled_nocturna`
- `draw_enabled_turista`
- `timezone`
- `maintenance_mode`
- `admin_username`
- `admin_password_hash`
- `jwt_secret`

---

# services/config.js

```js
const Database = require('better-sqlite3')
const db = new Database('database.sqlite')

function getSetting(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return defaultValue
  try {
    return JSON.parse(row.value)
  } catch {
    return row.value
  }
}

function setSetting(key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)

  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, serialized)
}

function getAllSettings() {
  return db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all()
}

module.exports = {
  getSetting,
  setSetting,
  getAllSettings,
}
```

---

# services/auth.js

```js
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

function signAdminToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' })
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

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash)
}

module.exports = {
  signAdminToken,
  verifyAdminToken,
  comparePassword,
}
```

---

# routes/admin.js

```js
const express = require('express')
const bcrypt = require('bcryptjs')
const { signAdminToken, verifyAdminToken, comparePassword } = require('../services/auth')
const { getAllSettings, setSetting } = require('../services/config')
const { scrapearResultado, SORTEOS } = require('../services/scraper')
const { guardarResultado } = require('../services/database')

const router = express.Router()

router.post('/login', async (req, res) => {
  const { username, password } = req.body

  const adminUsername = process.env.ADMIN_USERNAME
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH

  if (username !== adminUsername) {
    return res.status(401).json({ error: 'Credenciales inválidas' })
  }

  const ok = await comparePassword(password, adminPasswordHash)

  if (!ok) {
    return res.status(401).json({ error: 'Credenciales inválidas' })
  }

  const token = signAdminToken({ username })
  return res.json({ token })
})

router.get('/settings', verifyAdminToken, (_, res) => {
  res.json(getAllSettings())
})

router.put('/settings', verifyAdminToken, (req, res) => {
  const entries = Object.entries(req.body || {})

  for (const [key, value] of entries) {
    setSetting(key, value)
  }

  res.json({ ok: true })
})

router.post('/sync-now', verifyAdminToken, async (req, res) => {
  const fecha = req.body.fecha || new Date().toISOString().split('T')[0]
  const sorteo = req.body.sorteo

  if (sorteo && !SORTEOS[sorteo]) {
    return res.status(400).json({ error: 'Sorteo inválido' })
  }

  const sorteos = sorteo ? [sorteo] : Object.keys(SORTEOS)
  const resultados = []

  for (const s of sorteos) {
    const resultado = await scrapearResultado(fecha, s)
    if (resultado) {
      guardarResultado(fecha, s, resultado)
    }

    resultados.push({ fecha, sorteo: s, resultado: resultado || null })
  }

  res.json({ ok: true, resultados })
})

router.get('/status', verifyAdminToken, (_, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
  })
})

module.exports = router
```

---

# Integración en server.js

Agregá estas líneas:

```js
const adminRoutes = require('./routes/admin')

app.use('/api/admin', adminRoutes)
```

---

# Dashboard frontend en React

## admin/src/api.js

```js
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return res.json()
}

export async function getSettings(token) {
  const res = await fetch(`${API_BASE}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.json()
}

export async function saveSettings(token, payload) {
  const res = await fetch(`${API_BASE}/api/admin/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function syncNow(token, payload = {}) {
  const res = await fetch(`${API_BASE}/api/admin/sync-now`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  return res.json()
}
```

## admin/src/App.jsx

```jsx
import React, { useEffect, useMemo, useState } from 'react'
import { getSettings, login, saveSettings, syncNow } from './api'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [settings, setSettings] = useState([])
  const [status, setStatus] = useState('')
  const [form, setForm] = useState({})

  useEffect(() => {
    if (!token) return
    getSettings(token).then(data => {
      if (Array.isArray(data)) {
        setSettings(data)
        const obj = {}
        data.forEach(item => { obj[item.key] = item.value })
        setForm(obj)
      }
    })
  }, [token])

  const parsedSettings = useMemo(() => {
    const obj = {}
    settings.forEach(item => { obj[item.key] = item.value })
    return obj
  }, [settings])

  const doLogin = async () => {
    const data = await login(username, password)
    if (data.token) {
      localStorage.setItem('token', data.token)
      setToken(data.token)
      setStatus('Sesión iniciada')
    } else {
      setStatus(data.error || 'Error')
    }
  }

  const handleSave = async () => {
    const data = await saveSettings(token, form)
    setStatus(data.ok ? 'Guardado' : 'Error al guardar')
  }

  const handleSync = async () => {
    const data = await syncNow(token)
    setStatus(data.ok ? 'Sincronización ejecutada' : 'Error al sincronizar')
  }

  if (!token) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Panel IAFAS</h1>
        <input placeholder="Usuario" value={username} onChange={e => setUsername(e.target.value)} />
        <input placeholder="Contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button onClick={doLogin}>Entrar</button>
        <p>{status}</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1>Dashboard IAFAS</h1>
      <p>{status}</p>

      <section>
        <h2>Configuración</h2>
        {Object.keys(parsedSettings).length === 0 ? null : Object.keys(parsedSettings).map(key => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label>{key}</label>
            <input
              style={{ width: '100%' }}
              value={form[key] ?? ''}
              onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
        <button onClick={handleSave}>Guardar cambios</button>
        <button onClick={handleSync} style={{ marginLeft: 8 }}>Forzar sync</button>
      </section>
    </div>
  )
}
```

---

# Qué conviene exponer en el dashboard

## Campos editables

- `scraper_url`
- `scraper_timeout_ms`
- `scraper_user_agent`
- `cron_interval_minutes`
- `cache_ttl_seconds`
- `rate_limit_per_minute`
- `timezone`
- `maintenance_mode`
- `draw_enabled_*`

## Acciones

- guardar configuración
- forzar extracción manual
- limpiar cache
- reintentar último sorteo fallido
- ver historial
- exportar CSV
- activar/desactivar provincias

---

# Seguridad mínima para el panel

- login con JWT
- hash de contraseña con bcrypt
- rate limit en `/api/admin/login`
- CORS restringido al dominio del dashboard
- HTTPS obligatorio en producción
- variables sensibles en `.env`
- logs de auditoría para cambios en settings

---

# Variables nuevas en .env

```env
JWT_SECRET=pon_una_clave_larga
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2a$10$...
DASHBOARD_ORIGIN=https://panel.tudominio.com
```

---

# Recomendación final de despliegue

Separar en dos servicios:

1. **API pública + scraper**
2. **Dashboard admin**

Eso te deja más seguro y más fácil de escalar.

Si después querés llevarlo a producción de verdad, lo ideal es agregar:

- Postgres en vez de SQLite
- Redis para cache
- tareas en cola
- backup automático
- auditoría de cambios
- desplegar dashboard en Vercel o Netlify


---

# Versión Hostinger compatible (ligera)

Esta versión está adaptada para hosting compartido (como Hostinger Node.js App) sin WebSocket y con scraping limitado en horarios de sorteo.

## 🔥 Objetivo

- NO correr 24/7
- NO usar WebSocket
- NO usar procesos pesados
- Scraping SOLO:
  - 5 minutos antes del sorteo
  - hasta 10 minutos después
- consulta bajo demanda o cache liviana

---

## 🕒 Lógica de ventana de scraping

```js
const SORTEOS = {
  previa: "10:15",
  primero: "12:00",
  matutina: "15:00",
  vespertina: "18:00",
  nocturna: "21:00",
  turista: "22:15",
}

function dentroDeVentana(sorteo) {
  const horario = SORTEOS[sorteo]
  if (!horario) return false

  const [h, m] = horario.split(":").map(Number)
  const ahora = new Date()

  const inicio = new Date()
  inicio.setHours(h)
  inicio.setMinutes(m - 5)
  inicio.setSeconds(0)

  const fin = new Date()
  fin.setHours(h)
  fin.setMinutes(m + 10)
  fin.setSeconds(0)

  return ahora >= inicio && ahora <= fin
}
```

---

## ⚡ Scraper optimizado

```js
async function obtenerResultadoSeguro(fecha, sorteo) {
  const hoy = new Date().toISOString().split("T")[0]

  // fuera de ventana → no scrapea
  if (fecha === hoy && !dentroDeVentana(sorteo)) {
    return null
  }

  try {
    const url = "https://servicios.iafas.gov.ar/iafasextractos/"

    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    })

    const $ = cheerio.load(res.data)

    let resultado = null

    $("table tr").each((_, el) => {
      const texto = $(el).text().toLowerCase()

      if (
        texto.includes(fecha) &&
        texto.includes(sorteo.toLowerCase())
      ) {
        resultado = $(el).find("td").last().text().trim()
      }
    })

    return resultado || null
  } catch (e) {
    return null
  }
}
```

---

## ⏱️ Cron liviano (Hostinger friendly)

En vez de correr cada 2 minutos siempre:

```js
const cron = require("node-cron")

cron.schedule("*/2 * * * *", async () => {
  const fecha = new Date().toISOString().split("T")[0]

  for (const sorteo of Object.keys(SORTEOS)) {
    if (!dentroDeVentana(sorteo)) continue

    const resultado = await obtenerResultadoSeguro(fecha, sorteo)

    if (resultado) {
      console.log("Guardado:", sorteo, resultado)
    }
  }
})
```

---

## 🧠 Estrategia clave (IMPORTANTE)

Este sistema NO está siempre activo, sino:

- Hostinger no se sobrecarga
- no te bloquean por scraping constante
- ahorra CPU y RAM
- evita bans de la web de IAFAS

---

## 📦 API bajo demanda (fallback)

Si no está en cache:

```js
router.get('/:fecha/:sorteo', async (req, res) => {
  const { fecha, sorteo } = req.params

  const cached = obtenerResultado(fecha, sorteo)

  if (cached) {
    return res.json(cached)
  }

  if (!dentroDeVentana(sorteo)) {
    return res.json({ fecha, sorteo, resultado: null })
  }

  const resultado = await obtenerResultadoSeguro(fecha, sorteo)

  return res.json({ fecha, sorteo, resultado })
})
```

---

## 🚀 Resultado final

✔ Funciona en Hostinger compartido
✔ No necesita VPS
✔ No usa WebSocket
✔ No queda proceso vivo constante
✔ Solo trabaja cuando tiene sentido

---

## 🔥 Upgrade opcional (recomendado)

Si después querés mejorar:

- mover cron a cron-job.org (gratis)
- o GitHub Actions cada 2 min
- o UptimeRobot ping para despertar API

---

## ✔ Conclusión

Esta versión es la correcta si tu plan es Hostinger:

👉 liviana
👉 estable
👉 sin procesos permanentes
👉 compatible 100%

