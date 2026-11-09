'use strict';

const fs = require('fs');
const path = require('path');
const { createMemoryStore } = require('./memory-store');

const MIN_POINTS = 0;
const MAX_POINTS = 40;
const DEFAULT_POINTS = 10;
const LEVELS = Object.freeze([
  { level: 1, id: 'contento', label: 'Contento' },
  { level: 2, id: 'normal', label: 'Normal' },
  { level: 3, id: 'enojado', label: 'Enojado' },
  { level: 4, id: 'muy_enojado', label: 'Muy enojado' }
]);
const DEFAULT_UP_THRESHOLDS = Object.freeze({ 2: 10, 3: 20, 4: 30 });
const DEFAULT_DOWN_THRESHOLDS = Object.freeze({ 1: 7, 2: 17, 3: 27 });
const SIGNAL_POINTS = Object.freeze({ request: 1, delayed: 1, stalled: 2, failure: 2, completed: -1 });
const ALLOWED_SIGNALS = new Set(Object.keys(SIGNAL_POINTS));

function clampPoints(value) {
  const points = Number(value);
  if (!Number.isFinite(points)) return DEFAULT_POINTS;
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(points)));
}

function levelByPoints(points) {
  const value = clampPoints(points);
  if (value >= DEFAULT_UP_THRESHOLDS[4]) return 4;
  if (value >= DEFAULT_UP_THRESHOLDS[3]) return 3;
  if (value >= DEFAULT_UP_THRESHOLDS[2]) return 2;
  return 1;
}

function resolveAutomaticLevel(state) {
  let level = Math.max(1, Math.min(4, Number(state.autoLevel) || 2));
  const points = clampPoints(state.points);
  while (level < 4 && points >= DEFAULT_UP_THRESHOLDS[level + 1]) level += 1;
  while (level > 1 && points <= DEFAULT_DOWN_THRESHOLDS[level - 1]) level -= 1;
  return level;
}

function levelRecord(level) {
  const normalized = Math.max(1, Math.min(4, Math.round(Number(level) || 2)));
  return LEVELS[normalized - 1];
}

function buildToneInstruction(profile, { level, points, mode }) {
  const selected = levelRecord(level);
  const traits = Array.isArray(profile?.traits) ? profile.traits.join(', ') : 'informal, curioso y cercano';
  const guardrails = Array.isArray(profile?.guardrails) ? profile.guardrails : [];
  const humor = profile?.humor?.style || 'ocasional y contextual';
  return [
    `Cuaderno Vivo · vista previa aislada. La voz tiene estilo ${String(profile?.locale || 'argentino rioplatense')}. Rasgos: ${traits}.`,
    `Nivel de personaje ${selected.level}: ${selected.label}. Tono para esta respuesta: ${String(profile?.levels?.[selected.level - 1]?.tone || '')}`,
    `El estado se calculó en modo ${mode === 'manual' ? 'manual' : 'automático'} con ${clampPoints(points)} puntos de carga. La numeración identifica niveles; no es una escala lineal de intensidad.`,
    `Humor: ${humor}.`,
    ...guardrails,
    'Esta indicación modula únicamente la redacción. Conserva las reglas, hechos, permisos y acciones del sistema que aparecen en las demás instrucciones.'
  ].join('\n');
}

function normalizeControl(saved) {
  const mode = saved?.mode === 'manual' ? 'manual' : 'automatic';
  const manualLevel = Math.max(1, Math.min(4, Math.round(Number(saved?.manualLevel) || 2)));
  const autoLevel = Math.max(1, Math.min(4, Math.round(Number(saved?.autoLevel) || 2)));
  const points = clampPoints(saved?.points ?? DEFAULT_POINTS);
  const lastActivityAt = Number.isFinite(Number(saved?.lastActivityAt)) ? Number(saved.lastActivityAt) : Date.now();
  const pendingWork = Math.max(0, Math.min(100, Math.round(Number(saved?.pendingWork) || 0)));
  return { version: 1, mode, manualLevel, autoLevel, points, lastActivityAt, pendingWork };
}

function createCuadernoVivo({ stateFile, profileFile } = {}) {
  const moduleRoot = path.resolve(__dirname, '..');
  const persistedStateFile = stateFile || path.join(moduleRoot, 'data', 'runtime-state.json');
  const sourceProfileFile = profileFile || path.join(moduleRoot, 'profile.json');
  const memoryStore = createMemoryStore({
    dbFile: path.join(moduleRoot, 'data', 'memory.sqlite'),
    keyFile: path.join(moduleRoot, 'data', 'identity-hmac.key')
  });
  let profile;
  try { profile = JSON.parse(fs.readFileSync(sourceProfileFile, 'utf8')); }
  catch { profile = { name: 'Rulo', locale: 'Español argentino rioplatense', traits: ['informal', 'curioso', 'pícaro', 'cercano'], levels: LEVELS, guardrails: [] }; }

  let state = normalizeControl(null);
  let seenEvents = new Set();
  let hasActivitySignals = false;
  function save() {
    fs.mkdirSync(path.dirname(persistedStateFile), { recursive: true });
    const tmp = `${persistedStateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      version: 1,
      mode: state.mode,
      manualLevel: state.manualLevel,
      autoLevel: state.autoLevel,
      points: state.points,
      lastActivityAt: state.lastActivityAt,
      pendingWork: state.pendingWork
    }, null, 2), 'utf8');
    fs.renameSync(tmp, persistedStateFile);
  }
  try {
    const saved = JSON.parse(fs.readFileSync(persistedStateFile, 'utf8'));
    state = normalizeControl(saved);
    state.autoLevel = resolveAutomaticLevel(state);
  } catch { /* El primer estado parte de Automático, Nivel 2 y diez puntos. */ }

  function applyRest(now = Date.now()) {
    if (!hasActivitySignals || state.pendingWork > 0 || now <= state.lastActivityAt) return false;
    const idleIntervals = Math.floor((now - state.lastActivityAt) / 60000);
    if (idleIntervals <= 0) return false;
    const nextPoints = clampPoints(state.points - idleIntervals);
    const changed = nextPoints !== state.points;
    state.points = nextPoints;
    state.lastActivityAt += idleIntervals * 60000;
    state.autoLevel = resolveAutomaticLevel(state);
    if (changed) save();
    return changed;
  }

  function getState(now = Date.now()) {
    applyRest(now);
    const currentLevel = state.mode === 'manual' ? state.manualLevel : state.autoLevel;
    const current = levelRecord(currentLevel);
    return {
      ok: true,
      phase: 'isolated-preview',
      mode: state.mode,
      points: state.points,
      maxPoints: MAX_POINTS,
      pendingWork: state.pendingWork,
      currentLevel: current.level,
      currentTone: current.id,
      currentLabel: current.label,
      automaticLevel: state.autoLevel,
      manualLevel: state.manualLevel,
      nextThreshold: state.autoLevel < 4 ? DEFAULT_UP_THRESHOLDS[state.autoLevel + 1] : MAX_POINTS,
      thresholds: { up: { ...DEFAULT_UP_THRESHOLDS }, down: { ...DEFAULT_DOWN_THRESHOLDS } },
      idleDecayPointsPerMinute: 1,
      activitySignalsConnected: hasActivitySignals,
      lastActivityAt: state.lastActivityAt,
      liveEnabled: false
    };
  }

  function setManualLevel(level) {
    const selected = Math.round(Number(level));
    if (!Number.isInteger(selected) || selected < 1 || selected > 4) throw new Error('El nivel manual debe estar entre 1 y 4.');
    state.mode = 'manual';
    state.manualLevel = selected;
    save();
    return getState();
  }

  function setAutomatic() {
    state.mode = 'automatic';
    state.autoLevel = resolveAutomaticLevel(state);
    save();
    return getState();
  }

  function applySignal({ eventId, type } = {}) {
    const key = String(eventId || '').trim().slice(0, 160);
    if (!key) throw new Error('Cada señal necesita un identificador técnico único.');
    if (!ALLOWED_SIGNALS.has(type)) throw new Error('La señal de carga no está permitida.');
    if (seenEvents.has(key)) return { ...getState(), duplicate: true };
    seenEvents.add(key);
    hasActivitySignals = true;
    if (seenEvents.size > 1200) seenEvents = new Set([...seenEvents].slice(-600));
    if (type === 'request') state.pendingWork = Math.min(100, state.pendingWork + 1);
    if (type === 'completed') state.pendingWork = Math.max(0, state.pendingWork - 1);
    state.points = clampPoints(state.points + SIGNAL_POINTS[type]);
    state.lastActivityAt = Date.now();
    state.autoLevel = resolveAutomaticLevel(state);
    save();
    return { ...getState(), duplicate: false };
  }

  function preview(input = {}) {
    const mode = input.mode === 'manual' ? 'manual' : 'automatic';
    const points = clampPoints(input.points ?? DEFAULT_POINTS);
    const manualLevel = Math.max(1, Math.min(4, Math.round(Number(input.level) || 2)));
    const automaticLevel = levelByPoints(points);
    const level = mode === 'manual' ? manualLevel : automaticLevel;
    return {
      mode, points, level, automaticLevel,
      tone: levelRecord(level).id,
      label: levelRecord(level).label,
      instruction: buildToneInstruction(profile, { level, points, mode })
    };
  }

  function buildCurrentPreview() {
    const current = getState();
    const selected = levelRecord(current.currentLevel);
    return {
      mode: current.mode,
      points: current.points,
      level: selected.level,
      automaticLevel: current.automaticLevel,
      tone: selected.id,
      label: selected.label,
      instruction: buildToneInstruction(profile, { level: selected.level, points: current.points, mode: current.mode })
    };
  }

  return {
    getState, setManualLevel, setAutomatic, applySignal, preview, buildCurrentPreview,
    buildToneInstruction: state => buildToneInstruction(profile, state),
    profile: () => JSON.parse(JSON.stringify(profile)),
    memoryStatus: () => ({ enabled: memoryStore.enabled, error: memoryStore.error || '' }),
    listMemories: identity => memoryStore.list(identity),
    addMemory: (identity, input) => memoryStore.add(identity, input),
    updateMemory: (identity, id, input) => memoryStore.update(identity, id, input),
    deleteMemory: (identity, id) => memoryStore.remove(identity, id),
    memoryContext: identity => memoryStore.context(identity)
  };
}

module.exports = {
  createCuadernoVivo,
  buildToneInstruction,
  clampPoints,
  levelByPoints,
  LEVELS,
  MIN_POINTS,
  MAX_POINTS,
  DEFAULT_POINTS
};
