const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Default configuration for the party lights overlay
let lightsConfig = {
  preset: 'automatic',
  speed: 50,
  intensity: 80,
  fog: 40,
  colorPalette: 'rainbow',
  customColor1: '#ff0055',
  customColor2: '#00ffcc',
  discoBall: true,
  discoBallSpeed: 40,
  discoBallDots: true,
  lasers: true,
  laserCount: 4,
  laserColorMode: 'rainbow',
  laserPattern: 'bounce',
  laserSpeed: 50,
  spotlights: true,
  spotlightCount: 4,
  spotlightPattern: 'sweep',
  spotlightSpeed: 40,
  spotlightGobo: 'cone',
  strobe: false,
  strobeSpeed: 10,
  strobeColor: '#ffffff',
  strobeMode: 'freq',
  wash: true,
  washSpeed: 50,
  audioReactive: false,
  audioSensitivity: 50,
  bpm: 128,
  virtualBeat: true
};

// Load saved config if exists
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const savedData = fs.readFileSync(CONFIG_PATH, 'utf8');
    lightsConfig = { ...lightsConfig, ...JSON.parse(savedData) };
    console.log('Configuration successfully loaded from config.json');
  }
} catch (e) {
  console.error('Error loading config.json, using defaults:', e.message);
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(lightsConfig, null, 2), 'utf8');
    console.log('Configuration successfully saved to config.json');
  } catch (e) {
    console.error('Error writing config.json:', e.message);
  }
}

let connectedOverlays = 0;
let connectedDashboards = 0;

io.on('connection', (socket) => {
  const clientType = socket.handshake.query.type || 'unknown';
  if (clientType === 'overlay') {
    connectedOverlays++;
    console.log(`Overlay connected. Total overlays: ${connectedOverlays}`);
  } else if (clientType === 'dashboard') {
    connectedDashboards++;
    console.log(`Dashboard connected. Total dashboards: ${connectedDashboards}`);
  }

  // Send current config immediately to newly connected client
  socket.emit('configUpdate', lightsConfig);

  // Broadcast connection status to all clients
  io.emit('connectionStatus', {
    overlays: connectedOverlays,
    dashboards: connectedDashboards
  });

  socket.on('disconnect', () => {
    if (clientType === 'overlay') {
      connectedOverlays = Math.max(0, connectedOverlays - 1);
      console.log(`Overlay disconnected. Total overlays: ${connectedOverlays}`);
    } else if (clientType === 'dashboard') {
      connectedDashboards = Math.max(0, connectedDashboards - 1);
      console.log(`Dashboard disconnected. Total dashboards: ${connectedDashboards}`);
    }
    io.emit('connectionStatus', {
      overlays: connectedOverlays,
      dashboards: connectedDashboards
    });
  });

  // Listen for config changes from dashboard
  socket.on('updateConfig', (newConfig) => {
    lightsConfig = { ...lightsConfig, ...newConfig };
    saveConfig();
    
    // Broadcast config update to everyone (especially overlays)
    io.emit('configUpdate', lightsConfig);
  });

  // Listen for beat triggers from dashboard/audio analysis
  socket.on('beatTrigger', (data) => {
    // Relay beat trigger to overlays
    socket.broadcast.emit('beatTrigger', data);
  });
});

const PORT = process.env.PORT || 3758;
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  🎉 Servidor de Luces de Fiesta Activo 🎉`);
  console.log(`  Panel de Control: http://localhost:${PORT}/dashboard.html`);
  console.log(`  Overlay para OBS: http://localhost:${PORT}/overlay.html`);
  console.log(`======================================================\n`);
});
