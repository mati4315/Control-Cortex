'use strict';

const BLOCKED = /(?:^|\.)(?:__proto__|constructor|prototype|participants|winnerHistory|ssnUrl|ssnSessionId|ssnSlot|ssnEnabled|obsPassword|obsHost|obsPort|obsScene|obsAutoTransition|apiKey|token|secret|password|temp|weatherCode|isDay|activeViewIndex)(?:\.|$)/i;

function assert(condition, message) { if (!condition) throw new Error(message); }
function localOnly(req, res, next) {
  const address = req.socket && req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return res.status(403).json({ success: false, error: 'Esta API solo acepta conexiones locales de Cortex.' });
  next();
}
function publicConfig(value, prefix = '') {
  if (Array.isArray(value)) return value.map((item, index) => publicConfig(item, prefix ? `${prefix}.${index}` : String(index)));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (!BLOCKED.test(field)) result[key] = publicConfig(child, field);
  }
  return result;
}
function applyChanges(config, changes) {
  assert(changes && typeof changes === 'object' && !Array.isArray(changes), 'Cambios no válidos.');
  const entries = Object.entries(changes);
  assert(entries.length > 0 && entries.length <= 30, 'Envía entre 1 y 30 cambios.');
  for (const [route, value] of entries) {
    assert(typeof route === 'string' && route.length <= 240 && !BLOCKED.test(route), 'Este campo está protegido.');
    const parts = route.split('.');
    assert(parts.length <= 8 && parts.every(part => part && !['__proto__', 'constructor', 'prototype'].includes(part)), 'Ruta no válida.');
    let parent = config;
    for (const part of parts.slice(0, -1)) {
      const key = Array.isArray(parent) ? Number(part) : part;
      assert(parent && Object.hasOwn(parent, key), 'No existe el ajuste ' + route + '.'); parent = parent[key];
    }
    const last = parts.at(-1), key = Array.isArray(parent) ? Number(last) : last;
    assert(parent && Object.hasOwn(parent, key), 'No existe el ajuste ' + route + '.');
    const previous = parent[key];
    assert(previous === null || ['string', 'number', 'boolean'].includes(typeof previous), 'Solo se pueden editar valores individuales.');
    assert(typeof value === typeof previous, 'El tipo del nuevo valor no coincide con ' + route + '.');
    if (typeof value === 'string') assert(value.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'Texto no válido en ' + route + '.');
    if (typeof value === 'number') assert(Number.isFinite(value) && Math.abs(value) <= 1000000, 'Número fuera de rango en ' + route + '.');
    parent[key] = value;
  }
  return config;
}
function mergeSnapshot(current, snapshot, prefix = '') {
  if (Array.isArray(current)) {
    assert(Array.isArray(snapshot) && snapshot.length <= 2000, 'Lista de respaldo no válida en ' + prefix + '.');
    assert(current.length > 0 || snapshot.length === 0, 'No hay un esquema para restaurar la lista ' + prefix + '.');
    const sample = current[0];
    return snapshot.map((item, index) => mergeSnapshot(current[index] === undefined ? sample : current[index], item, `${prefix}.${index}`));
  }
  if (current && typeof current === 'object') {
    assert(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'Objeto de respaldo no válido en ' + prefix + '.');
    const result = { ...current };
    for (const [key, value] of Object.entries(snapshot)) {
      const route = prefix ? `${prefix}.${key}` : key;
      assert(!BLOCKED.test(route) && Object.hasOwn(current, key), 'Campo no permitido o desconocido: ' + route + '.');
      result[key] = mergeSnapshot(current[key], value, route);
    }
    return result;
  }
  assert(current === null ? snapshot === null : typeof snapshot === typeof current, 'Tipo de respaldo no válido en ' + prefix + '.');
  if (typeof snapshot === 'string') assert(snapshot.length <= 1000, 'Texto demasiado largo en ' + prefix + '.');
  if (typeof snapshot === 'number') assert(Number.isFinite(snapshot) && Math.abs(snapshot) <= 1000000, 'Número fuera de rango en ' + prefix + '.');
  return snapshot;
}
module.exports = { publicConfig, applyChanges, mergeSnapshot, localOnly };
