const { Server } = require('socket.io')

let io = null

function init(server, corsOrigin = '*') {
  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  })

  io.on('connection', (socket) => {
    socket.emit('status', {
      ok: true,
      message: 'Conectado al canal live de IAFAS',
      timestamp: Date.now(),
    })
  })
}

function emitUpdate(event, payload) {
  if (!io) return
  io.emit(event, payload)
}

module.exports = {
  init,
  emitUpdate,
}
