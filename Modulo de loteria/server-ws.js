const WebSocket = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
delete process.env.WS_TOKEN;
const admin = require("firebase-admin");

const PORT = process.env.PORT ? Number(process.env.PORT) : 688;
const wss = new WebSocket.Server({ port: PORT });
const CURRENT_BALL_RETRY_MS = 12_000;
const SOCKET_HEARTBEAT_MS = 15_000;
const LOTTERY_TICKER_CACHE_MS = 30_000;

let lastConfigSnapshot = null;
let lastConfigRequestAt = -Infinity;
const CONFIG_REQUEST_COOLDOWN_MS = 2000;
const CONFIG_SNAPSHOT_FILE = path.join(__dirname, "lottery-config-snapshot.json");
let configSnapshotSaveTimer = null;
let firestoreDb = null;
let lotteryTickerSummaryCache = null;
let lotteryTickerSummaryPromise = null;
let lotteryTickerRefreshTimer = null;
const recentEventIds = new Set();
const DEDUP_TTL_MS = 30_000;
const WATCHER_SCRIPT = path.join(__dirname, "observe-entries.js");
const WATCHER_STATE_FILE = path.join(__dirname, ".watcher-state.json");
const BALL_QUEUE_STATE_FILE = path.join(__dirname, "lottery-queue-state.json");
const WATCHER_RESTART_BASE_MS = 3_000;
const WATCHER_RESTART_MAX_MS = 30_000;

let ballQueueState = loadBallQueueState();
let overlayClient = null;
let overlayBusy = false;
let lastCurrentBallDispatchAt = 0;
let watcherProcess = null;
let watcherRestartTimer = null;
let watcherRestartDelayMs = WATCHER_RESTART_BASE_MS;
let shuttingDown = false;

function loadConfigSnapshot() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_SNAPSHOT_FILE, "utf8"));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
    delete saved.WS_TOKEN;
    delete saved.WEBSOCKET_URL;
    return saved;
  } catch { return null; }
}

function saveConfigSnapshot(snapshot) {
  const tempFile = `${CONFIG_SNAPSHOT_FILE}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(snapshot), "utf8");
    fs.renameSync(tempFile, CONFIG_SNAPSHOT_FILE);
  } catch (error) {
    console.error("[loteria-ws] no se pudo guardar la configuración compartida:", error?.message || error);
    try { fs.rmSync(tempFile, { force: true }); } catch {}
  }
}

function scheduleConfigSnapshotSave() {
  if (configSnapshotSaveTimer) clearTimeout(configSnapshotSaveTimer);
  configSnapshotSaveTimer = setTimeout(() => {
    configSnapshotSaveTimer = null;
    if (lastConfigSnapshot) saveConfigSnapshot(lastConfigSnapshot);
  }, 350);
  configSnapshotSaveTimer.unref?.();
}

lastConfigSnapshot = loadConfigSnapshot();

function scheduleLotteryTickerSummaryRefresh() {
  if (lotteryTickerRefreshTimer) clearTimeout(lotteryTickerRefreshTimer);
  lotteryTickerRefreshTimer = setTimeout(() => {
    lotteryTickerRefreshTimer = null;
    lotteryTickerSummaryCache = null;
    if (overlayClient?.readyState === WebSocket.OPEN) {
      sendJson(overlayClient, { type: "LOTTERY_TICKER_DATA_INVALIDATED" });
    }
  }, 5_000);
  lotteryTickerRefreshTimer.unref?.();
}

function getRunningWatcherPid() {
  try {
    const state = JSON.parse(fs.readFileSync(WATCHER_STATE_FILE, "utf8"));
    const pid = Number(state.pid);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function startWatcher() {
  if (shuttingDown || watcherProcess) return;

  const existingPid = getRunningWatcherPid();
  if (existingPid) {
    console.log(`[loteria-ws] watcher ya activo (pid=${existingPid}); se comprueba de nuevo en ${WATCHER_RESTART_MAX_MS}ms`);
    watcherRestartTimer = setTimeout(startWatcher, WATCHER_RESTART_MAX_MS);
    watcherRestartTimer.unref?.();
    return;
  }

  const child = spawn(process.execPath, [WATCHER_SCRIPT], {
    cwd: __dirname,
    env: process.env,
    stdio: "inherit",
    windowsHide: true
  });
  watcherProcess = child;

  child.once("spawn", () => {
    watcherRestartDelayMs = WATCHER_RESTART_BASE_MS;
    console.log("[loteria-ws] watcher de Firestore iniciado");
  });

  child.once("error", (error) => {
    console.error("[loteria-ws] no se pudo iniciar el watcher:", error.message);
  });

  child.once("close", (code, signal) => {
    if (watcherProcess === child) watcherProcess = null;
    if (shuttingDown) return;

    console.warn(`[loteria-ws] watcher detenido (code=${code}, signal=${signal || "none"}); reintentando en ${watcherRestartDelayMs}ms`);
    watcherRestartTimer = setTimeout(startWatcher, watcherRestartDelayMs);
    watcherRestartDelayMs = Math.min(watcherRestartDelayMs * 2, WATCHER_RESTART_MAX_MS);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[loteria-ws] cerrando servidor (${signal})`);

  if (configSnapshotSaveTimer) clearTimeout(configSnapshotSaveTimer);
  configSnapshotSaveTimer = null;
  if (lastConfigSnapshot) saveConfigSnapshot(lastConfigSnapshot);

  if (watcherRestartTimer) clearTimeout(watcherRestartTimer);
  if (watcherProcess && !watcherProcess.killed) watcherProcess.kill();

  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function sanitizeQueueItem(item) {
  if (!item || typeof item !== "object") return null;
  const number = Number(item.number);
  if (!Number.isInteger(number) || number < 1 || number > 99) return null;
  return {
    queueId: String(item.queueId || crypto.randomUUID()).slice(0, 100),
    eventId: String(item.eventId || "").slice(0, 200),
    number,
    name: String(item.name || "Alguien").trim().slice(0, 100) || "Alguien",
    profilePicUrl: typeof item.profilePicUrl === "string" ? item.profilePicUrl.slice(0, 1000) : "",
    lotteryName: String(item.lotteryName || "").slice(0, 100),
    createdAt: Number(item.createdAt) || Date.now(),
    direction: item.direction === "leftToRight" ? "leftToRight" : "rightToLeft",
    forceReplay: item.forceReplay === true,
    isTest: item.isTest === true
  };
}

function normalizeBallQueueState(state) {
  const current = sanitizeQueueItem(state?.current);
  const pending = Array.isArray(state?.pending)
    ? state.pending.map(sanitizeQueueItem).filter(Boolean).slice(0, 1000)
    : [];
  return {
    current,
    pending,
    paused: state?.paused === true,
    updatedAt: Number(state?.updatedAt) || Date.now()
  };
}

function loadBallQueueState() {
  try {
    return normalizeBallQueueState(JSON.parse(fs.readFileSync(BALL_QUEUE_STATE_FILE, "utf8")));
  } catch {
    return { current: null, pending: [], paused: false, updatedAt: Date.now() };
  }
}

function persistBallQueueState() {
  ballQueueState = normalizeBallQueueState({ ...ballQueueState, updatedAt: Date.now() });
  const tempFile = `${BALL_QUEUE_STATE_FILE}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(ballQueueState, null, 2), "utf8");
    fs.renameSync(tempFile, BALL_QUEUE_STATE_FILE);
  } catch (error) {
    console.error("[loteria-ws] no se pudo guardar la cola:", error?.message || error);
    try { fs.rmSync(tempFile, { force: true }); } catch {}
  }
}

function hasConnectedOverlay() {
  return Boolean(overlayClient && overlayClient.readyState === WebSocket.OPEN);
}

function broadcastBallQueueState(exceptWs = null) {
  const payload = {
    type: "BALL_QUEUE_STATE",
    ...ballQueueState,
    overlayConnected: hasConnectedOverlay()
  };
  for (const client of wss.clients) {
    if (client === exceptWs || (!client.isLotteryOverlay && !client.isLotteryDashboard)) continue;
    sendJson(client, payload);
  }
}

function broadcastToDashboards(payload, exceptWs = null) {
  for (const client of wss.clients) {
    if (client === exceptWs || !client.isLotteryDashboard) continue;
    sendJson(client, payload);
  }
}

function dispatchNextBall() {
  if (!hasConnectedOverlay() || overlayBusy) return false;
  if (!ballQueueState.current && ballQueueState.paused) {
    persistBallQueueState();
    broadcastBallQueueState();
    if (overlayClient?.readyState === WebSocket.OPEN) sendJson(overlayClient, { type: "BALL_QUEUE_IDLE" });
    return false;
  }
  if (!ballQueueState.current && ballQueueState.pending.length) {
    ballQueueState.current = ballQueueState.pending.shift();
  }
  if (!ballQueueState.current) {
    persistBallQueueState();
    broadcastBallQueueState();
    sendJson(overlayClient, { type: "BALL_QUEUE_IDLE" });
    return false;
  }
  overlayBusy = true;
  persistBallQueueState();
  broadcastBallQueueState();
  lastCurrentBallDispatchAt = Date.now();
  sendJson(overlayClient, { type: "START_QUEUED_BALL", ...ballQueueState.current });
  return true;
}

function getFirestoreDb() {
  if (firestoreDb) return firestoreDb;
  if (!admin.apps.length) {
    const serviceAccountPath = process.env.FIREBASE_SA_PATH || path.join(__dirname, "service-account.json");
    if (fs.existsSync(serviceAccountPath)) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccountPath) });
    } else {
      admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "cdelu-4e564" });
    }
  }
  firestoreDb = admin.firestore();
  return firestoreDb;
}

async function readPurchasedEntries() {
  const db = getFirestoreDb();
  const lotteries = await db.collection("lotteries").where("deletedAt", "==", null).get();
  const batches = await Promise.all(lotteries.docs.map(async lotteryDoc => {
    const entries = await lotteryDoc.ref.collection("entries").orderBy("createdAt", "desc").get();
    const lottery = lotteryDoc.data() || {};
    const lotteryName = String(lottery.name || lottery.title || lottery.lotteryName || lotteryDoc.id).slice(0, 100);
    return entries.docs.map(entryDoc => {
      const entry = entryDoc.data() || {};
      const number = Number(entry.selectedNumber);
      if (!Number.isInteger(number) || number < 1 || number > 99) return null;
      const timestamp = entry.createdAt?.toMillis?.() || (entry.createdAt instanceof Date ? entry.createdAt.getTime() : 0);
      return {
        entryKey: `${lotteryDoc.id}/${entryDoc.id}`,
        lotteryName,
        number,
        name: String(entry.userName || entry.userUsername || "Alguien").trim().slice(0, 100) || "Alguien",
        profilePicUrl: typeof entry.userProfilePicUrl === "string" ? entry.userProfilePicUrl.slice(0, 1000) : "",
        createdAt: Number(timestamp) || 0
      };
    });
  }));
  return batches.flat().filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

function getTimestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function readLotteryTickerSummaries() {
  const now = Date.now();
  if (lotteryTickerSummaryCache && now - lotteryTickerSummaryCache.generatedAt < LOTTERY_TICKER_CACHE_MS) {
    return lotteryTickerSummaryCache;
  }
  if (lotteryTickerSummaryPromise) return lotteryTickerSummaryPromise;

  lotteryTickerSummaryPromise = (async () => {
    const db = getFirestoreDb();
    const [modulesSnap, activeSnap] = await Promise.all([
      db.collection("_config").doc("modules").get(),
      db.collection("lotteries").where("status", "==", "active").limit(20).get()
    ]);
    const moduleEnabled = modulesSnap.data()?.lottery?.enabled !== false;
    const activeDocs = moduleEnabled ? activeSnap.docs.filter(doc => {
      const lottery = doc.data() || {};
      if (lottery.deletedAt != null || lottery.winner) return false;
      const startsAt = getTimestampMillis(lottery.startsAt);
      const endsAt = getTimestampMillis(lottery.endsAt);
      return (startsAt == null || startsAt <= now) && (endsAt == null || endsAt >= now);
    }).slice(0, 10) : [];

    const lotteries = await Promise.all(activeDocs.map(async lotteryDoc => {
      const lottery = lotteryDoc.data() || {};
      const rawMaxNumber = Number(lottery.maxNumber);
      const maxNumber = Number.isFinite(rawMaxNumber)
        ? Math.max(10, Math.min(200, Math.floor(rawMaxNumber)))
        : 100;
      const entriesSnap = await lotteryDoc.ref.collection("entries").select("selectedNumber", "number").get();
      const occupied = new Set();
      for (const entryDoc of entriesSnap.docs) {
        const entry = entryDoc.data() || {};
        const legacyNumber = /^n_(\d+)$/.exec(entryDoc.id)?.[1];
        const number = Number(entry.selectedNumber ?? entry.number ?? legacyNumber);
        if (Number.isInteger(number) && number >= 1 && number <= maxNumber) occupied.add(number);
      }
      let prize = "";
      if (lottery.hasPremio !== false) {
        if (lottery.premioType === "otros") {
          prize = String(lottery.premioOtros || "").trim().slice(0, 180);
        } else if (typeof lottery.premioDinero === "number" && Number.isFinite(lottery.premioDinero) && lottery.premioDinero > 0) {
          prize = `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(lottery.premioDinero)} ARS`;
        }
      }
      return {
        name: String(lottery.title || lottery.name || lottery.label || "Lotería activa").trim().slice(0, 100),
        occupiedCount: occupied.size,
        availableCount: Math.max(0, maxNumber - occupied.size),
        maxNumber,
        prize,
        endsAt: getTimestampMillis(lottery.endsAt)
      };
    }));

    lotteryTickerSummaryCache = { generatedAt: Date.now(), lotteries };
    return lotteryTickerSummaryCache;
  })();

  try {
    return await lotteryTickerSummaryPromise;
  } finally {
    lotteryTickerSummaryPromise = null;
  }
}

async function respondWithLotteryTickerData(ws, data) {
  const requestId = String(data.requestId || "").slice(0, 100);
  try {
    const summary = await readLotteryTickerSummaries();
    sendJson(ws, { type: "LOTTERY_TICKER_DATA", requestId, ...summary });
  } catch (error) {
    console.warn("[loteria-ws] no se pudo leer el resumen dinámico del ticker:", error?.message || error);
    sendJson(ws, { type: "LOTTERY_TICKER_DATA_ERROR", requestId, error: "No se pudo consultar la información de la lotería." });
  }
}

async function respondWithPurchasedEntries(ws, data) {
  const requestId = String(data.requestId || "").slice(0, 100);
  ws.isLotteryDashboard = true;
  try {
    const entries = await readPurchasedEntries();
    sendJson(ws, { type: "PURCHASED_ENTRIES", requestId, entries, generatedAt: Date.now() });
  } catch (error) {
    console.warn("[loteria-ws] no se pudo leer la lista de compras:", error?.message || error);
    sendJson(ws, { type: "PURCHASED_ENTRIES_ERROR", requestId, error: "No se pudo consultar la lista de compras en Firestore." });
  }
}

function broadcast(payload, exceptWs = null) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client === exceptWs) continue;
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

wss.on("connection", (ws, request) => {
  ws.origin = request?.headers?.origin || "";
  ws.isAlive = true;
  ws.lastPingAt = 0;
  ws.on("pong", () => { ws.isAlive = true; });
  if (lastConfigSnapshot) {
    sendJson(ws, {
      type: "CONFIG_SNAPSHOT",
      source: "ws-server",
      reason: "on_connect_cache",
      config: lastConfigSnapshot
    });
  }
  ws.on("close", () => {
    if (overlayClient === ws) {
      overlayClient = null;
      overlayBusy = false;
      lastCurrentBallDispatchAt = 0;
      broadcastBallQueueState();
    }
  });

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (data && typeof data === "object") delete data.token;

    if (data?.type === "FORCE_TICKER_DYNAMIC_RESULT") {
      if (!ws.isLotteryOverlay || overlayClient !== ws) return;
      broadcastToDashboards({
        type: "FORCE_TICKER_DYNAMIC_RESULT",
        requestId: String(data.requestId || "").slice(0, 100),
        ok: data.ok === true,
        message: String(data.message || "").slice(0, 200)
      });
      return;
    }

    if (data?.type === "FORCE_TICKER_DYNAMIC" || data?.type === "FORCE_TICKER_MANUAL") {
      ws.isLotteryDashboard = true;
      const requestId = String(data.requestId || "").slice(0, 100);
      const isManualMessage = data.type === "FORCE_TICKER_MANUAL";
      const manualText = isManualMessage ? String(data.text || "").trim() : "";
      if (!requestId) {
        sendJson(ws, { type: "FORCE_TICKER_DYNAMIC_ERROR", requestId: "", message: "La solicitud del aviso no es válida." });
        return;
      }
      if (isManualMessage && (!manualText || manualText.length > 500)) {
        sendJson(ws, { type: "FORCE_TICKER_DYNAMIC_ERROR", requestId, message: "El texto manual debe tener entre 1 y 500 caracteres." });
        return;
      }
      if (!hasConnectedOverlay()) {
        sendJson(ws, { type: "FORCE_TICKER_DYNAMIC_ERROR", requestId, message: "El overlay de lotería está desconectado." });
        return;
      }
      sendJson(overlayClient, isManualMessage
        ? { type: "FORCE_TICKER_MANUAL", requestId, text: manualText }
        : { type: "FORCE_TICKER_DYNAMIC", requestId });
      sendJson(ws, {
        type: "FORCE_TICKER_DYNAMIC_ACCEPTED",
        requestId,
        message: "Mensaje solicitado; se mostrará cuando termine la animación y se cumpla la espera mínima."
      });
      return;
    }

    if (data?.type === "REQUEST_LOTTERY_TICKER_DATA") {
      if (!ws.isLotteryOverlay || overlayClient !== ws) return;
      void respondWithLotteryTickerData(ws, data);
      return;
    }

    if (data?.type === "REQUEST_PURCHASED_ENTRIES") {
      void respondWithPurchasedEntries(ws, data);
      return;
    }

    if (data?.type === "REQUEST_BALL_QUEUE_STATE") {
      if (!ws.isLotteryOverlay) {
        ws.isLotteryDashboard = true;
      }
      sendJson(ws, {
        type: "BALL_QUEUE_STATE",
        ...ballQueueState,
        overlayConnected: hasConnectedOverlay()
      });
      return;
    }

    if (data?.type === "BALL_QUEUE_CONTROL") {
      ws.isLotteryDashboard = true;
      const action = String(data.action || "");
      if (action === "pause") ballQueueState.paused = true;
      else if (action === "resume") ballQueueState.paused = false;
      else if (action === "clear") ballQueueState.pending = [];
      else if (action === "skip") ballQueueState.pending.shift();
      else if (action === "remove" && data.queueId) {
        ballQueueState.pending = ballQueueState.pending.filter(item => item.queueId !== String(data.queueId));
      } else {
        sendJson(ws, { type: "BALL_QUEUE_CONTROL_ERROR", error: "La acción de cola no es válida." });
        return;
      }
      persistBallQueueState();
      sendJson(ws, { type: "BALL_QUEUE_CONTROL_ACK", action });
      broadcastBallQueueState();
      dispatchNextBall();
      return;
    }

    if (data?.type === "BALL_FINISHED") {
      if (!ws.isLotteryOverlay || overlayClient !== ws || !ballQueueState.current || data.queueId !== ballQueueState.current.queueId) return;
      ballQueueState.current = null;
      overlayBusy = false;
      lastCurrentBallDispatchAt = 0;
      persistBallQueueState();
      dispatchNextBall();
      return;
    }

    if (data?.type === "OVERLAY_BUSY" || data?.type === "OVERLAY_IDLE") {
      if (!ws.isLotteryOverlay || overlayClient !== ws) return;
      overlayBusy = data.type === "OVERLAY_BUSY";
      if (!overlayBusy) dispatchNextBall();
      return;
    }

    if (data?.type === "CONFIG_SNAPSHOT" && data?.config) {
      const publicConfig = { ...data.config };
      delete publicConfig.WS_TOKEN;
      // WebSocket endpoints depend on where a client is opened; keep them local.
      delete publicConfig.WEBSOCKET_URL;
      const serializedConfig = JSON.stringify(publicConfig);
      if (Buffer.byteLength(serializedConfig, "utf8") > 256 * 1024) return;
      if (serializedConfig !== JSON.stringify(lastConfigSnapshot)) {
        lastConfigSnapshot = publicConfig;
        scheduleConfigSnapshotSave();
      }
      broadcast({
        type: "CONFIG_SNAPSHOT",
        source: data.source || "client",
        reason: data.reason || "relay",
        config: publicConfig
      }, ws);
      return;
    }

    if (data?.type === "WIDGET_HELLO" || data?.type === "REQUEST_CONFIG") {
      if (data?.type === "WIDGET_HELLO" && data?.source === "widget") {
        if (overlayClient && overlayClient !== ws) overlayClient.isLotteryOverlay = false;
        ws.isLotteryOverlay = true;
        overlayClient = ws;
        overlayBusy = data.busy === true;
        lastCurrentBallDispatchAt = 0;
        broadcastBallQueueState();
      }
      if (lastConfigSnapshot) {
        sendJson(ws, {
          type: "CONFIG_SNAPSHOT",
          source: "ws-server",
          reason: "widget_request_cache",
          config: lastConfigSnapshot
        });
      } else if (Date.now() - lastConfigRequestAt >= CONFIG_REQUEST_COOLDOWN_MS) {
        // Bootstrap only: relaying every hello makes open dashboards compete
        // with stale settings and can cause an endless reconnect/config loop.
        lastConfigRequestAt = Date.now();
        broadcast(data, ws);
      }
      if (ws.isLotteryOverlay) dispatchNextBall();
      return;
    }

    if (data?.type === "TRIGGER_BALL") {
      if (data?.eventId) {
        const eventId = String(data.eventId).slice(0, 200);
        const existingPendingIndex = ballQueueState.pending.findIndex(item => item.eventId === eventId);
        const alreadyCurrent = ballQueueState.current?.eventId === eventId;
        if (alreadyCurrent || existingPendingIndex >= 0) {
          const existing = alreadyCurrent ? ballQueueState.current : ballQueueState.pending[existingPendingIndex];
          sendJson(ws, {
            type: "TRIGGER_QUEUED",
            eventId,
            queueId: existing.queueId,
            position: alreadyCurrent ? 1 : existingPendingIndex + 1 + (ballQueueState.current ? 1 : 0)
          });
          return;
        }
        if (recentEventIds.has(eventId)) {
          console.log("[loteria-ws] TRIGGER_BALL skipped (duplicate):", data.eventId);
          return;
        }
        recentEventIds.add(eventId);
        setTimeout(() => recentEventIds.delete(eventId), DEDUP_TTL_MS);
      }

      const clean = data;
      clean.queueId = String(clean.queueId || crypto.randomUUID()).slice(0, 100);
      clean.createdAt = Number(clean.createdAt) || Date.now();
      const item = sanitizeQueueItem(clean);
      if (!item) return;
      if (ballQueueState.current?.queueId === item.queueId || ballQueueState.pending.some(entry => entry.queueId === item.queueId)) return;
      if (ballQueueState.pending.length >= 1000) {
        sendJson(ws, { type: "TRIGGER_QUEUE_ERROR", eventId: item.eventId, error: "La cola alcanzó el límite de 1000 bolillas pendientes." });
        return;
      }
      ballQueueState.pending.push(item);
      persistBallQueueState();
      broadcastBallQueueState();
      if (clean.entryKey) {
        scheduleLotteryTickerSummaryRefresh();
        broadcastToDashboards({ type: "PURCHASE_ENTRY_EVENT", ...item, entryKey: String(clean.entryKey).slice(0, 200) }, ws);
      }
      sendJson(ws, {
        type: "TRIGGER_QUEUED",
        eventId: item.eventId,
        queueId: item.queueId,
        position: ballQueueState.pending.length + (ballQueueState.current ? 1 : 0)
      });
      dispatchNextBall();
      return;
    }

    broadcast(data, ws);
  });
});

const wsMaintenanceTimer = setInterval(() => {
  const now = Date.now();
  for (const client of wss.clients) {
    if (now - client.lastPingAt < SOCKET_HEARTBEAT_MS) continue;
    if (client.isAlive === false) {
      if (overlayClient === client) {
        overlayClient = null;
        overlayBusy = false;
        lastCurrentBallDispatchAt = 0;
        broadcastBallQueueState();
      }
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.lastPingAt = now;
    try { client.ping(); } catch { client.terminate(); }
  }

  if (ballQueueState.current && hasConnectedOverlay() && now - lastCurrentBallDispatchAt >= CURRENT_BALL_RETRY_MS) {
    lastCurrentBallDispatchAt = now;
    sendJson(overlayClient, { type: "START_QUEUED_BALL", ...ballQueueState.current });
  }

}, 3_000);
wsMaintenanceTimer.unref?.();

const recentEventCleanupTimer = setInterval(() => {
  if (recentEventIds.size > 500) recentEventIds.clear();
}, 300_000);
recentEventCleanupTimer.unref?.();

wss.on("listening", () => {
  console.log(`[loteria-ws] listening on ws://localhost:${PORT}`);
  console.log("[loteria-ws] autenticación desactivada: cualquier cliente que alcance el puerto puede consultar y controlar la cola");
  startWatcher();
});

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
