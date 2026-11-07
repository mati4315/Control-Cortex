const WebSocket = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const admin = require("firebase-admin");

const PORT = process.env.PORT ? Number(process.env.PORT) : 688;
const WS_TOKEN = process.env.WS_TOKEN || "";
const wss = new WebSocket.Server({ port: PORT });

let lastConfigSnapshot = null;
let firestoreDb = null;
const recentEventIds = new Set();
const DEDUP_TTL_MS = 30_000;
const WATCHER_SCRIPT = path.join(__dirname, "observe-entries.js");
const WATCHER_STATE_FILE = path.join(__dirname, ".watcher-state.json");
const WATCHER_RESTART_BASE_MS = 3_000;
const WATCHER_RESTART_MAX_MS = 30_000;

let watcherProcess = null;
let watcherRestartTimer = null;
let watcherRestartDelayMs = WATCHER_RESTART_BASE_MS;
let shuttingDown = false;

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

  if (watcherRestartTimer) clearTimeout(watcherRestartTimer);
  if (watcherProcess && !watcherProcess.killed) watcherProcess.kill();

  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
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

async function respondWithPurchasedEntries(ws, data) {
  const requestId = String(data.requestId || "").slice(0, 100);
  if (!WS_TOKEN) {
    sendJson(ws, { type: "PURCHASED_ENTRIES_ERROR", requestId, error: "Configura WS_TOKEN en .env y en el dashboard para consultar compradores." });
    return;
  }
  if (data.token !== WS_TOKEN) {
    sendJson(ws, { type: "PURCHASED_ENTRIES_ERROR", requestId, error: "El token de seguridad no es válido." });
    return;
  }
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

wss.on("connection", (ws) => {
  if (lastConfigSnapshot) {
    sendJson(ws, {
      type: "CONFIG_SNAPSHOT",
      source: "ws-server",
      reason: "on_connect_cache",
      config: lastConfigSnapshot
    });
  }

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data?.type === "REQUEST_PURCHASED_ENTRIES") {
      void respondWithPurchasedEntries(ws, data);
      return;
    }

    if (data?.type === "CONFIG_SNAPSHOT" && data?.config) {
      lastConfigSnapshot = data.config;
      broadcast({
        type: "CONFIG_SNAPSHOT",
        source: data.source || "client",
        reason: data.reason || "relay",
        config: data.config
      }, ws);
      return;
    }

    if (data?.type === "WIDGET_HELLO" || data?.type === "REQUEST_CONFIG") {
      if (lastConfigSnapshot) {
        sendJson(ws, {
          type: "CONFIG_SNAPSHOT",
          source: "ws-server",
          reason: "widget_request_cache",
          config: lastConfigSnapshot
        });
      }
      broadcast(data, ws);
      return;
    }

    if (data?.type === "TRIGGER_BALL") {
      if (WS_TOKEN && data?.token !== WS_TOKEN) {
        console.warn("[loteria-ws] TRIGGER_BALL rejected: invalid token");
        return;
      }

      if (data?.eventId) {
        if (recentEventIds.has(data.eventId)) {
          console.log("[loteria-ws] TRIGGER_BALL skipped (duplicate):", data.eventId);
          return;
        }
        recentEventIds.add(data.eventId);
        setTimeout(() => recentEventIds.delete(data.eventId), DEDUP_TTL_MS);
      }

      const { token, ...clean } = data;
      broadcast(clean, ws);
      return;
    }

    broadcast(data, ws);
  });
});

setInterval(() => {
  if (recentEventIds.size > 500) recentEventIds.clear();
}, 300_000);

wss.on("listening", () => {
  console.log(`[loteria-ws] listening on ws://localhost:${PORT}`);
  if (WS_TOKEN) {
    console.log("[loteria-ws] token auth ENABLED");
  } else {
    console.log("[loteria-ws] token auth DISABLED (set WS_TOKEN env var to enable)");
  }
  startWatcher();
});

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
