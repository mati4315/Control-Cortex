const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Default configuration for the overlay
let overlayConfig = {
  locations: [
    { id: 'loc1', text: 'Buenos Aires', timezone: 'America/Argentina/Buenos_Aires', city: 'Concepcion del Uruguay', visible: true, temp: '--°C', flag: 'ar', showClock: true, showWeather: true },
    { id: 'loc2', text: 'Brisbane', timezone: 'Australia/Brisbane', city: 'Gold Coast', visible: true, temp: '--°C', flag: 'au', showClock: true, showWeather: true },
    { id: 'loc3', text: 'San Justo', timezone: 'America/Argentina/Buenos_Aires', city: 'San Justo, Entre Rios', visible: true, temp: '--°C', flag: 'ar', showClock: true, showWeather: true }
  ],
  timeFormat: '12h',
  cycleDuration: 10, // defaults to 10 seconds per view
  themeColor: '#8b5cf6', // vibrant violet default
  themePreset: 'classic', // theme styling preset
  fontFamily: 'Roboto', // premium default font
  transitionType: 'slide-up', // transition animation
  cyclePaused: false, // pause loop rotation
  activeViewIndex: 0, // current active view index
  showLiveBar: true,
  liveBarText: 'EN VIVO',
  layoutStyle: 'card', // 'card' or 'ticker'
  position: 'top-left' // 'top-left', 'top-right', 'bottom-left', 'bottom-right'
};

// Load saved config if exists
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const savedData = fs.readFileSync(CONFIG_PATH, 'utf8');
    overlayConfig = JSON.parse(savedData);
    console.log('Configuration successfully loaded from config.json');
  }
} catch (e) {
  console.error('Error loading config.json, using defaults:', e.message);
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(overlayConfig, null, 2), 'utf8');
    console.log('Configuration successfully written to config.json');
  } catch (e) {
    console.error('Error writing config.json:', e.message);
  }
}

// Cache to avoid hitting geocoding and weather APIs too frequently
const geoCache = {};
const weatherCache = {}; // format: { [city]: { temp, code, isDay, timestamp } }

async function fetchTempForCity(city, bypassCache = false) {
  if (!city || city.trim() === '') return { temp: '', code: null, isDay: null };
  const normalizedCity = city.trim().toLowerCase();
  const now = Date.now();

  // Return cached weather if it's less than 10 minutes old
  if (!bypassCache && weatherCache[normalizedCity] && (now - weatherCache[normalizedCity].timestamp < 10 * 60 * 1000)) {
    return { temp: weatherCache[normalizedCity].temp, code: weatherCache[normalizedCity].code, isDay: weatherCache[normalizedCity].isDay };
  }

  try {
    let lat, lon;
    if (geoCache[normalizedCity]) {
      lat = geoCache[normalizedCity].lat;
      lon = geoCache[normalizedCity].lon;
    } else {
      let searchName = city.trim();
      let filterName = null;
      if (city.includes(',')) {
        const parts = city.split(',');
        searchName = parts[0].trim();
        filterName = parts.slice(1).join(',').trim().toLowerCase();
      }
      
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchName)}&count=20&format=json`);
      const geoData = await geoRes.json();
      
      if (!geoData.results || geoData.results.length === 0) {
        // Fallback: try searching with original city query if different
        if (searchName !== city.trim()) {
          const fallbackRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1&format=json`);
          const fallbackData = await fallbackRes.json();
          if (fallbackData.results && fallbackData.results.length > 0) {
            lat = fallbackData.results[0].latitude;
            lon = fallbackData.results[0].longitude;
          } else {
            return { temp: '--°C', code: null };
          }
        } else {
          return { temp: '--°C', code: null };
        }
      } else {
        let bestMatch = geoData.results[0];
        if (filterName) {
          const cleanFilter = filterName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          const match = geoData.results.find(r => {
            const admin1 = (r.admin1 || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const admin2 = (r.admin2 || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const country = (r.country || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            return admin1.includes(cleanFilter) || admin2.includes(cleanFilter) || country.includes(cleanFilter);
          });
          if (match) {
            bestMatch = match;
          }
        }
        lat = bestMatch.latitude;
        lon = bestMatch.longitude;
      }
      geoCache[normalizedCity] = { lat, lon };
    }

    const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
    const weatherData = await weatherRes.json();
    if (!weatherData.current_weather) return { temp: '--°C', code: null, isDay: null };
    
    const temp = `${Math.round(weatherData.current_weather.temperature)}°C`;
    const code = weatherData.current_weather.weathercode !== undefined ? weatherData.current_weather.weathercode : weatherData.current_weather.weather_code;
    // is_day: 1 = daytime, 0 = nighttime (provided by Open-Meteo)
    const isDay = weatherData.current_weather.is_day !== undefined ? weatherData.current_weather.is_day : null;
    weatherCache[normalizedCity] = { temp, code, isDay, timestamp: now };
    return { temp, code, isDay };
  } catch (e) {
    console.error(`Error fetching weather for "${city}":`, e.message);
    return { temp: '--°C', code: null };
  }
}

async function updateAllWeather(bypassCache = false) {
  let updated = false;
  const promises = overlayConfig.locations.map(async (loc) => {
    if (loc.city && loc.city.trim() !== '') {
      const newWeather = await fetchTempForCity(loc.city, bypassCache);
      if (newWeather.temp !== loc.temp || newWeather.code !== loc.weatherCode || newWeather.isDay !== loc.isDay) {
        loc.temp = newWeather.temp;
        loc.weatherCode = newWeather.code;
        loc.isDay = newWeather.isDay; // 1=day, 0=night
        updated = true;
      }
    } else {
      if (loc.temp !== '' || loc.weatherCode !== undefined) {
        loc.temp = '';
        loc.weatherCode = null;
        loc.isDay = null;
        updated = true;
      }
    }
  });

  await Promise.all(promises);

  if (updated || bypassCache) {
    // Save updated weather info
    saveConfig();
    // Broadcast updated config with new temperatures
    io.emit('configUpdate', overlayConfig);
  }
}

// Periodically update weather every 10 minutes
setInterval(() => updateAllWeather(false), 10 * 60 * 1000);

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
  socket.emit('configUpdate', overlayConfig);

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
  socket.on('updateConfig', async (newConfig) => {
    const oldCities = overlayConfig.locations.map(l => l.city).join('|');
    const newCities = newConfig.locations ? newConfig.locations.map(l => l.city).join('|') : oldCities;

    overlayConfig = { ...overlayConfig, ...newConfig };
    
    // Save updated configuration
    saveConfig();
    
    // Broadcast immediately so changes (color, font, transitions, pause/step) appear instantly
    io.emit('configUpdate', overlayConfig);
    
    // Then update temperatures and broadcast updated temperatures only if cities changed
    if (oldCities !== newCities) {
      await updateAllWeather(false);
    }
  });

  // Handle manual/force weather refresh request
  socket.on('forceWeatherUpdate', async () => {
    console.log('Force weather update requested from dashboard');
    await updateAllWeather(true);
  });

  // Sync active view index when the overlay transitions automatically
  socket.on('viewChanged', (index) => {
    if (overlayConfig.activeViewIndex !== index) {
      overlayConfig.activeViewIndex = index;
      socket.broadcast.emit('viewChanged', index);
    }
  });
});

// Initial weather fetch on startup
updateAllWeather();

const PORT = process.env.PORT || 3757;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`Overlay for OBS: http://localhost:${PORT}/overlay.html`);
});
