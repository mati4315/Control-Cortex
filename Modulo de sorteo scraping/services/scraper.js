const axios = require('axios')
const { USER_AGENTS } = require('./constants')
const { getSettingsObject } = require('./config')
const { today, isToday, hasDrawPassed } = require('./time')

const IAFAS_API_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoic2lzZXh0cmFjdG9zIiwiaWF0IjoxNjg5MjUzMDM4fQ.K74dsnw140HpyEEcVJW4BAlFHjWqXxDM5KvoObqjcBY'
const IAFAS_API_URL = 'https://servicios.iafas.gov.ar/ServicioExtracto/ultimoExtracto'

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractResultFromJson(data, fecha, sorteo) {
  if (!Array.isArray(data)) return null
  const normalizedDraw = normalizeText(sorteo)
  
  for (const row of data) {
    if (row.Ubicacion !== 1) continue // Solo nos interesa el primer premio
    if (row.NroLoteria !== 1) continue // Solo Loteria de Entre Rios (1)
    
    // row.FechaSorteo viene como "2026-05-28T00:00:00.000Z"
    if (!row.FechaSorteo || !row.FechaSorteo.startsWith(fecha)) {
      continue
    }
    
    const mod = normalizeText(row.Modalidad)
    if (!mod.includes(normalizedDraw) && !normalizedDraw.includes(mod)) {
      continue
    }
    
    // Lo encontramos, devolvemos el valor asegurando 4 cifras
    return String(row.Valor).padStart(4, '0')
  }
  
  return null
}

async function scrapeIafas(fecha, sorteo, attempt = 0) {
  const settings = getSettingsObject()

  if (isToday(fecha) && !hasDrawPassed(fecha, sorteo)) {
    return { ok: true, resultado: null, skipped: true, reason: 'draw_not_started' }
  }

  try {
    const apiUrl = (settings.scraper_url && settings.scraper_url.includes('ultimoExtracto')) 
      ? settings.scraper_url 
      : IAFAS_API_URL;

    const response = await axios.post(apiUrl, {}, {
      timeout: Number(settings.scraper_timeout_ms || 12000),
      headers: {
        'User-Agent': randomUserAgent(),
        'Authorization': `Bearer ${IAFAS_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://servicios.iafas.gov.ar',
        'Referer': 'https://servicios.iafas.gov.ar/iafasextractos/'
      },
    })

    const resultado = extractResultFromJson(response.data, fecha, sorteo)
    return {
      ok: true,
      resultado: resultado || null,
      skipped: false,
      reason: resultado ? 'scraped' : 'not_found',
    }
  } catch (error) {
    const retries = Number(settings.scraper_retries || 3)
    if (attempt + 1 < retries) {
      return scrapeIafas(fecha, sorteo, attempt + 1)
    }

    return {
      ok: false,
      resultado: null,
      skipped: false,
      reason: 'request_failed',
      error: error.message,
    }
  }
}

module.exports = {
  scrapeIafas,
  extractResultFromJson,
}
