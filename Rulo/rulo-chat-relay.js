(function () {
  "use strict";

  // URL base de Cortex: la genera el auto-patcher (local-overrides/cortex-base-url.js).
  const CORTEX_BASE_URL = (function () {
    const configured = (typeof window !== "undefined" && window.CORTEX_BASE_URL)
      ? String(window.CORTEX_BASE_URL)
      : "http://192.168.4.100:4000";
    return configured.replace(/\/+$/, "");
  }());
  const RELAY_URL = CORTEX_BASE_URL + "/api/rulo-chat-message";
  const ACTIVITY_URL = CORTEX_BASE_URL + "/api/stream-activity";
  const VIEWER_URL = CORTEX_BASE_URL + "/api/viewer-count";
  let attempts = 0;

  function postComment(message) {
    postJoin(message);
    if (!message || message.bot || !message.chatmessage || !message.chatname) return;
    fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: String(message.chatmessage).slice(0, 500),
        requester: String(message.chatname).slice(0, 80),
        chatimg: String(message.chatimg || '').slice(0, 500),
        id: String(message.id || message.mid || '').slice(0, 120),
        type: String(message.type || message.platform || 'chat').slice(0, 40),
        timestamp: Number(message.timestamp) || Date.now(),
        source: message.type || message.platform || "chat"
      })
    }).catch(function () {});
  }

  // Solo emitir avisos cuando la plataforma identifica el evento como entrada.
  // No inferir una entrada a partir de un comentario normal.
  function postJoin(message) {
    if (!message || typeof message !== "object") return;
    const event = String(message.event || "").toLowerCase();
    if (event !== "joined" && event !== "rejoined") return;
    const name = String(message.chatname || "").trim().slice(0, 100);
    if (!name) return;
    fetch(ACTIVITY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, event: event, platform: String(message.type || message.platform || "live").slice(0, 30) })
    }).catch(function () {});
  }

  // Conteo de espectadores. OJO: estos eventos NO pasan por sendToDestinations
  // (el background los manda con sendDataP2P/sendTargetP2P), por eso se enganchan
  // aparte. Llegan como viewer_update (uno solo) o viewer_updates (objeto por
  // plataforma) y se reenvian a Cortex para que los muestre el historial.
  function postViewer(message) {
    if (!message || typeof message !== "object") return;
    const evento = String(message.event || "");
    if (evento !== "viewer_update" && evento !== "viewer_updates") return;
    const meta = message.meta;
    let counts = null;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      counts = {};
      Object.keys(meta).forEach(function (clave) {
        const n = Number(meta[clave]);
        if (isFinite(n) && n >= 0) counts[clave] = n;
      });
    } else {
      const n = Number(meta);
      if (isFinite(n) && n >= 0) {
        const plataforma = String(message.type || message.platform || "chat");
        counts = {};
        counts[plataforma] = n;
      }
    }
    if (!counts || !Object.keys(counts).length) return;
    // El agregado (viewer_updates) trae TODAS las plataformas activas: se
    // reemplaza. Un viewer_update suelto es una sola: se fusiona con lo previo.
    const esAgregado = !!(meta && typeof meta === "object" && !Array.isArray(meta));
    fetch(VIEWER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counts: counts, replace: esAgregado })
    }).catch(function () {});
  }

  function wrap(nombre, marcar, enganche) {
    const original = window[nombre];
    if (typeof original !== "function") return false;
    if (original[marcar]) return true;
    window[nombre] = function () {
      const result = original.apply(this, arguments);
      try { enganche(arguments[0]); } catch (_) {}
      return result;
    };
    window[nombre][marcar] = true;
    return true;
  }

  function install() {
    const listoComentarios = wrap("sendToDestinations", "__ruloChatRelayWrapped", postComment);
    const listoEspectadores = wrap("sendDataP2P", "__ruloViewerWrapped", postViewer);
    if (!listoComentarios || !listoEspectadores) {
      if (attempts++ < 40) setTimeout(install, 500);
      return;
    }
    console.log("[Rulo] Relay instalado: comentarios y conteo de espectadores.");
  }

  install();
}());
