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
  const TEST_MODE_URL = CORTEX_BASE_URL + "/api/test-mode/state";
  const ACTIVITY_URL = CORTEX_BASE_URL + "/api/stream-activity";
  const VIEWER_URL = CORTEX_BASE_URL + "/api/viewer-count";
  const COMMENT_COUNT_URL = CORTEX_BASE_URL + "/api/stream-comment-count";
  const QUEUE_DB_NAME = "rulo-chat-archive-queue-v1";
  const QUEUE_STORE_NAME = "pending";
  let attempts = 0;
  let queueDbPromise = null;
  let flushingQueue = false;
  let flushRequested = false;
  let testModeCache = { checkedAt: 0, enabled: null, request: null };
  const memoryQueue = [];

  function getTestModeState() {
    if (testModeCache.request) return testModeCache.request;
    if (Date.now() - testModeCache.checkedAt < 1000 && typeof testModeCache.enabled === "boolean") {
      return Promise.resolve(testModeCache.enabled);
    }
    testModeCache.request = fetch(TEST_MODE_URL, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("No se pudo consultar el modo de pruebas");
      return response.json();
    }).then(function (data) {
      if (typeof data.enabled !== "boolean") throw new Error("Estado de pruebas inválido");
      testModeCache.checkedAt = Date.now();
      testModeCache.enabled = data.enabled;
      return data.enabled;
    }).catch(function () {
      testModeCache.checkedAt = 0;
      testModeCache.enabled = null;
      return null;
    }).then(function (enabled) {
      testModeCache.request = null;
      return enabled;
    });
    return testModeCache.request;
  }

  function openQueueDb() {
    if (!window.indexedDB) return Promise.reject(new Error("IndexedDB no disponible"));
    if (queueDbPromise) return queueDbPromise;
    queueDbPromise = new Promise(function (resolve, reject) {
      const request = indexedDB.open(QUEUE_DB_NAME, 1);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
          db.createObjectStore(QUEUE_STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("No se pudo abrir la cola local")); };
    });
    queueDbPromise.catch(function () { queueDbPromise = null; });
    return queueDbPromise;
  }

  function savePendingComment(payload) {
    const unique = payload.id || payload.mid || (payload.timestamp + "|" + payload.source + "|" + payload.userid + "|" + payload.requester + "|" + payload.comment);
    const key = String(payload.source || "") + "|" + String(unique);
    return openQueueDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const transaction = db.transaction(QUEUE_STORE_NAME, "readwrite");
        transaction.objectStore(QUEUE_STORE_NAME).put({ key: key, payload: payload, queuedAt: Date.now() });
        transaction.oncomplete = function () { resolve(key); };
        transaction.onerror = function () { reject(transaction.error || new Error("No se pudo guardar el comentario pendiente")); };
      });
    }).catch(function (error) {
      const existing = memoryQueue.some(function (entry) { return entry.key === key; });
      if (!existing) memoryQueue.push({ key: key, payload: payload });
      console.warn("[Rulo] No se pudo usar la cola durable del navegador; queda en memoria:", error && error.message);
      return key;
    });
  }

  function removePendingComment(db, key) {
    return new Promise(function (resolve) {
      const transaction = db.transaction(QUEUE_STORE_NAME, "readwrite");
      transaction.objectStore(QUEUE_STORE_NAME).delete(key);
      transaction.oncomplete = transaction.onerror = transaction.onabort = function () { resolve(); };
    });
  }

  function sendPendingComment(db, entry) {
    return getTestModeState().then(function (enabled) {
      if (enabled === null) throw new Error("No se pudo confirmar el modo del archivo");
      const payload = Object.assign({}, entry.payload, { testMode: enabled });
      return fetch(RELAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }).then(function (response) {
      if (!response.ok) throw new Error("Cortex respondió " + response.status);
      if (!db) return true;
      return removePendingComment(db, entry.key).then(function () { return true; });
    });
  }

  function finishQueueFlush() {
    flushingQueue = false;
    if (flushRequested) {
      flushRequested = false;
      setTimeout(flushCommentQueue, 0);
    }
  }

  function flushCommentQueue() {
    if (flushingQueue) { flushRequested = true; return; }
    flushingQueue = true;
    openQueueDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const request = db.transaction(QUEUE_STORE_NAME, "readonly").objectStore(QUEUE_STORE_NAME).getAll();
        request.onsuccess = function () { resolve({ db: db, entries: request.result || [] }); };
        request.onerror = function () { reject(request.error || new Error("No se pudo leer la cola")); };
      });
    }).then(function (queue) {
      let chain = Promise.resolve();
      queue.entries.forEach(function (entry) {
        chain = chain.then(function () { return sendPendingComment(queue.db, entry); });
      });
      return chain;
    }).catch(function () {
      // El primer fallo detiene la tanda; el temporizador y el evento online reintentan.
      return Promise.resolve();
    }).then(function () {
      while (memoryQueue.length) {
        const entry = memoryQueue[0];
        return sendPendingComment(null, entry).then(function () {
          memoryQueue.shift();
        }).catch(function () {}).then(finishQueueFlush);
      }
      finishQueueFlush();
    });
  }

  function postComment(message) {
    if (!message || message.bot) return;
    if (!message.chatmessage || !message.chatname) {
      getTestModeState().then(function (enabled) {
        if (enabled !== null) postJoin(message, enabled);
      });
      return;
    }
    const isAlert = !!(message.isAlert || message.event === 'alert' || message.event === 'reaction' || message.hasDonation || /reaccion[oó]|reaccion|shared|comparti[oó]|estrellas|stars|sigui[oó]|followed/i.test(message.chatmessage));
    const meta = message.meta && typeof message.meta === "object" ? message.meta : {};
    const source = String(message.type || message.platform || 'chat').slice(0, 40);
    const facebookProfileUrl = /facebook/i.test(source)
      ? String(meta.commenterUrl || message.facebookProfileUrl || '').slice(0, 500)
      : '';
    const payload = {
      comment: String(message.chatmessage).slice(0, 5000),
      requester: String(message.chatname).slice(0, 80),
      userid: String(message.userid || '').slice(0, 120),
      facebookUserId: String(message.facebookUserId || (String(message.type || message.platform || '').toLowerCase() === 'facebook' ? message.userid || '' : '')).slice(0, 120),
      chatimg: String(message.chatimg || '').slice(0, 500),
      id: String(message.id || message.mid || meta.messageId || '').slice(0, 120),
      type: source,
      timestamp: Number(message.timestamp) || Date.now(),
      source: message.type || message.platform || "chat",
      facebookProfileUrl: facebookProfileUrl,
      isAlert: isAlert,
      event: isAlert ? 'alert' : String(message.event || '')
    };
    payload.captureAccount = String(meta.accountLabel || message.accountLabel || '').slice(0, 100);
    payload.streamId = String(meta.streamId || meta.videoId || message.videoId || '').slice(0, 180);
    payload.meta = {
      captureMethod: 'socialstream-ninja-relay',
      accountLabel: payload.captureAccount,
      streamId: payload.streamId,
      commenterUrl: facebookProfileUrl
    };
    getTestModeState().then(function (enabled) {
      if (enabled === null) {
        console.warn("[Rulo] Comentario descartado: no se pudo confirmar si el archivo está en modo de pruebas.");
        return;
      }
      payload.testMode = enabled;
      postJoin(message, enabled);
      if (enabled) {
        fetch(RELAY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then(function (response) {
          if (!response.ok) throw new Error("Cortex respondió " + response.status);
        }).catch(function (error) {
          console.warn("[Rulo] No se pudo enviar un comentario temporal:", error && error.message);
        });
        return;
      }
      savePendingComment(payload).then(flushCommentQueue);
    });
  }

  // Solo emitir avisos cuando la plataforma identifica el evento como entrada.
  // No inferir una entrada a partir de un comentario normal.
  function postJoin(message, knownTestMode) {
    if (knownTestMode === true) return;
    if (knownTestMode !== false) return;
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
    // Social Stream puede inflar sus cifras para overlays. Rulo usa el conteo
    // original separado para que las estadísticas del historial sean reales.
    const meta = evento === "viewer_updates" && message.ruloCounts && typeof message.ruloCounts === "object"
      ? message.ruloCounts
      : message.meta;
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

  function postFacebookCommentCount(message) {
    if (!message || typeof message !== "object" || message.event !== "facebook_comment_count_update") return;
    const count = Number(message.meta);
    if (!Number.isSafeInteger(count) || count < 0) return;
    fetch(COMMENT_COUNT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: count, platform: "facebook" })
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
    const listoEspectadores = wrap("sendDataP2P", "__ruloViewerWrapped", function (message) {
      postViewer(message);
      postFacebookCommentCount(message);
    });
    if (!listoComentarios || !listoEspectadores) {
      if (attempts++ < 40) setTimeout(install, 500);
      return;
    }
    console.log("[Rulo] Relay instalado: comentarios y conteo de espectadores.");
    flushCommentQueue();
  }

  window.addEventListener("online", flushCommentQueue);
  setInterval(flushCommentQueue, 15000);
  install();
}());
