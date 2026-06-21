const cron = require('node-cron')
const { DRAW_ORDER } = require('./constants')
const { getSettingsObject } = require('./config')
const { today, isWithinWindow } = require('./time')
const { syncMany } = require('./sync')
const { saveSyncLog } = require('./database')

let task = null

function startScheduler() {
  const settings = getSettingsObject()
  if (!settings.enable_scheduler) {
    console.log('[scheduler] desactivado por configuración')
    return
  }

  const pattern = settings.scheduler_pattern || '*/2 * * * *'
  task = cron.schedule(pattern, async () => {
    const fecha = today()
    const activeDraws = DRAW_ORDER.filter((drawKey) => isWithinWindow(drawKey, fecha))

    if (!activeDraws.length) {
      saveSyncLog({ fecha, status: 'scheduler_skip', source: 'scheduler', detail: 'no_active_windows' })
      return
    }

    console.log(`[scheduler] sincronizando: ${activeDraws.join(', ')}`)
    await syncMany({ fecha, sorteos: activeDraws, source: 'scheduler' })
  })

  console.log(`[scheduler] activo con patrón ${pattern}`)
}

function stopScheduler() {
  if (task) {
    task.stop()
    task = null
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
}
