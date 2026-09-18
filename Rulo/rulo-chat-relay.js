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
  let attempts = 0;

  function postComment(message) {
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

  function install() {
    const original = window.sendToDestinations;
    if (typeof original !== "function") {
      if (attempts++ < 40) setTimeout(install, 500);
      return;
    }
    if (original.__ruloChatRelayWrapped) return;
    window.sendToDestinations = function (message) {
      const result = original.apply(this, arguments);
      postComment(message);
      return result;
    };
    window.sendToDestinations.__ruloChatRelayWrapped = true;
    console.log("[Rulo] Relay de comentarios instalado.");
  }

  install();
}());
