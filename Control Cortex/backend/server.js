const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pm2 = require('pm2');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// CPU Usage calculation helper functions
let lastCpuInfo = getCpuTimes();

function getCpuTimes() {
  const cpus = os.cpus();
  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;

  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }

  const total = user + nice + sys + idle + irq;
  return { idle, total };
}

function getCpuUsagePercentage() {
  const current = getCpuTimes();
  const idleDiff = current.idle - lastCpuInfo.idle;
  const totalDiff = current.total - lastCpuInfo.total;
  
  lastCpuInfo = current;

  if (totalDiff === 0) return 0;
  return Math.round(100 - (100 * idleDiff / totalDiff));
}

const PORT = process.env.PORT || 4000;
const SERVICES_JSON_PATH = path.join(__dirname, 'services.json');
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Load services from services.json
function readServices() {
  try {
    if (!fs.existsSync(SERVICES_JSON_PATH)) {
      fs.writeFileSync(SERVICES_JSON_PATH, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(SERVICES_JSON_PATH, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading services.json:', error);
    return [];
  }
}

// Save services to services.json
function writeServices(services) {
  try {
    fs.writeFileSync(SERVICES_JSON_PATH, JSON.stringify(services, null, 2), { encoding: 'utf8' });
  } catch (error) {
    console.error('Error writing services.json:', error);
  }
}// Normalize paths for Windows compatibility
function normalizeWindowsPath(filePath) {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/');
}

function resolveConfiguredPath(inputPath, baseDir = __dirname) {
  if (!inputPath) return '';

  const normalized = normalizeWindowsPath(inputPath);
  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  const candidates = [
    path.resolve(baseDir, normalized),
    path.resolve(WORKSPACE_ROOT, normalized)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

// Connect to PM2 and get process status/info
function getPM2Processes() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        return reject(err);
      }
      pm2.list((err, list) => {
        if (err) {
          return reject(err);
        }
        resolve(list);
      });
    });
  });
}

// API: Get all services with dynamic PM2 status
app.get('/api/services', async (req, res) => {
  try {
    const services = readServices();
    let pm2List = [];
    try {
      pm2List = await getPM2Processes();
    } catch (err) {
      console.warn('Could not connect to PM2 or retrieve list. PM2 may not be running:', err.message);
    }

    const pm2Map = new Map();
    pm2List.forEach((proc) => {
      pm2Map.set(proc.name, {
        status: proc.pm2_env ? proc.pm2_env.status : 'stopped',
        cpu: proc.monit ? proc.monit.cpu : 0,
        memory: proc.monit ? proc.monit.memory : 0,
        pid: proc.pid,
        uptime: proc.pm2_env ? (Date.now() - proc.pm2_env.pm_uptime) : 0,
        restarts: proc.pm2_env ? proc.pm2_env.restart_time : 0
      });
    });

    const enrichedServices = services.map((service) => {
      const pm2Info = pm2Map.get(service.id);
      return {
        ...service,
        status: pm2Info ? pm2Info.status : 'stopped',
        cpu: pm2Info ? pm2Info.cpu : 0,
        memory: pm2Info ? pm2Info.memory : 0,
        pid: pm2Info ? pm2Info.pid : null,
        uptime: pm2Info ? pm2Info.uptime : 0,
        restarts: pm2Info ? pm2Info.restarts : 0
      };
    });

    res.json(enrichedServices);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve services', details: error.message });
  }
});

// API: Register a new service
app.post('/api/services', (req, res) => {
  const { id, name, description, directory, script, env, dashboardUrl } = req.body;

  if (!id || !name || !directory || !script) {
    return res.status(400).json({ error: 'id, name, directory, and script are required fields' });
  }

  // Validate ID format (alphanumeric, dashes, underscores)
  if (!/^[a-zA-Z0-9-_]+$/.test(id)) {
    return res.status(400).json({ error: 'id must contain only letters, numbers, dashes, and underscores' });
  }

  const normalizedDir = normalizeWindowsPath(directory);
  const normalizedScript = normalizeWindowsPath(script);
  const absoluteDirPath = resolveConfiguredPath(normalizedDir);
  const absoluteScriptPath = path.isAbsolute(normalizedScript)
    ? normalizedScript
    : resolveConfiguredPath(path.join(normalizedDir, normalizedScript));

  // Validate directory and script existence
  if (!fs.existsSync(absoluteDirPath)) {
    return res.status(400).json({ error: `Directory does not exist: ${normalizedDir}` });
  }

  if (!fs.existsSync(absoluteScriptPath)) {
    return res.status(400).json({ error: `Script file does not exist at: ${absoluteScriptPath}` });
  }

  const services = readServices();

  if (services.some((s) => s.id === id)) {
    return res.status(400).json({ error: `A service with id "${id}" already exists` });
  }

  const newService = {
    id,
    name,
    description: description || '',
    directory: normalizedDir,
    script: normalizedScript,
    env: env || {},
    dashboardUrl: dashboardUrl || '',
    status: 'stopped'
  };

  services.push(newService);
  writeServices(services);

  broadcast({
    type: 'service_added',
    service: newService
  });

  res.status(201).json(newService);
});

// API: Delete a service
app.delete('/api/services/:id', (req, res) => {
  const { id } = req.params;
  const services = readServices();
  const index = services.findIndex((s) => s.id === id);

  if (index === -1) {
    return res.status(404).json({ error: `Service with id "${id}" not found` });
  }

  const service = services[index];

  // Stop and delete from PM2 first
  pm2.connect((err) => {
    if (!err) {
      pm2.delete(id, () => {});
    }
  });

  services.splice(index, 1);
  writeServices(services);

  broadcast({
    type: 'service_deleted',
    id
  });

  res.json({ message: `Service "${service.name}" deleted successfully` });
});

// Helper for PM2 actions
function runPM2Action(id, action) {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);

      if (action === 'start') {
        const services = readServices();
        const service = services.find((s) => s.id === id);

        if (!service) {
          return reject(new Error(`Service ${id} not found in config`));
        }

        const resolvedDirectory = resolveConfiguredPath(service.directory);
        const resolvedScript = path.isAbsolute(service.script)
          ? normalizeWindowsPath(service.script)
          : resolveConfiguredPath(path.join(resolvedDirectory, service.script));

        pm2.start(
          {
            name: service.id,
            script: resolvedScript,
            cwd: resolvedDirectory,
            env: {
              ...process.env,
              ...service.env
            },
            exec_mode: 'fork',
            force: true
          },
          (err, apps) => {
            if (err) reject(err);
            else resolve(apps);
          }
        );
      } else if (action === 'stop') {
        pm2.stop(id, (err, apps) => {
          if (err) reject(err);
          else resolve(apps);
        });
      } else if (action === 'restart') {
        pm2.restart(id, (err, apps) => {
          if (err) reject(err);
          else resolve(apps);
        });
      } else {
        reject(new Error(`Invalid action: ${action}`));
      }
    });
  });
}

// Helper for PM2 batch actions (start-all, stop-all) to prevent concurrent connection gotchas
function runPM2BatchAction(ids, action) {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);

      const services = readServices();
      const promises = ids.map((id) => {
        return new Promise((res, rej) => {
          const service = services.find((s) => s.id === id);
          if (!service && action === 'start') {
            return rej(new Error(`Service ${id} not found in config`));
          }

          if (action === 'start') {
            const resolvedDirectory = resolveConfiguredPath(service.directory);
            const resolvedScript = path.isAbsolute(service.script)
              ? normalizeWindowsPath(service.script)
              : resolveConfiguredPath(path.join(resolvedDirectory, service.script));

            pm2.start(
              {
                name: service.id,
                script: resolvedScript,
                cwd: resolvedDirectory,
                env: {
                  ...process.env,
                  ...service.env
                },
                exec_mode: 'fork',
                force: true
              },
              (err, apps) => {
                if (err) rej(err);
                else res(apps);
              }
            );
          } else if (action === 'stop') {
            pm2.stop(id, (err, apps) => {
              if (err) {
                res();
              } else {
                res(apps);
              }
            });
          }
        });
      });

      Promise.allSettled(promises).then((results) => {
        const errors = results
          .filter((r) => r.status === 'rejected')
          .map((r) => r.reason.message);
        if (errors.length > 0 && errors.length === ids.length) {
          reject(new Error(`Batch action ${action} failed: ${errors.join(', ')}`));
        } else {
          resolve(results);
        }
      });
    });
  });
}

// API: Start all services
app.post('/api/services/start-all', async (req, res) => {
  try {
    const services = readServices();
    const ids = services.map(s => s.id);
    await runPM2BatchAction(ids, 'start');
    
    // Broadcast status change for all
    ids.forEach(id => {
      broadcast({ type: 'status_change', id, status: 'online' });
    });
    
    res.json({ message: 'All services started successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start all services', details: error.message });
  }
});

// API: Stop all services
app.post('/api/services/stop-all', async (req, res) => {
  try {
    const services = readServices();
    const ids = services.map(s => s.id);
    await runPM2BatchAction(ids, 'stop');
    
    // Broadcast status change for all
    ids.forEach(id => {
      broadcast({ type: 'status_change', id, status: 'stopped' });
    });
    
    res.json({ message: 'All services stopped successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop all services', details: error.message });
  }
});

// API: Start service
app.post('/api/services/:id/start', async (req, res) => {
  const { id } = req.params;
  try {
    await runPM2Action(id, 'start');
    broadcast({ type: 'status_change', id, status: 'online' });
    res.json({ message: `Service "${id}" started` });
  } catch (error) {
    res.status(500).json({ error: `Failed to start service "${id}"`, details: error.message });
  }
});

// API: Stop service
app.post('/api/services/:id/stop', async (req, res) => {
  const { id } = req.params;
  try {
    await runPM2Action(id, 'stop');
    broadcast({ type: 'status_change', id, status: 'stopped' });
    res.json({ message: `Service "${id}" stopped` });
  } catch (error) {
    res.status(500).json({ error: `Failed to stop service "${id}"`, details: error.message });
  }
});

// API: Restart service
app.post('/api/services/:id/restart', async (req, res) => {
  const { id } = req.params;
  try {
    await runPM2Action(id, 'restart');
    broadcast({ type: 'status_change', id, status: 'online' });
    res.json({ message: `Service "${id}" restarted` });
  } catch (error) {
    res.status(500).json({ error: `Failed to restart service "${id}"`, details: error.message });
  }
});

// API: Get global system resource info
app.get('/api/system', (req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryPercentage = (usedMem / totalMem) * 100;

  // Simple CPU load average (1 min load)
  const load = os.loadavg();

  res.json({
    platform: os.platform(),
    hostname: os.hostname(),
    uptime: os.uptime(),
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      percentage: memoryPercentage
    },
    cpu: {
      model: cpus[0].model,
      cores: cpus.length,
      load: load[0] || 0
    }
  });
});

// WebSocket upgrade and connection handling
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Keep track of connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`WebSocket client connected. Total clients: ${clients.size}`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WebSocket client disconnected. Total clients: ${clients.size}`);
  });
});

// Broadcast helper
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// PM2 launch bus to monitor real-time logs and events
pm2.connect((err) => {
  if (err) {
    console.error('Failed to connect to PM2 for logs bus:', err);
    return;
  }

  pm2.launchBus((err, bus) => {
    if (err) {
      console.error('Failed to launch PM2 log bus:', err);
      return;
    }

    console.log('PM2 log bus successfully connected');

    // Monitor standard output logs
    bus.on('log:out', (data) => {
      broadcast({
        type: 'log',
        serviceId: data.process.name,
        stream: 'stdout',
        timestamp: new Date().toISOString(),
        message: data.data
      });
    });

    // Monitor error logs
    bus.on('log:err', (data) => {
      broadcast({
        type: 'log',
        serviceId: data.process.name,
        stream: 'stderr',
        timestamp: new Date().toISOString(),
        message: data.data
      });
    });

    // Monitor process status changes from PM2
    bus.on('process:event', (data) => {
      if (data.event === 'exit' || data.event === 'start' || data.event === 'online' || data.event === 'stopped') {
        const mappedStatus = data.event === 'online' || data.event === 'start' ? 'online' : 'stopped';
        broadcast({
          type: 'status_change',
          id: data.process.name,
          status: mappedStatus
        });
      }
    });
  });
});

// Periodically broadcast system metrics and service usage updates to all WS clients
setInterval(async () => {
  if (clients.size === 0) return;

  try {
    // 1. Get system metrics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPercentage = (usedMem / totalMem) * 100;

    const systemMetrics = {
      cpuPercentage: getCpuUsagePercentage(),
      memoryPercentage: memoryPercentage,
      freeMemoryGB: (freeMem / (1024 ** 3)).toFixed(2),
      totalMemoryGB: (totalMem / (1024 ** 3)).toFixed(2),
      uptime: os.uptime()
    };

    // 2. Get PM2 process metrics
    let pm2List = [];
    try {
      pm2List = await getPM2Processes();
    } catch (e) {
      // PM2 offline
    }

    const servicesMetrics = pm2List.map((proc) => ({
      id: proc.name,
      status: proc.pm2_env ? proc.pm2_env.status : 'stopped',
      cpu: proc.monit ? proc.monit.cpu : 0,
      memory: proc.monit ? proc.monit.memory : 0,
      uptime: proc.pm2_env ? (Date.now() - proc.pm2_env.pm_uptime) : 0,
      restarts: proc.pm2_env ? proc.pm2_env.restart_time : 0
    }));

    // Calculate total CPU and RAM consumed *only* by our microservices
    let servicesCpuTotal = 0;
    let servicesMemTotal = 0;
    
    // We only count microservices registered in our config
    const servicesConfig = readServices();
    const configIds = new Set(servicesConfig.map(s => s.id));

    servicesMetrics.forEach((metric) => {
      if (configIds.has(metric.id) && metric.status === 'online') {
        servicesCpuTotal += metric.cpu || 0;
        servicesMemTotal += metric.memory || 0;
      }
    });

    broadcast({
      type: 'metrics',
      system: systemMetrics,
      services: servicesMetrics,
      servicesTotal: {
        cpu: servicesCpuTotal,
        memory: servicesMemTotal
      }
    });
  } catch (error) {
    console.error('Error broadcasting metrics:', error);
  }
}, 3000);

// Start HTTP/WS server
server.listen(PORT, () => {
  console.log(`Control Cortex backend listening on http://localhost:${PORT}`);
});
