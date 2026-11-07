'use strict';

const TRACE_ID = /^[a-zA-Z0-9_-]{8,80}$/;
const COMPONENTS = new Set(['chat-bot-spotify', 'cortex', 'spotify', 'rulo']);
const STATUSES = new Set(['ok', 'failed', 'skipped', 'duplicate', 'isolated', 'pending']);
const RESULT_CODES = new Set(['accepted', 'stored', 'duplicate', 'played', 'not_found', 'not_understood', 'no_device', 'cooldown', 'not_request', 'disabled', 'error', 'manual_sqlite_sync', 'test_mode']);
const SOURCE_CODES = new Set(['facebook', 'dashboard', 'socialstream', 'rulo-simulation', 'unknown']);

function safeEnum(value, allowed) {
  const text = String(value || '').trim().toLowerCase();
  return allowed.has(text) ? text : '';
}

class EventTraceStore {
  constructor(limit = 500) {
    this.limit = Math.max(20, Math.min(5000, Number(limit) || 500));
    this.events = [];
  }

  record(input = {}) {
    const traceId = String(input.traceId || '').trim();
    const stage = String(input.stage || '').trim().toLowerCase();
    const component = safeEnum(input.component, COMPONENTS);
    const status = safeEnum(input.status, STATUSES);
    if (!TRACE_ID.test(traceId) || !/^[a-z][a-z0-9_.-]{1,79}$/.test(stage) || !component || !status) return null;

    const rawDetails = input.details && typeof input.details === 'object' && !Array.isArray(input.details) ? input.details : {};
    const details = {};
    const source = safeEnum(rawDetails.source, SOURCE_CODES);
    const result = safeEnum(rawDetails.result, RESULT_CODES);
    if (source) details.source = source;
    if (result) details.result = result;
    if (Number.isInteger(Number(rawDetails.httpStatus)) && Number(rawDetails.httpStatus) >= 100 && Number(rawDetails.httpStatus) <= 599) details.httpStatus = Number(rawDetails.httpStatus);
    if (Number.isFinite(Number(rawDetails.durationMs))) details.durationMs = Math.max(0, Math.min(120000, Math.round(Number(rawDetails.durationMs))));
    if (typeof rawDetails.testMode === 'boolean') details.testMode = rawDetails.testMode;

    const now = Date.now();
    const suppliedTimestamp = Number(input.timestamp);
    const timestamp = Number.isFinite(suppliedTimestamp) && Math.abs(now - suppliedTimestamp) <= 10 * 60 * 1000 ? suppliedTimestamp : now;
    const event = { traceId, component, stage, status, details, timestamp };
    this.events.push(event);
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
    return { ...event, details: { ...details } };
  }

  list({ traceId = '', limit = 100 } = {}) {
    const filter = String(traceId || '').trim();
    if (filter && !TRACE_ID.test(filter)) return [];
    const count = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.events
      .filter(event => !filter || event.traceId === filter)
      .slice(-count)
      .reverse()
      .map(event => ({ ...event, details: { ...event.details } }));
  }
}

module.exports = { EventTraceStore, TRACE_ID };
