'use strict';

// La cola, el estado y las poses viven en Cortex. La Browser Source solo presenta
// los clips que recibe y reporta el primer frame / fin al servidor.
function createAnimationEngine({ library, emit, config = () => ({}), enabled = true }) {
  let current = null, pose = 'Oculto', state = 'OCULTO', active = null, pending = [];
  let leader = null, enabledNow = enabled, running = false, seq = 0, sleepTimer = null, idleTimer = null, prepared = null;
  let recent = [], cooldownUntil = new Map(), clients = new Set(), issues = [];
  let lastClientReadyAt = 0, lastPlaybackStartedAt = 0, lastPlaybackErrorAt = 0;
  const now = () => Date.now();
  const all = () => library.read().animations;
  function emitAll(message) { for (const client of clients) emit(client, message); }
  function status(extra = {}) {
    return { type: 'rulo_v2_status', enabled: enabledNow, state, pose, active: current?.id || '', family: active?.family || '',
      currentToken: current?.token || 0, currentStartedAt: lastPlaybackStartedAt, lastClientReadyAt, lastPlaybackErrorAt,
      queue: pending.map(t => ({ id: t.order, action: t.action, family: t.family, animationId: t.animationId || '' })),
      clients: clients.size, leader: !!leader, recent: [...recent], issues, ...extra };
  }
  function publish() { emitAll(status()); }
  function descriptor(id) {
    const a = all()[id]; if (!a || !a.enabled) return null;
    return { id: a.id, url: '/rulo-animaciones/' + a.file.split('/').map(encodeURIComponent).join('/'), loop: a.loop,
      from: a.from, to: a.to, family: a.family, role: a.role, interruptible: a.interruptible, duration: a.media?.duration || 0 };
  }
  function routeTo(from, to) {
    if (from === to) return [];
    const items = Object.values(all()).filter(a => a.enabled && ['entry', 'exit', 'transition'].includes(a.role) && a.from !== a.to);
    const queue = [{ pose: from, route: [] }], seen = new Set([from]);
    while (queue.length) {
      const node = queue.shift();
      for (const a of items.filter(x => x.from === node.pose).sort((x, y) => y.priority - x.priority)) {
        if (a.to === to) return [...node.route, a.id];
        if (!seen.has(a.to)) { seen.add(a.to); queue.push({ pose: a.to, route: [...node.route, a.id] }); }
      }
    }
    return null;
  }
  function weighted(list, excludeRecent = true) {
    let available = list.filter(a => (Number(a.weight) || 0) > 0 && (cooldownUntil.get(a.id) || 0) <= now());
    if (excludeRecent) {
      const trimmed = available.filter(a => !recent.slice(0, Number(library.read().behavior.recentCount || 3)).includes(a.id));
      if (trimmed.length) available = trimmed;
    }
    if (!available.length) available = list.filter(a => (Number(a.weight) || 0) > 0 && (cooldownUntil.get(a.id) || 0) <= now());
    if (!available.length) return null;
    const sum = available.reduce((s, a) => s + Number(a.weight), 0);
    let n = Math.random() * sum;
    return available.find(a => (n -= Number(a.weight)) < 0) || available[available.length - 1];
  }
  function enqueueTask(task) {
    const cap = Number(library.read().behavior.queueLimit) || 30;
    if (task.auto && task.family && pending.some(t => t.action === task.action && t.family === task.family)) return false;
    if (pending.length >= cap) { issues = ['La cola de acciones está llena; se descartó una solicitud.']; return false; }
    task.order = ++seq; pending.push(task);
    pending.sort((a, b) => b.priority - a.priority || a.order - b.order);
    prepared = null; clearTimeout(idleTimer);
    if (current?.loop) {
      const cutNow = all()[current.id]?.interruptible === true && task.priority > (active?.priority || 0);
      current.loop = false;
      if (active) active.loopCurrent = false;
      emitAll({ type: cutNow ? 'rulo_v2_cut_current' : 'rulo_v2_finish_current', token: current.token });
    } else if (current && all()[current.id]?.interruptible === true && task.priority > (active?.priority || 0)) {
      emitAll({ type: 'rulo_v2_cut_current', token: current.token });
    }
    emitAll({ type: 'rulo_v2_preload', clip: prepareNext() });
    publish(); pump(); return true;
  }
  function chooseFor(task, fromPose) {
    const items = Object.values(all()).filter(a => a.enabled && a.family === task.family && a.role === 'behavior' && (!task.animationId || a.id === task.animationId));
    if (!items.length) return null;
    const reachable = items.map(a => ({ a, route: routeTo(fromPose, a.from) })).filter(x => x.route !== null);
    const picked = weighted(reachable.map(x => x.a));
    return picked ? { picked, route: reachable.find(x => x.a.id === picked.id).route } : null;
  }
  function prepareNext() {
    if (!active || !current) return null;
    if (active.route.length) return descriptor(active.route[0]);
    if (active.loopCurrent || current.loop) return descriptor(current.id);
    if (active.auto && !pending.length) {
      if (!prepared?.auto) {
        const pick = chooseFor({ ...active, animationId: '' }, current.to);
        if (!pick) return null;
        prepared = { auto: true, picked: pick.picked.id, route: pick.route };
      }
      const next = all()[prepared.picked];
      return descriptor(prepared.route.length ? prepared.route[0] : next?.id);
    }
    if (!prepared) {
      const task = pending[0];
      if (!task) return null;
      const pick = chooseFor(task, current.to);
      if (!pick) return null;
      prepared = { taskOrder: task.order, picked: pick.picked.id, route: pick.route };
      return descriptor(pick.route.length ? pick.route[0] : pick.picked.id);
    }
    const task = pending[0]; if (!task || task.order !== prepared.taskOrder) { prepared = null; return prepareNext(); }
    const pick = all()[prepared.picked]; return descriptor(prepared.route.length ? prepared.route[0] : pick?.id);
  }
  function play(id, task, route = [], loopCurrent = false) {
    const clip = descriptor(id);
    if (!clip) { issues = [`No se pudo resolver el video ${id}.`]; publish(); finishTask(); return; }
    running = true; prepared = null;
    const previousState = state;
    current = clip;
    active = { ...(task || active || {}), route: [...route], loopCurrent, clipCount: (active?.clipCount || 0) + 1 };
    clip.loop = loopCurrent;
    state = active.family.toUpperCase();
    const packet = { type: 'rulo_v2_play', token: ++seq, clip, fallback: task?.fallback || '' };
    current.token = packet.token;
    emitAll(packet); emitAll(status()); emitAll({ type: 'rulo_v2_preload', clip: prepareNext() });
    if (active.family === 'Dormir' && previousState !== 'DORMIR' && active.auto) scheduleHideAfterSleep();
    if (active.family === 'Idle' && active.auto && previousState !== 'IDLE') scheduleIdle();
  }
  function finishTask() {
    const old = active; active = null; current = null; running = false; prepared = null;
    if (old?.family !== 'Dormir') clearTimeout(sleepTimer);
    pump();
  }
  function commitClip() {
    if (!current || !active) return;
    pose = current.to; recent.unshift(current.id); recent = recent.slice(0, 10);
    const source = all()[current.id]; if (source?.cooldown) cooldownUntil.set(current.id, now() + source.cooldown * 1000);
    if (active.route.length) {
      const next = active.route.shift(); play(next, active, active.route, false); return;
    }
    if (active.loopCurrent) { play(current.id, active, [], true); return; }
    const old = active; active = null; current = null; running = false;
    state = pose === 'Oculto' ? 'OCULTO' : pose === 'Idle_Base' ? 'IDLE' : 'IDLE';
    if (old?.hideAfter) { hideNow(); return; }
    if (!enabledNow) { pump(); return; }
    if (old?.auto && !pending.length) {
      const cached = prepared?.auto ? { picked: all()[prepared.picked], route: prepared.route } : null;
      const pick = cached?.picked ? cached : chooseFor({ ...old, animationId: '' }, pose);
      if (pick) {
        const ids = [...pick.route, pick.picked.id];
        old.family = pick.picked.family; old.route = ids.slice(1); old.loopCurrent = false;
        play(ids[0], old, ids.slice(1), false); return;
      }
    }
    if (old?.family !== 'Dormir') clearTimeout(sleepTimer);
    if (old?.returnIdle) enqueueTask({ action: 'volver a Idle', family: 'Idle', priority: 0 });
    prepared = null; pump();
  }
  function hideNow() {
    clearTimeout(idleTimer); clearTimeout(sleepTimer); active = null; current = null; running = false; pending = []; pose = 'Oculto'; state = 'OCULTO'; prepared = null;
    emitAll({ type: 'rulo_v2_hide' }); publish();
  }
  function fail(message, token) {
    if (!current || current.token !== token) return;
    lastPlaybackErrorAt = now();
    const old = current, f = library.read().fallback;
    issues = [`No cargó ${old.id}: ${message}`];
    if (f && f !== old.id && descriptor(f)) {
      const task = { ...(active || {}), fallback: old.id, route: [] };
      if (active?.family === 'Hablar') { task.family = 'Hablar'; task.action = 'Hablar'; task.returnIdle = true; }
      play(f, task, [], false);
    } else { emitAll({ type: 'rulo_v2_problem', issue: issues[0], triggerId: active?.triggerId || '' }); publish(); }
  }
  function pump() {
    if (!leader || !leader.readyState || leader.readyState !== 1) return;
    if (current || running) return;
    if (!enabledNow && !pending.some(t => ['ocultar', 'despedida'].includes(t.action))) { hideNow(); return; }
    const task = pending.shift();
    if (!task && !enabledNow) { hideNow(); return; }
    if (!task) {
      if (pose === 'Oculto') {
        const fallback = library.read().fallback;
        if (fallback) {
          const meta = all()[fallback]; pose = meta.from;
          play(fallback, { action: 'iniciar', family: 'Idle', priority: 0, route: [], auto: true, loopCurrent: false,
            hideAfter: false, returnIdle: false, triggerId: '' }, [], false);
        } else { state = 'SIN_IDLE'; issues = ['Importa y habilita un clip Idle para encender Rulo.']; publish(); }
      } else scheduleIdle();
      return;
    }
    if (pose === 'Oculto' && task.family === 'Idle') {
      const fallback = library.read().fallback;
      if (fallback && all()[fallback]) pose = all()[fallback].from;
    }
    if (task.action === 'ocultar' || task.action === 'despedida') {
      const exits = Object.values(all()).filter(a => a.enabled && a.role === 'exit' && a.from === pose && a.to === 'Oculto');
      const exit = weighted(exits, false);
      if (!exit) { state = 'OCULTANDO'; issues = ['Sin clip de salida. Rulo se ocultará al terminar el clip actual.']; emitAll({ type: 'rulo_v2_status', ...status() }); hideNow(); return; }
      play(exit.id, { ...task, route: [], hideAfter: true }, [], false); return;
    }
    const pick = chooseFor(task, pose);
    if (!pick) {
      pending.unshift(task); state = `SIN_${String(task.family).toUpperCase()}`;
      issues = [`No hay clip habilitado de ${task.family} compatible con la pose ${pose}.`]; publish();
      // El fallback conocido mantiene visible a Rulo y sus respuestas sincronizadas.
      const fallback = library.read().fallback;
      if (fallback && ['Hablar', 'Reacciones', 'Baile', 'Especiales', 'Dormir', 'Mate'].includes(task.family)) {
        pending.shift(); const loopsFallback = task.family === 'Dormir';
        const returnIdle = !loopsFallback;
        play(fallback, { ...task, route: [], loopCurrent: loopsFallback, returnIdle, fallback: task.family }, [], loopsFallback);
      }
      return;
    }
    const ids = [...pick.route, pick.picked.id];
    const namedLoop = !task.auto && ['iniciar', 'aparecer', 'normal', 'esperando', 'dormir'].includes(task.action) && pick.picked.loop;
    const autoLoop = !task.auto && pick.picked.family === 'Dormir' && pick.picked.loop;
    const oldTask = { ...task, family: pick.picked.family, route: ids.slice(1), loopCurrent: task.fallback ? false : task.loop === true || namedLoop || autoLoop,
      returnIdle: task.returnIdle === true || (task.auto && pick.picked.family !== 'Idle' && !pick.picked.loop) };
    play(ids[0], oldTask, ids.slice(1), oldTask.loopCurrent && ids.length === 1);
  }
  function scheduleIdle() {
    if (!enabledNow || pose === 'Oculto' || state === 'DORMIR' || pending.length || (active && active.family !== 'Idle')) return;
    clearTimeout(idleTimer);
    const b = library.read().behavior, min = b.idleMinMinutes || 4, max = b.idleMaxMinutes || 6;
    idleTimer = setTimeout(() => {
      if (state === 'DORMIR' || pending.length) return;
      const items = Object.values(all()).filter(a => a.enabled && a.family === 'Dormir' && a.role === 'behavior');
      if (!items.length) { issues = ['No hay clips de dormir habilitados; continúa el estado Idle.']; publish(); scheduleIdle(); return; }
      enqueueTask({ action: 'Dormir automático', family: 'Dormir', priority: 2, auto: true });
    }, (min + Math.random() * (max - min)) * 60000);
  }
  function scheduleHideAfterSleep() {
    clearTimeout(sleepTimer);
    const c = config(), min = Number(c.sleepHideMinMinutes) || 10, max = Math.max(min, Number(c.sleepHideMaxMinutes) || 15);
    sleepTimer = setTimeout(() => {
      if (state !== 'DORMIR') return;
      const exit = Object.values(all()).find(a => a.enabled && a.role === 'exit' && a.from === pose && a.to === 'Oculto');
      if (!exit) { issues = ['La biblioteca no tiene clip de salida desde esta pose. Rulo queda durmiendo hasta recibir una acción.']; publish(); return; }
      enqueueTask({ action: 'ocultar', family: 'Especiales', priority: 100 });
    }, (min + Math.random() * (max - min)) * 60000);
  }
  function request(action, extra = {}) {
    clearTimeout(idleTimer); clearTimeout(sleepTimer);
    if (action === 'actividad') {
      if (!enabledNow) return;
      if (state === 'DORMIR') enqueueTask({ action: 'Despertar', family: 'Idle', priority: 5, auto: true });
      else scheduleIdle(); return;
    }
    const manual = extra.animationId ? all()[extra.animationId] : null;
    const task = ({ iniciar: ['Idle', 3], aparecer: ['Idle', 3], normal: ['Idle', 0], esperando: ['Idle', 0], hablar: ['Hablar', 10], dormir: ['Dormir', 2], mate: ['Mate', 2], bailar: ['Baile', 2], reaccion: ['Reacciones', 4], especial: ['Especiales', 5], ocultar: ['Especiales', 100], despedida: ['Especiales', 100] })[action] || (manual ? [manual.family, manual.priority] : null);
    if (!task) return;
    if (['ocultar', 'despedida'].includes(action)) { enabledNow = false; pending = []; }
    if (!enabledNow && !['iniciar', 'aparecer', 'ocultar', 'despedida'].includes(action)) return;
    if (['iniciar', 'aparecer'].includes(action)) enabledNow = true;
    const [family, priority] = task;
    enqueueTask({ action, family: manual?.family || family, animationId: manual?.id || '', priority: manual?.priority ?? priority,
      triggerId: String(extra.triggerId || ''), loop: extra.loop === true, auto: false });
  }
  function syncClient(client, startIfNeeded = false) {
    const hadCurrent = Boolean(current);
    if (startIfNeeded && !current && enabledNow) pump();
    // Un Browser Source que entra tarde necesita recibir el clip en curso;
    // enviar solo el estado deja sus dos elementos <video> vacíos hasta la
    // próxima acción. Si el motor está entre clips, muestra el Idle seguro
    // localmente hasta que Cortex envíe la siguiente animación.
    if (current) {
      if (hadCurrent || !startIfNeeded) emit(client, { type: 'rulo_v2_play', token: current.token, clip: current });
    } else if (enabledNow && pose !== 'Oculto') {
      const fallback = descriptor(library.read().fallback);
      if (fallback) emit(client, { type: 'rulo_v2_play', token: 0, clip: { ...fallback, loop: true } });
    }
  }
  function clientReady(client) {
    clients.add(client); lastClientReadyAt = now(); if (!leader) leader = client;
    emit(client, status({ leader: client === leader }));
    syncClient(client, client === leader);
  }
  function clientGone(client) {
    clients.delete(client);
    if (client === leader) { leader = [...clients].find(c => c.readyState === 1) || null; if (leader) { current = null; active = null; running = false; pump(); } }
    publish();
  }
  function message(client, data) {
    if (data.type === 'rulo_v2_ready') return clientReady(client);
    if (data.type === 'rulo_v2_resync') return syncClient(client, client === leader);
    if (data.type === 'rulo_v2_started' && client === leader && data.token === current?.token) {
      lastPlaybackStartedAt = Number(data.startedAt) || now();
      if (active?.family === 'Hablar' && !current.acknowledged) {
        current.acknowledged = true;
        emitAll({ type: 'rulo_animation_started', animation: 'hablando', triggerId: active.triggerId || '', startedAt: data.startedAt || now(), fallback: active.fallback || '' });
      }
      publish(); return;
    }
    if (data.type === 'rulo_v2_ended' && client === leader && data.token === current?.token) return commitClip();
    if (data.type === 'rulo_v2_failed' && client === leader) return fail(data.message || 'error de reproducción', data.token);
  }
  function configure(manifest) {
    libraryChanged();
    if (manifest?.behavior) scheduleIdle();
  }
  function libraryChanged() { prepared = null; issues = []; emitAll({ type: 'rulo_v2_library_updated', manifest: library.publicManifest() }); publish(); }
  function removeAnimation(id) {
    const inUse = current?.id === id || active?.route?.includes(id);
    if (inUse) throw Error('Esta animación está en reproducción o forma parte de una transición activa. Espera a que termine y vuelve a intentarlo.');
    pending = pending.filter(task => task.animationId !== id);
    if (prepared?.picked === id || prepared?.route?.includes(id)) prepared = null;
    issues = [];
    publish();
    pump();
  }
  function cancelPending(id) {
    const before = pending.length; pending = pending.filter(task => String(task.order) !== String(id));
    if (pending.length === before) return false;
    prepared = null; publish(); pump(); return true;
  }
  function returnNormal() { pending = []; prepared = null; request('normal'); publish(); return true; }
  function resync() { for (const client of clients) syncClient(client, client === leader); publish(); return clients.size; }
  function shutdown() { clearTimeout(idleTimer); clearTimeout(sleepTimer); pending = []; enabledNow = false; enqueueTask({ action: 'despedida', family: 'Especiales', priority: 100 }); }
  return { request, clientReady, clientGone, message, status, libraryChanged, removeAnimation, cancelPending, returnNormal, resync, configure, setEnabled(value) { enabledNow = value === true; if (!enabledNow) shutdown(); else { state = pose === 'Oculto' ? 'OCULTO' : state; request('iniciar'); } },
    importAction(data) { request('animacion', data); }, shutdown, leader: () => leader, inspect: () => ({ ...status(), current, active, pose }) };
}
module.exports = { createAnimationEngine };
