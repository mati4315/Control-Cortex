const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const customParseFormat = require('dayjs/plugin/customParseFormat')
const { DRAWS, WINDOW_RULES } = require('./constants')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

function getTimezone() {
  return process.env.TZ || 'America/Argentina/Buenos_Aires'
}

function nowTz() {
  return dayjs().tz(getTimezone())
}

function today() {
  return nowTz().format('YYYY-MM-DD')
}

function buildDrawMoment(date, drawKey) {
  const draw = DRAWS[drawKey]
  if (!draw) return null
  return dayjs.tz(`${date} ${draw.time}`, 'YYYY-MM-DD HH:mm', getTimezone())
}

function isToday(date) {
  return date === today()
}

function hasDrawPassed(date, drawKey) {
  const drawMoment = buildDrawMoment(date, drawKey)
  if (!drawMoment) return false
  return nowTz().isAfter(drawMoment) || nowTz().isSame(drawMoment)
}

function isWithinWindow(drawKey, referenceDate = today()) {
  const drawMoment = buildDrawMoment(referenceDate, drawKey)
  if (!drawMoment) return false

  const start = drawMoment.subtract(WINDOW_RULES.beforeMinutes, 'minute')
  const end = drawMoment.add(WINDOW_RULES.afterMinutes, 'minute')
  const now = nowTz()

  return (now.isAfter(start) || now.isSame(start)) && (now.isBefore(end) || now.isSame(end))
}

function msUntilDraw(drawKey, referenceDate = today()) {
  const drawMoment = buildDrawMoment(referenceDate, drawKey)
  if (!drawMoment) return 0
  return Math.max(0, drawMoment.diff(nowTz()))
}

function getWindowForDraw(drawKey, referenceDate = today()) {
  const drawMoment = buildDrawMoment(referenceDate, drawKey)
  if (!drawMoment) return null

  return {
    start: drawMoment.subtract(WINDOW_RULES.beforeMinutes, 'minute').toISOString(),
    draw: drawMoment.toISOString(),
    end: drawMoment.add(WINDOW_RULES.afterMinutes, 'minute').toISOString(),
  }
}

function formatHumanDate(date = today()) {
  return dayjs.tz(date, 'YYYY-MM-DD', getTimezone()).format('DD/MM/YYYY')
}

module.exports = {
  dayjs,
  getTimezone,
  nowTz,
  today,
  isToday,
  hasDrawPassed,
  isWithinWindow,
  msUntilDraw,
  buildDrawMoment,
  getWindowForDraw,
  formatHumanDate,
}
