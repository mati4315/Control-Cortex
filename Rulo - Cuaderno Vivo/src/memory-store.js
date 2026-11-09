'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MEMORY_TYPES = new Set(['preference', 'interest', 'summary', 'reminder', 'fact']);
const VISIBILITIES = new Set(['context', 'admin']);
const SOURCES = new Set(['manual', 'archive-review']);

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function stableIdentityKey(value) {
  const key = cleanText(value, 240).toLocaleLowerCase();
  return /^(?:audience:\d{1,20}|(?:facebook|idv2):\S+)$/i.test(key) && !/^idv2:unknown:/i.test(key) ? key : '';
}

function validDate(value) {
  const date = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function createMemoryStore({ dbFile, keyFile } = {}) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch { return unavailable('Esta versión de Node no incluye node:sqlite.'); }

  const dataRoot = path.resolve(__dirname, '..', 'data');
  const databasePath = dbFile || path.join(dataRoot, 'memory.sqlite');
  const privacyKeyPath = keyFile || path.join(dataRoot, 'identity-hmac.key');
  let db;
  let hmacKey;

  try {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.mkdirSync(path.dirname(privacyKeyPath), { recursive: true });
    if (!fs.existsSync(privacyKeyPath) && fs.existsSync(databasePath)) {
      throw new Error('Falta la clave local de memoria. Restaura juntos la base de Cuaderno Vivo y su clave desde el mismo respaldo.');
    }
    try {
      fs.writeFileSync(privacyKeyPath, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    hmacKey = fs.readFileSync(privacyKeyPath);
    if (hmacKey.length !== 32) throw new Error('La clave local de identidad no tiene el formato esperado.');

    db = new DatabaseSync(databasePath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS participant_memories (
        id TEXT PRIMARY KEY,
        subject_hash TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1,
        visibility TEXT NOT NULL DEFAULT 'context',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_start_date TEXT NOT NULL DEFAULT '',
        source_end_date TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_participant_memories_subject
        ON participant_memories(subject_hash, updated_at DESC);
    `);
  } catch (error) {
    try { db?.close(); } catch { /* No se pudo inicializar; Cortex sigue disponible. */ }
    return unavailable(error.message || 'No se pudo abrir el almacenamiento local de memoria.');
  }

  function subjectHash(identity) {
    const stableKey = stableIdentityKey(identity);
    if (!stableKey) throw new Error('Solo se guardan recuerdos cuando existe una identidad estable del archivo.');
    return crypto.createHmac('sha256', hmacKey).update(stableKey, 'utf8').digest('hex');
  }

  function normalizeInput(input = {}) {
    const type = MEMORY_TYPES.has(input.type) ? input.type : 'summary';
    const visibility = VISIBILITIES.has(input.visibility) ? input.visibility : 'context';
    const sourceType = SOURCES.has(input.sourceType) ? input.sourceType : 'manual';
    const content = cleanText(input.content, 1600);
    const confidenceValue = Number(input.confidence);
    const confidence = Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 1;
    if (!content) throw new Error('Escribe el recuerdo que quieres guardar.');
    return {
      type, visibility, sourceType, content,
      confidence: Math.round(confidence * 100) / 100,
      sourceStartDate: validDate(input.sourceStartDate),
      sourceEndDate: validDate(input.sourceEndDate)
    };
  }

  function publicRow(row) {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      confidence: Number(row.confidence),
      visibility: row.visibility,
      sourceType: row.source_type,
      sourceStartDate: row.source_start_date || '',
      sourceEndDate: row.source_end_date || '',
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at)
    };
  }

  function list(identity) {
    return db.prepare(`SELECT id, type, content, confidence, visibility, source_type,
      source_start_date, source_end_date, created_at, updated_at, expires_at
      FROM participant_memories WHERE subject_hash = ? ORDER BY updated_at DESC LIMIT 200`)
      .all(subjectHash(identity)).map(publicRow);
  }

  function add(identity, input = {}) {
    const hash = subjectHash(identity);
    const item = normalizeInput(input);
    const duplicate = db.prepare(`SELECT id FROM participant_memories
      WHERE subject_hash = ? AND type = ? AND lower(content) = lower(?) LIMIT 1`).get(hash, item.type, item.content);
    if (duplicate) return { ok: false, duplicate: true, error: 'Ese recuerdo ya existe para esta persona.' };
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(`INSERT INTO participant_memories
      (id, subject_hash, type, content, confidence, visibility, source_type, source_start_date, source_end_date, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run(id, hash, item.type, item.content, item.confidence, item.visibility, item.sourceType,
        item.sourceStartDate, item.sourceEndDate, now, now);
    return { ok: true, item: list(identity).find(row => row.id === id) };
  }

  function update(identity, id, input = {}) {
    const hash = subjectHash(identity);
    const item = normalizeInput(input);
    const result = db.prepare(`UPDATE participant_memories SET type = ?, content = ?, confidence = ?,
      visibility = ?, source_start_date = ?, source_end_date = ?, updated_at = ?
      WHERE id = ? AND subject_hash = ?`).run(item.type, item.content, item.confidence,
      item.visibility, item.sourceStartDate, item.sourceEndDate, Date.now(), cleanText(id, 80), hash);
    if (!Number(result.changes)) return { ok: false, error: 'No encontré ese recuerdo para la persona seleccionada.' };
    return { ok: true, item: list(identity).find(row => row.id === id) };
  }

  function remove(identity, id) {
    const result = db.prepare('DELETE FROM participant_memories WHERE id = ? AND subject_hash = ?')
      .run(cleanText(id, 80), subjectHash(identity));
    return { ok: Number(result.changes) > 0 };
  }

  function context(identity, { limit = 12, now = Date.now() } = {}) {
    const hash = subjectHash(identity);
    return db.prepare(`SELECT type, content, confidence FROM participant_memories
      WHERE subject_hash = ? AND visibility = 'context' AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY CASE type WHEN 'preference' THEN 0 WHEN 'reminder' THEN 1 WHEN 'interest' THEN 2 WHEN 'summary' THEN 3 ELSE 4 END,
        updated_at DESC LIMIT ?`).all(hash, Number(now), Math.max(1, Math.min(20, Number(limit) || 12)))
      .map(row => ({ type: row.type, content: row.content, confidence: Number(row.confidence) }));
  }

  return { enabled: true, error: '', filePath: databasePath, list, add, update, remove, context, close() { try { db.close(); } catch { /* Ya estaba cerrada. */ } } };
}

function unavailable(message) {
  const fail = () => ({ ok: false, error: message });
  return {
    enabled: false,
    error: message,
    filePath: '',
    list: () => [],
    add: fail,
    update: fail,
    remove: () => ({ ok: false, error: message }),
    context: () => [],
    close() {}
  };
}

function backupMemoryStoreData({ dbFile, keyFile, destination } = {}) {
  if (!dbFile || !keyFile || !destination || !fs.existsSync(dbFile)) return { ok: true, included: false };
  if (!fs.existsSync(keyFile)) return { ok: false, included: false, error: 'Falta la clave local que vincula los recuerdos con identidades estables.' };
  let DatabaseSync;
  let db;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
    fs.mkdirSync(destination, { recursive: true });
    const backupPath = path.join(destination, 'cuaderno-vivo-memory.sqlite');
    const escapedPath = backupPath.replace(/'/g, "''");
    db = new DatabaseSync(dbFile);
    db.exec(`VACUUM INTO '${escapedPath}'`);
    fs.copyFileSync(keyFile, path.join(destination, 'cuaderno-vivo-identity-hmac.key'));
    return { ok: true, included: true };
  } catch (error) {
    return { ok: false, included: false, error: error.message || 'No se pudo respaldar la memoria de Cuaderno Vivo.' };
  } finally {
    try { db?.close(); } catch { /* La conexión pudo no abrirse. */ }
  }
}

module.exports = { createMemoryStore, backupMemoryStoreData, stableIdentityKey, MEMORY_TYPES, VISIBILITIES };
