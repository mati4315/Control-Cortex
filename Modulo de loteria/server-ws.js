const WebSocket = require("ws");

const PORT = process.env.PORT ? Number(process.env.PORT) : 688;
const WS_TOKEN = process.env.WS_TOKEN || "";
const wss = new WebSocket.Server({ port: PORT });

let lastConfigSnapshot = null;
const recentEventIds = new Set();
const DEDUP_TTL_MS = 30_000;

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
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

console.log(`[loteria-ws] listening on ws://localhost:${PORT}`);
if (WS_TOKEN) {
  console.log("[loteria-ws] token auth ENABLED");
} else {
  console.log("[loteria-ws] token auth DISABLED (set WS_TOKEN env var to enable)");
}
