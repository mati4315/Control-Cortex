'use strict';
const { labels } = require('../extension/facebook-stats');
class FacebookStatsStore {
  constructor() { this.streams = new Map(); this.ttl = 90000; }
  update(streamId, source, incoming, accountLabel = '', now = Date.now()) {
    if (!/^\d{5,30}$/.test(String(streamId))) throw new Error('ID de transmisión inválido.');
    if (!['insights', 'video'].includes(source)) throw new Error('Fuente de estadísticas inválida.');
    const metrics = {};
    for (const key of Object.keys(labels)) {
      const value = incoming?.[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100000000) metrics[key] = value;
    }
    if (!Object.keys(metrics).length) throw new Error('No se reconocieron indicadores numéricos.');
    const row = this.streams.get(streamId) || { streamId };
    // Cada lectura es una instantánea: un dato ausente no se convierte en cero.
    row[source] = { metrics, updatedAt: now };
    row.accountLabel = String(accountLabel || row.accountLabel || '').slice(0, 100);
    this.streams.set(streamId, row);
    if (this.streams.size > 32) this.streams.delete(this.streams.keys().next().value);
    return this.snapshot(now);
  }
  snapshot(now = Date.now()) {
    return [...this.streams.values()].map(row => {
      const fresh = s => s && now - s.updatedAt < this.ttl;
      const insights = fresh(row.insights) ? row.insights : null;
      const video = fresh(row.video) ? row.video : null;
      const metrics = { ...(video?.metrics || {}), ...(insights?.metrics || {}) };
      return { streamId: row.streamId, accountLabel: row.accountLabel, metrics,
        source: insights ? 'insights' : video ? 'video' : 'expired',
        updatedAt: Math.max(insights?.updatedAt || 0, video?.updatedAt || 0),
        fresh: !!(insights || video) };
    });
  }
  totals() {
    const rows = this.snapshot().filter(r => r.fresh);
    const sum = key => {
      const values = rows.map(r => r.metrics[key]).filter(Number.isFinite);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
    return { currentViewers: sum('currentViewers'), comments: sum('comments') };
  }
  primaryTotals() {
    const primary = this.snapshot().find(row => row.fresh);
    return {
      currentViewers: Number.isFinite(primary?.metrics.currentViewers) ? primary.metrics.currentViewers : null,
      comments: Number.isFinite(primary?.metrics.comments) ? primary.metrics.comments : null
    };
  }
  accountTotals() {
    const rows = this.snapshot().filter(row => row.fresh);
    const sum = key => {
      const values = rows.map(row => row.metrics[key]).filter(Number.isFinite);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
    const accounts = new Set(rows.map(row => row.accountLabel || `transmision:${row.streamId}`));
    return {
      currentViewers: sum('currentViewers'),
      comments: sum('comments'),
      activeAccounts: accounts.size,
      activeStreams: rows.length,
      updatedAt: Math.max(0, ...rows.map(row => row.updatedAt || 0))
    };
  }
}
module.exports = FacebookStatsStore;
