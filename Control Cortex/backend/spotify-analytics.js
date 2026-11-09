'use strict';
// Historial de interacciones en SQLite (Rulo/Spotify/spotify-analytics.db).
//
// Guarda las interacciones recientes de pedidos para analizarlas despues
// (Cortex aplica una retencion por antiguedad):
//   interactions -> cada comentario ("pregunta") y lo que contesto el bot, con
//                   el resultado, si lo interpreto la IA y de que contexto salio
//                   la respuesta (y si esa respuesta la genero la IA).
//   events       -> acciones sueltas (variantes generadas con IA, correcciones
//                   aprendidas, cambios de vocabulario/ajustes).
//
// Usa `node:sqlite`, que viene dentro de Node (>= 22): no hay que instalar nada.
// Si el modulo no esta disponible, el backend sigue funcionando sin historial.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (error) {
  DatabaseSync = null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  iso TEXT NOT NULL,
  session TEXT,
  source TEXT,
  platform TEXT,
  requester TEXT,
  requester_id TEXT,
  comment TEXT,
  is_request INTEGER DEFAULT 0,
  parsed_source TEXT,
  artist TEXT,
  title TEXT,
  genre TEXT,
  query TEXT,
  status TEXT,
  reason TEXT,
  ai_interpreted INTEGER DEFAULT 0,
  ai_model TEXT,
  ai_fallback_reason TEXT,
  reply_text TEXT,
  reply_context TEXT,
  reply_variant TEXT,
  reply_random INTEGER,
  reply_ai INTEGER DEFAULT 0,
  reply_source TEXT,
  reply_model TEXT,
  reply_fallback_reason TEXT,
  track_name TEXT,
  track_artist TEXT,
  track_uri TEXT,
  track_source TEXT,
  seconds INTEGER,
  duration_ms INTEGER,
  since_play_ms INTEGER,
  skipped_after INTEGER DEFAULT 0,
  reviewed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_interactions_ts ON interactions(ts);
CREATE INDEX IF NOT EXISTS idx_interactions_status ON interactions(status);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  iso TEXT NOT NULL,
  session TEXT,
  type TEXT NOT NULL,
  detail TEXT,
  ai_model TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

-- Archivo permanente del chat. No comparte el límite del historial visual
-- de Rulo y no se borra al usar "Limpiar historial".
CREATE TABLE IF NOT EXISTS "user" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_key TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'unknown',
  platform_user_id TEXT,
  facebook_user_id TEXT UNIQUE,
  ID_facebook TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  requester_norm TEXT NOT NULL DEFAULT '',
  first_seen_at INTEGER,
  last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_name ON "user"(requester_norm, platform);

CREATE TABLE IF NOT EXISTS audience_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_key TEXT NOT NULL UNIQUE,
  session TEXT NOT NULL DEFAULT '',
  program_date TEXT NOT NULL,
  program_number TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL DEFAULT '',
  capture_id TEXT NOT NULL DEFAULT '',
  capture_account TEXT NOT NULL DEFAULT '',
  stream_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  facebook_user_id TEXT NOT NULL DEFAULT '',
  requester TEXT NOT NULL DEFAULT '',
  requester_norm TEXT NOT NULL DEFAULT '',
  requester_key TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL DEFAULT '',
  is_alert INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  avatar_path TEXT NOT NULL DEFAULT '',
  audience_user_id INTEGER REFERENCES "user"(id)
);
CREATE INDEX IF NOT EXISTS idx_audience_comments_ts ON audience_comments(ts);
CREATE INDEX IF NOT EXISTS idx_audience_comments_program ON audience_comments(program_date, platform);
CREATE INDEX IF NOT EXISTS idx_audience_comments_user ON audience_comments(requester_key, ts);
CREATE TABLE IF NOT EXISTS audience_return_greetings (
  requester_key TEXT NOT NULL,
  program_date TEXT NOT NULL,
  greeted_at INTEGER NOT NULL,
  PRIMARY KEY (requester_key, program_date)
);
CREATE TABLE IF NOT EXISTS rulo_simulation_cases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  program_number TEXT NOT NULL,
  participant_comment_id TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  expected_behavior TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rulo_simulation_cases_updated ON rulo_simulation_cases(updated_at DESC);
CREATE TABLE IF NOT EXISTS rulo_behavior_rules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  instruction TEXT NOT NULL,
  source_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rulo_behavior_rules_updated ON rulo_behavior_rules(updated_at DESC);
CREATE TABLE IF NOT EXISTS rulo_simulation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES rulo_simulation_cases(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  spotify_mode TEXT NOT NULL DEFAULT '',
  time_scale INTEGER NOT NULL DEFAULT 1,
  verdict TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rulo_simulation_runs_case ON rulo_simulation_runs(case_id, created_at DESC);
CREATE TABLE IF NOT EXISTS rulo_lottery_program_snapshots (
  program_number TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  historical_verified INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS rulo_roulette_ticket_adjustments (
  adjustment_id TEXT PRIMARY KEY,
  award_id TEXT NOT NULL,
  spin_id TEXT NOT NULL,
  prize_id TEXT NOT NULL,
  lottery_id TEXT NOT NULL,
  lottery_name TEXT NOT NULL DEFAULT '',
  winner_name TEXT NOT NULL DEFAULT '',
  previous_extra_tickets INTEGER NOT NULL,
  current_extra_tickets INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  assigned_ticket_count INTEGER NOT NULL DEFAULT 0,
  base_limit INTEGER NOT NULL DEFAULT 1,
  effective_limit INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rulo_roulette_ticket_adjustments_created
  ON rulo_roulette_ticket_adjustments(created_at DESC);
DROP VIEW IF EXISTS audience_comments_unique;
CREATE VIEW audience_comments_unique AS
  SELECT c.* FROM audience_comments c
  WHERE c.message_id = '' OR c.id = (
    SELECT MIN(c2.id) FROM audience_comments c2
    WHERE c2.session = c.session AND c2.platform = c.platform
      AND c2.message_id = c.message_id
      AND (LOWER(c.platform) = 'facebook' OR c2.ts = c.ts)
  );
`;

const CAMPOS = [
  'ts', 'iso', 'session', 'source', 'platform', 'requester', 'requester_id', 'comment',
  'is_request', 'parsed_source', 'artist', 'title', 'genre', 'query', 'status', 'reason',
  'ai_interpreted', 'ai_model', 'ai_fallback_reason', 'reply_text', 'reply_context', 'reply_variant', 'reply_random',
  'reply_ai', 'reply_source', 'reply_model', 'reply_fallback_reason', 'track_name', 'track_artist', 'track_uri', 'track_source', 'seconds', 'duration_ms',
  'since_play_ms', 'skipped_after', 'reviewed'
];

// Columnas que se agregaron despues: si la base ya existia, se suman solas.
const COLUMNAS_NUEVAS = [
  ['track_source', 'TEXT'],
  ['since_play_ms', 'INTEGER'],
  ['skipped_after', 'INTEGER DEFAULT 0'],
  ['reviewed', 'INTEGER DEFAULT 0'],
  ['ai_fallback_reason', 'TEXT'],
  ['reply_source', 'TEXT'],
  ['reply_model', 'TEXT'],
  ['reply_fallback_reason', 'TEXT']
];

function texto(value, limite) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, limite || 300);
}

function aEntero(value) {
  const numero = Number(value);
  return Number.isFinite(numero) ? Math.round(numero) : null;
}

function aBool(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function claveHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function fechaPrograma(timestamp) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function nombreNormalizado(value) {
  return texto(value, 100).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function textoPlanoComentario(value) {
  const entities = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é',
    iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', copy: '©', reg: '®',
    mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•'
  };
  const decodeEntities = text => String(text || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
    if (entity.charAt(0) !== '#') return entities[entity.toLowerCase()] ?? all;
    const codePoint = entity.charAt(1).toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\uFFFD';
    try { return String.fromCodePoint(codePoint); } catch (_) { return '\uFFFD'; }
  });
  let text = String(value || '');
  text = decodeEntities(decodeEntities(text));
  text = text.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi, '');
  text = text.replace(/<img\b[^>]*(?:>|$)/gi, tag => {
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    return alt ? decodeEntities(alt[1] ?? alt[2] ?? alt[3] ?? '') : '';
  });
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:div|p|li)\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/<[a-z][^<>]*$/gi, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity) => decodeEntities(`&${entity};`))
    .replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function clavePersona(userId, requester, platform, facebookUserId) {
  const origen = (texto(platform, 40) || 'unknown').toLocaleLowerCase();
  const facebookId = texto(facebookUserId, 120).toLocaleLowerCase();
  if (origen === 'facebook' && facebookId && !/^(?:unknown|null|undefined|anonymous|\[object object\])$/i.test(facebookId)) return `facebook:${facebookId}`;
  const id = texto(userId, 120).toLocaleLowerCase();
  if (id && !/^(?:unknown|null|undefined|anonymous|\[object object\])$/i.test(id)) return `idv2:${origen}:${id}`;
  return `namev2:${origen}:${nombreNormalizado(requester)}`;
}

function createAnalytics(options) {
  const config = options || {};
  const filePath = config.filePath;
  const session = texto(config.session, 40);
  const log = config.log || (() => {});

  if (!DatabaseSync) {
    log('SQLite no disponible en esta version de Node: no se guarda el historial de analisis.');
    return {
      enabled: false,
      filePath,
      recordInteraction: () => false,
      pruneInteractionsBefore: () => null,
      clearInteractions: () => null,
      recordAudienceComment: () => false,
      updateAudienceAvatar: () => 0,
      importLegacyAudienceComments: () => 0,
      audiencePrograms: () => [],
      audienceCommentsForProgram: () => [],
      audienceMemorySubjects: () => [],
      audienceMemoryHistory: () => [],
      audienceMemorySubjectKey: () => '',
      simulationCases: () => [],
      ruloBehaviorRules: () => [],
      saveRuloBehaviorRule: () => ({ ok: false, error: 'SQLite no disponible.' }),
      deleteRuloBehaviorRule: () => ({ ok: false, error: 'SQLite no disponible.' }),
      saveSimulationCase: () => ({ ok: false, error: 'SQLite no disponible.' }),
      deleteSimulationCase: () => ({ ok: false, error: 'SQLite no disponible.' }),
      simulationCaseRuns: () => [],
      recordSimulationRun: () => ({ ok: false, error: 'SQLite no disponible.' }),
      reviewSimulationRun: () => ({ ok: false, error: 'SQLite no disponible.' }),
      lotteryProgramSnapshot: () => null,
      saveLotteryProgramSnapshot: () => ({ ok: false, error: 'SQLite no disponible.' }),
      recordRouletteTicketAdjustment: () => false,
      rouletteTicketAdjustments: () => [],
      assignUnassignedAudienceCommentsToProgram: () => ({ ok: false, error: 'SQLite no disponible.' }),
      updateAudienceResponse: () => false,
      audienceComments: () => [],
      audienceTopCommenters: () => [],
      audienceDaysForPerson: () => [],
      audienceAttendanceForRequesterKey: () => [],
      audienceSummary: () => null,
      audienceIdentityStats: () => null,
      audienceMostRegular: () => [],
      audienceBusiestDays: () => [],
      audienceFrequentTerms: () => ({ words: [], comments: 0 }),
      audienceProgramSummary: () => null,
      audienceHighlights: () => [],
      audiencePersonProfile: () => ({ identities: [], words: [] }),
      audienceReturningMembers: () => [],
      claimAudienceGreeting: () => false,
      audienceQuestion: () => ({ ok: false, answer: 'El archivo permanente de audiencia no está disponible en esta ejecución.' }),
      recordEvent: () => false,
      stats: () => null,
      avisos: () => [],
      markReviewed: () => 0,
      rows: () => [],
      learningInbox: () => [],
      markLearningReviewed: () => 0,
      csv: () => '',
      audienceCsv: () => '',
      backupTo: () => false,
      close: () => {}
    };
  }

  let db = config.db || null;
  try {
    if (!db) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      db = new DatabaseSync(filePath);
    }
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA secure_delete = ON;');
    db.exec(SCHEMA);
    const behaviorRuleColumns = db.prepare('PRAGMA table_info(rulo_behavior_rules)').all().map(column => column.name);
    if (!behaviorRuleColumns.includes('source_note')) db.exec("ALTER TABLE rulo_behavior_rules ADD COLUMN source_note TEXT NOT NULL DEFAULT ''");
    const simulationRunColumns = db.prepare('PRAGMA table_info(rulo_simulation_runs)').all().map(column => column.name);
    if (!simulationRunColumns.includes('time_scale')) db.exec('ALTER TABLE rulo_simulation_runs ADD COLUMN time_scale INTEGER NOT NULL DEFAULT 1');
    // Migra una vez las claves antiguas para separar plataformas y priorizar
    // el ID estable cuando existe. No modifica ni elimina comentarios.
    const audienceColumns = db.prepare('PRAGMA table_info(audience_comments)').all().map(column => column.name);
    if (!audienceColumns.includes('requester_norm')) db.exec("ALTER TABLE audience_comments ADD COLUMN requester_norm TEXT NOT NULL DEFAULT ''");
    if (!audienceColumns.includes('facebook_user_id')) db.exec("ALTER TABLE audience_comments ADD COLUMN facebook_user_id TEXT NOT NULL DEFAULT ''");
    if (!audienceColumns.includes('dedupe_key')) db.exec("ALTER TABLE audience_comments ADD COLUMN dedupe_key TEXT NOT NULL DEFAULT ''");
    if (!audienceColumns.includes('capture_id')) db.exec("ALTER TABLE audience_comments ADD COLUMN capture_id TEXT NOT NULL DEFAULT ''");
    if (!audienceColumns.includes('capture_account')) db.exec("ALTER TABLE audience_comments ADD COLUMN capture_account TEXT NOT NULL DEFAULT ''");
    if (!audienceColumns.includes('stream_id')) db.exec("ALTER TABLE audience_comments ADD COLUMN stream_id TEXT NOT NULL DEFAULT ''");
    if (!audienceColumns.includes('program_number')) db.exec("ALTER TABLE audience_comments ADD COLUMN program_number TEXT NOT NULL DEFAULT ''");
    if (!audienceColumns.includes('avatar_path')) db.exec("ALTER TABLE audience_comments ADD COLUMN avatar_path TEXT NOT NULL DEFAULT ''");
    if (!audienceColumns.includes('audience_user_id')) db.exec('ALTER TABLE audience_comments ADD COLUMN audience_user_id INTEGER REFERENCES "user"(id)');
    // Recrea la vista luego de migrar para que SELECT c.* incluya las columnas nuevas.
    db.exec(`DROP VIEW IF EXISTS audience_comments_unique;
      CREATE VIEW audience_comments_unique AS
        SELECT c.* FROM audience_comments c
        WHERE c.message_id = '' OR c.id = (
          SELECT MIN(c2.id) FROM audience_comments c2
          WHERE c2.session = c.session AND c2.platform = c.platform
            AND c2.message_id = c.message_id
            AND (LOWER(c.platform) = 'facebook' OR c2.ts = c.ts)
        );`);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_audience_comments_dedupe ON audience_comments(dedupe_key) WHERE dedupe_key <> ''");
    db.exec("CREATE INDEX IF NOT EXISTS idx_audience_comments_program_number ON audience_comments(program_number, ts)");
    db.exec('CREATE INDEX IF NOT EXISTS idx_audience_comments_audience_user ON audience_comments(audience_user_id)');
    const oldIdentityRows = db.prepare(`SELECT id, platform, user_id, facebook_user_id, requester, requester_key
      FROM audience_comments WHERE requester_norm = '' OR (requester_key NOT LIKE 'idv2:%' AND requester_key NOT LIKE 'namev2:%' AND requester_key NOT LIKE 'facebook:%')`).all();
    const updateIdentity = db.prepare('UPDATE audience_comments SET requester_key = ?, requester_norm = ? WHERE id = ?');
    if (oldIdentityRows.length) {
      db.exec('BEGIN IMMEDIATE');
      try {
        oldIdentityRows.forEach(row => updateIdentity.run(
          clavePersona(row.user_id, row.requester, row.platform, row.facebook_user_id), nombreNormalizado(row.requester), row.id
        ));
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* conserva el error original */ }
        throw error;
      }
    }
    // Migracion: si la base ya existia sin las columnas nuevas, se agregan.
    try {
      const actuales = db.prepare('PRAGMA table_info(interactions)').all().map(columna => columna.name);
      COLUMNAS_NUEVAS.forEach(([nombre, tipo]) => {
        if (actuales.indexOf(nombre) === -1) db.exec(`ALTER TABLE interactions ADD COLUMN ${nombre} ${tipo}`);
      });
    } catch (error) {
      log('No se pudieron migrar las columnas nuevas: ' + error.message);
    }
  } catch (error) {
    log('No se pudo abrir la base de analisis (' + error.message + '): se sigue sin historial.');
    return {
      enabled: false,
      filePath,
      recordInteraction: () => false,
      pruneInteractionsBefore: () => null,
      clearInteractions: () => null,
      recordAudienceComment: () => false,
      updateAudienceAvatar: () => 0,
      importLegacyAudienceComments: () => 0,
      audiencePrograms: () => [],
      audienceCommentsForProgram: () => [],
      audienceMemorySubjects: () => [],
      audienceMemoryHistory: () => [],
      audienceMemorySubjectKey: () => '',
      simulationCases: () => [],
      ruloBehaviorRules: () => [],
      saveRuloBehaviorRule: () => ({ ok: false, error: 'SQLite no disponible.' }),
      deleteRuloBehaviorRule: () => ({ ok: false, error: 'SQLite no disponible.' }),
      saveSimulationCase: () => ({ ok: false, error: 'SQLite no disponible.' }),
      deleteSimulationCase: () => ({ ok: false, error: 'SQLite no disponible.' }),
      simulationCaseRuns: () => [],
      recordSimulationRun: () => ({ ok: false, error: 'SQLite no disponible.' }),
      reviewSimulationRun: () => ({ ok: false, error: 'SQLite no disponible.' }),
      lotteryProgramSnapshot: () => null,
      saveLotteryProgramSnapshot: () => ({ ok: false, error: 'SQLite no disponible.' }),
      recordRouletteTicketAdjustment: () => false,
      rouletteTicketAdjustments: () => [],
      assignUnassignedAudienceCommentsToProgram: () => ({ ok: false, error: 'SQLite no disponible.' }),
      updateAudienceResponse: () => false,
      audienceComments: () => [],
      audienceTopCommenters: () => [],
      audienceDaysForPerson: () => [],
      audienceAttendanceForRequesterKey: () => [],
      audienceSummary: () => null,
      audienceIdentityStats: () => null,
      audienceMostRegular: () => [],
      audienceBusiestDays: () => [],
      audienceFrequentTerms: () => ({ words: [], comments: 0 }),
      audienceProgramSummary: () => null,
      audienceHighlights: () => [],
      audiencePersonProfile: () => ({ identities: [], words: [] }),
      audienceReturningMembers: () => [],
      claimAudienceGreeting: () => false,
      audienceQuestion: () => ({ ok: false, answer: 'El archivo permanente de audiencia no está disponible en esta ejecución.' }),
      recordEvent: () => false,
      stats: () => null,
      avisos: () => [],
      markReviewed: () => 0,
      rows: () => [],
      csv: () => '',
      audienceCsv: () => '',
      backupTo: () => false,
      close: () => {}
    };
  }

  const insertInteraction = db.prepare(
    'INSERT INTO interactions (' + CAMPOS.join(', ') + ') VALUES (' + CAMPOS.map(() => '?').join(', ') + ')'
  );
  const insertEvent = db.prepare('INSERT INTO events (ts, iso, session, type, detail, ai_model) VALUES (?, ?, ?, ?, ?, ?)');
  const insertAudienceComment = db.prepare(`
    INSERT OR IGNORE INTO audience_comments (
      content_key, session, program_date, platform, source, message_id, dedupe_key,
      capture_id, capture_account, stream_id, user_id, facebook_user_id,
      requester, requester_norm, requester_key, comment, response, event, is_alert, ts, received_at, program_number, avatar_path, audience_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const audienceUserByKey = db.prepare('SELECT id FROM "user" WHERE requester_key = ? LIMIT 1');
  const audienceUserByFacebookId = db.prepare('SELECT id FROM "user" WHERE facebook_user_id = ? LIMIT 1');
  const insertAudienceUser = db.prepare(`INSERT INTO "user" (
    requester_key, platform, platform_user_id, facebook_user_id, ID_facebook,
    display_name, requester_norm, first_seen_at, last_seen_at
  ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`);
  const updateAudienceUser = db.prepare(`UPDATE "user" SET
    platform = CASE WHEN ? <> '' THEN ? ELSE platform END,
    platform_user_id = CASE WHEN (platform_user_id IS NULL OR platform_user_id = '') AND ? <> '' THEN ? ELSE platform_user_id END,
    facebook_user_id = CASE WHEN (facebook_user_id IS NULL OR facebook_user_id = '') AND ? <> '' THEN ? ELSE facebook_user_id END,
    display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END,
    requester_norm = CASE WHEN ? <> '' THEN ? ELSE requester_norm END,
    first_seen_at = CASE WHEN first_seen_at IS NULL OR first_seen_at > ? THEN ? ELSE first_seen_at END,
    last_seen_at = CASE WHEN last_seen_at IS NULL OR last_seen_at < ? THEN ? ELSE last_seen_at END
    WHERE id = ?`);

  function ensureAudienceUser(entry) {
    const row = entry || {};
    const platform = (texto(row.platform, 40) || 'unknown').toLocaleLowerCase();
    if (platform === 'dashboard' || platform === 'simulado') return null;
    const requesterKey = texto(row.requesterKey || row.requester_key, 240);
    if (!requesterKey) return null;
    const facebookUserId = platform === 'facebook'
      ? texto(row.facebookUserId || row.facebook_user_id, 160)
      : '';
    const programNumber = texto(row.programNumber || row.program_number, 30);
    const platformUserId = texto(row.userId || row.user_id || row.platformUserId, 160);
    const displayName = texto(row.requester || row.displayName || row.display_name, 120);
    const requesterNorm = texto(row.requesterNorm || row.requester_norm, 160);
    const seenAt = Number(row.ts || row.timestamp) || Date.now();
    let existing = audienceUserByKey.get(requesterKey);
    if (!existing && facebookUserId) existing = audienceUserByFacebookId.get(facebookUserId);
    if (!existing && !programNumber) return null;
    if (existing) {
      updateAudienceUser.run(
        platform, platform, platformUserId, platformUserId,
        facebookUserId, facebookUserId, displayName, displayName, requesterNorm, requesterNorm,
        seenAt, seenAt, seenAt, seenAt, existing.id
      );
      return Number(existing.id);
    }
    try {
      const result = insertAudienceUser.run(
        requesterKey, platform, platformUserId || null, facebookUserId || null,
        displayName, requesterNorm, seenAt, seenAt
      );
      return Number(result.lastInsertRowid) || null;
    } catch (error) {
      // Si una clave nueva llega con un facebook_user_id ya conocido, conserva
      // el mismo registro de usuario en vez de duplicar o perder el comentario.
      if (facebookUserId && /unique/i.test(error.message)) {
        const byFacebookId = audienceUserByFacebookId.get(facebookUserId);
        if (byFacebookId) return Number(byFacebookId.id);
      }
      throw error;
    }
  }

  function backfillAudienceUserLinks() {
    const rows = db.prepare(`SELECT id, platform, requester, requester_norm, requester_key,
      user_id, facebook_user_id, program_number, ts FROM audience_comments
      WHERE requester_key <> '' AND LOWER(platform) NOT IN ('dashboard', 'simulado')
      ORDER BY ts ASC, id ASC`).all();
    if (!rows.length) return 0;
    let linked = 0;
    const linkComment = db.prepare(`UPDATE audience_comments SET audience_user_id = ?
      WHERE id = ? AND (audience_user_id IS NULL OR audience_user_id <> ?)`);
    try {
      db.exec('BEGIN IMMEDIATE');
      rows.forEach(row => {
        const userId = ensureAudienceUser({
          requesterKey: row.requester_key,
          platform: row.platform,
          userId: row.user_id,
          facebookUserId: row.facebook_user_id,
          requester: row.requester,
          requesterNorm: row.requester_norm,
          programNumber: row.program_number,
          ts: row.ts
        });
        if (userId) linked += Number(linkComment.run(userId, row.id, userId).changes || 0);
      });
      db.exec('COMMIT');
      return linked;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* conserva el error original */ }
      log('No se pudieron vincular los comentarios con la tabla user: ' + error.message);
      return 0;
    }
  }

  const linkedAudienceUsers = backfillAudienceUserLinks();
  if (linkedAudienceUsers) log(`Se vincularon ${linkedAudienceUsers} comentarios con la tabla user.`);

  function normalizeAudienceComment(entry) {
    const data = entry || {};
    const ts = Number(data.timestamp || data.ts) || Date.now();
    const requester = texto(data.requester || data.chatname, 100);
    const userId = texto(data.userId || data.userid || data.requesterId || data.requester_id, 120);
    const platform = (texto(data.platform || data.source || data.type, 40) || 'unknown').toLocaleLowerCase();
    const facebookUserId = platform === 'facebook' ? texto(data.facebookUserId || data.facebook_user_id, 120) : '';
    const sessionId = texto(data.session || data.sessionId, 120) || session;
    const originalComment = String(data.comment || data.chatmessage || '').trim().slice(0, 5000);
    const comment = textoPlanoComentario(originalComment).slice(0, 5000);
    const source = texto(data.source || data.type || platform, 40);
    const meta = data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : {};
    const captureId = texto(data.captureId || data.sourceCaptureId || meta.captureId, 180);
    const captureAccount = texto(data.captureAccount || data.accountLabel || meta.accountLabel, 100);
    const streamId = texto(data.streamId || meta.streamId || meta.videoId, 180);
    const requesterNorm = nombreNormalizado(requester);
    const requesterKey = clavePersona(userId, requester, platform, facebookUserId);
    const displayNameKey = requester.normalize('NFKC').toLocaleLowerCase();
    const messageId = texto(data.messageId || data.id || data.mid, 160);
    const externalFacebookId = texto(data.platformMessageId || meta.facebookCommentId || meta.commentId, 160)
      || (platform === 'facebook' && /^\d+(?:_\d+)?$/.test(messageId) ? messageId : '');
    const fingerprint = platform === 'facebook'
      ? ['facebook', 'fingerprint', captureAccount, streamId, facebookUserId || userId || displayNameKey,
        Math.floor(ts / 30000), originalComment.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase()].join('\u001f')
      : '';
    const dedupeKey = platform === 'facebook'
      ? claveHash(externalFacebookId ? ['facebook', 'message', externalFacebookId].join('\u001f') : fingerprint)
      : '';
    const contentKey = claveHash(dedupeKey
      ? [sessionId, platform, 'dedupe', dedupeKey].join('\u001f')
      : messageId
        ? [sessionId, platform, 'message', messageId, ts].join('\u001f')
      : [sessionId, platform, ts, displayNameKey, originalComment].join('\u001f'));
    return {
      contentKey,
      sessionId,
      programDate: fechaPrograma(ts),
      platform,
      source,
      messageId,
      dedupeKey,
      captureId,
      captureAccount,
      streamId,
      userId,
      facebookUserId,
      requester,
      requesterNorm,
      requesterKey,
      avatarPath: /^\/rulo-avatars\/[a-f0-9]{64}\.webp$/i.test(String(data.avatarPath || data.avatar_path || data.chatimg || ''))
        ? String(data.avatarPath || data.avatar_path || data.chatimg)
        : '',
      comment,
      response: texto(data.response, 2000),
      event: texto(data.event, 60),
      isAlert: aBool(data.isAlert || data.is_alert),
      ts,
      receivedAt: Number(data.receivedAt) || Date.now(),
      programNumber: texto(data.programNumber || data.program_number, 30)
    };
  }

  function recordAudienceComment(entry) {
    const row = normalizeAudienceComment(entry);
    if (!row.comment || !row.requester) return { ok: false, inserted: false, error: 'Comentario o nombre vacío.' };
    try {
      const audienceUserId = ensureAudienceUser(row);
      if (row.avatarPath) updateAudienceAvatar(row, row.avatarPath);
      const previous = db.prepare(`SELECT COUNT(DISTINCT program_date) AS days
        FROM audience_comments_unique WHERE requester_key = ? AND program_date < ?
          AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0`).get(row.requesterKey, row.programDate);
      if (row.dedupeKey || row.messageId) {
        const prior = row.dedupeKey
          ? db.prepare('SELECT content_key FROM audience_comments WHERE dedupe_key = ? LIMIT 1').get(row.dedupeKey)
          : row.platform === 'facebook'
            ? db.prepare(`SELECT content_key FROM audience_comments
              WHERE session = ? AND platform = ? AND message_id = ? LIMIT 1`)
              .get(row.sessionId, row.platform, row.messageId)
            : db.prepare(`SELECT content_key FROM audience_comments
              WHERE session = ? AND platform = ? AND message_id = ? AND ts = ? LIMIT 1`)
              .get(row.sessionId, row.platform, row.messageId, row.ts);
        if (prior) {
          if (audienceUserId) db.prepare(`UPDATE audience_comments SET audience_user_id = ?
            WHERE content_key = ? AND audience_user_id IS NULL`).run(audienceUserId, prior.content_key);
          return { ok: true, inserted: false, contentKey: prior.content_key };
        }
      }
      const result = insertAudienceComment.run(
        row.contentKey, row.sessionId, row.programDate, row.platform, row.source,
        row.messageId, row.dedupeKey, row.captureId, row.captureAccount, row.streamId,
        row.userId, row.facebookUserId, row.requester, row.requesterNorm, row.requesterKey, row.comment,
        row.response, row.event, row.isAlert, row.ts, row.receivedAt, row.programNumber, row.avatarPath, audienceUserId
      );
      const inserted = Number(result.changes || 0) > 0;
      return { ok: true, inserted, contentKey: row.contentKey, returning: inserted && Number(previous?.days || 0) > 0, previousProgramDays: Number(previous?.days || 0), requesterKey: row.requesterKey, programDate: row.programDate };
    } catch (error) {
      log('No se pudo archivar el comentario de audiencia: ' + error.message);
      return { ok: false, inserted: false, error: error.message };
    }
  }

  function updateAudienceAvatar(entry, avatarValue) {
    const row = entry && typeof entry === 'object' && entry.requesterKey
      ? entry
      : normalizeAudienceComment(entry);
    const avatarPath = String(avatarValue || row.avatarPath || row.avatar_path || row.chatimg || '');
    if (!/^\/rulo-avatars\/[a-f0-9]{64}\.webp$/i.test(avatarPath) || !row.requesterKey) return 0;
    try {
      let updated = Number(db.prepare(`UPDATE audience_comments SET avatar_path = ?
        WHERE requester_key = ? AND avatar_path = ''`).run(avatarPath, row.requesterKey).changes || 0);

      // Los programas antiguos pueden tener solo el nombre. Completa esa identidad
      // únicamente si no hay otra persona con el mismo nombre en esa plataforma.
      if (row.requesterNorm && row.platform && row.requesterKey.indexOf('namev2:') !== 0) {
        const identities = db.prepare(`SELECT DISTINCT requester_key FROM audience_comments
          WHERE requester_norm = ? AND platform = ?`).all(row.requesterNorm, row.platform);
        const hasConflictingIdentity = identities.some(item =>
          item.requester_key !== row.requesterKey && item.requester_key.indexOf('namev2:') !== 0
        );
        const legacyIdentities = identities.filter(item => item.requester_key.indexOf('namev2:') === 0);
        if (!hasConflictingIdentity && legacyIdentities.length === 1) {
          updated += Number(db.prepare(`UPDATE audience_comments SET avatar_path = ?
            WHERE requester_norm = ? AND platform = ? AND requester_key = ? AND avatar_path = ''`)
            .run(avatarPath, row.requesterNorm, row.platform, legacyIdentities[0].requester_key).changes || 0);
        }
      }
      return updated;
    } catch (error) {
      log('No se pudo asociar la foto de perfil al archivo de audiencia: ' + error.message);
      return 0;
    }
  }

  function importLegacyAudienceComments(items) {
    let imported = 0;
    (Array.isArray(items) ? items : []).forEach(item => {
      if (item?.excludeFromProgramArchive === true) return;
      const result = recordAudienceComment(item);
      if (result && result.ok && result.inserted) imported += 1;
    });
    try {
      const legacyRows = db.prepare(`
        SELECT ts, session, platform, source, requester, requester_id,
          comment, reply_text
        FROM interactions
        WHERE comment IS NOT NULL AND TRIM(comment) <> ''
        ORDER BY ts ASC
      `).all();
      legacyRows.forEach(row => {
        const result = recordAudienceComment({
          timestamp: row.ts,
          session: row.session,
          platform: row.platform,
          source: row.source,
          requester: row.requester,
          userId: row.requester_id,
          comment: row.comment,
          response: row.reply_text
        });
        if (result && result.ok && result.inserted) imported += 1;
      });
    } catch (error) {
      log('No se pudieron importar comentarios de pedidos anteriores: ' + error.message);
    }
    return imported;
  }

  function audiencePrograms() {
    try {
      return db.prepare(`SELECT program_number AS program, COUNT(*) AS comments,
        MIN(ts) AS firstCommentAt, MAX(ts) AS lastCommentAt
        FROM audience_comments_unique WHERE program_number <> ''
        GROUP BY program_number ORDER BY CAST(program_number AS INTEGER), program_number`).all();
    } catch (error) {
      log('No se pudieron consultar los programas guardados: ' + error.message);
      return [];
    }
  }

  function ruloBehaviorRules(limit = 20) {
    try {
      return db.prepare('SELECT * FROM rulo_behavior_rules ORDER BY updated_at DESC, id DESC LIMIT ?')
        .all(Math.max(1, Math.min(40, Number(limit) || 20))).map(row => ({
          id: row.id, title: row.title, category: row.category,
          instruction: row.instruction, sourceNote: row.source_note || '', createdAt: row.created_at, updatedAt: row.updated_at
        }));
    } catch (error) {
      log('No se pudieron consultar las reglas aprobadas de Rulo: ' + error.message);
      return [];
    }
  }

  function saveRuloBehaviorRule(input = {}) {
    const id = texto(input.id, 80) || crypto.randomUUID();
    const title = texto(input.title, 100);
    const category = ['conversation', 'tone', 'general'].includes(input.category) ? input.category : 'general';
    const instruction = String(input.instruction || '').trim().slice(0, 700);
    const sourceNote = String(input.sourceNote || '').trim().slice(0, 300);
    const factVerified = input.factVerified === true;
    if (!title || instruction.length < 8) return { ok: false, error: 'Indica un título y una regla de al menos 8 caracteres.' };
    if (factVerified && sourceNote.length < 8) return { ok: false, error: 'Anota la fuente verificada del dato antes de activarlo.' };
    if (/(?:https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|facebook:|idv2:|\b(?:token|password|contraseñ\w*|clave privada)\s*[:=]|\b\+?\d[\d ().-]{7,}\d)/i.test(`${title}\n${instruction}`)) {
      return { ok: false, error: 'Quita enlaces, datos de contacto, identificadores o secretos antes de activar una regla.' };
    }
    const now = Date.now();
    try {
      const existing = db.prepare('SELECT id FROM rulo_behavior_rules WHERE id = ?').get(id);
      if (!existing && Number(db.prepare('SELECT COUNT(*) AS count FROM rulo_behavior_rules').get()?.count || 0) >= 40) {
        return { ok: false, error: 'Llegaste al límite de 40 reglas activas. Borra una antes de guardar otra.' };
      }
      db.prepare(`INSERT INTO rulo_behavior_rules (id, title, category, instruction, source_note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, category = excluded.category,
          instruction = excluded.instruction, source_note = excluded.source_note, updated_at = excluded.updated_at`).run(id, title, category, instruction, factVerified ? sourceNote : '', now, now);
      return { ok: true, item: ruloBehaviorRules(40).find(item => item.id === id) || null };
    } catch (error) {
      log('No se pudo guardar una regla aprobada de Rulo: ' + error.message);
      return { ok: false, error: 'No se pudo guardar la regla de Rulo.' };
    }
  }

  function deleteRuloBehaviorRule(id) {
    try {
      const result = db.prepare('DELETE FROM rulo_behavior_rules WHERE id = ?').run(texto(id, 80));
      return { ok: Number(result.changes || 0) > 0 };
    } catch (error) {
      log('No se pudo borrar una regla de Rulo: ' + error.message);
      return { ok: false, error: 'No se pudo borrar la regla de Rulo.' };
    }
  }

  function simulationCases(limit = 100) {
    try {
      return db.prepare(`SELECT c.*, COUNT(r.id) AS run_count,
        (SELECT verdict FROM rulo_simulation_runs r2 WHERE r2.case_id = c.id ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1) AS last_verdict
        FROM rulo_simulation_cases c LEFT JOIN rulo_simulation_runs r ON r.case_id = c.id
        GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ?`).all(Math.max(1, Math.min(200, Number(limit) || 100))).map(row => ({
        id: row.id, title: row.title, programNumber: row.program_number,
        participantCommentId: row.participant_comment_id, question: row.question,
        expectedBehavior: row.expected_behavior, createdAt: row.created_at, updatedAt: row.updated_at,
        runCount: Number(row.run_count) || 0, lastVerdict: row.last_verdict || ''
      }));
    } catch (error) {
      log('No se pudieron consultar los casos de evaluación de Rulo: ' + error.message);
      return [];
    }
  }

  function saveSimulationCase(input = {}) {
    const id = texto(input.id, 80) || crypto.randomUUID();
    const title = texto(input.title, 120);
    const programNumber = texto(input.programNumber, 30);
    const participantCommentId = texto(input.participantCommentId, 30);
    const question = String(input.question || '').trim().slice(0, 500);
    const expectedBehavior = String(input.expectedBehavior || '').trim().slice(0, 2000);
    if (!title || !/^\d{1,30}$/.test(programNumber) || (participantCommentId && !/^\d{1,30}$/.test(participantCommentId)) || !question) {
      return { ok: false, error: 'Indica un título, un programa válido y una pregunta de hasta 500 caracteres.' };
    }
    const now = Date.now();
    try {
      db.prepare(`INSERT INTO rulo_simulation_cases
        (id, title, program_number, participant_comment_id, question, expected_behavior, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, program_number = excluded.program_number,
          participant_comment_id = excluded.participant_comment_id, question = excluded.question,
          expected_behavior = excluded.expected_behavior, updated_at = excluded.updated_at`).run(
        id, title, programNumber, participantCommentId, question, expectedBehavior, now, now
      );
      return { ok: true, item: simulationCases(200).find(item => item.id === id) || null };
    } catch (error) {
      log('No se pudo guardar el caso de evaluación de Rulo: ' + error.message);
      return { ok: false, error: 'No se pudo guardar el caso de evaluación.' };
    }
  }

  function deleteSimulationCase(id) {
    try {
      const result = db.prepare('DELETE FROM rulo_simulation_cases WHERE id = ?').run(texto(id, 80));
      return { ok: Number(result.changes || 0) > 0 };
    } catch (error) {
      log('No se pudo borrar el caso de evaluación de Rulo: ' + error.message);
      return { ok: false, error: 'No se pudo borrar el caso de evaluación.' };
    }
  }

  function simulationCaseRuns(caseId, limit = 20) {
    try {
      return db.prepare(`SELECT * FROM rulo_simulation_runs WHERE case_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(texto(caseId, 80), Math.max(1, Math.min(100, Number(limit) || 20))).map(row => ({
          id: row.id, caseId: row.case_id, question: row.question, answer: row.answer,
          provider: row.provider, model: row.model, action: row.action, spotifyMode: row.spotify_mode,
          timeScale: Number(row.time_scale) === 10 ? 10 : 1,
          verdict: row.verdict, reviewNote: row.review_note, createdAt: row.created_at
        }));
    } catch (error) {
      log('No se pudieron consultar las ejecuciones de evaluación de Rulo: ' + error.message);
      return [];
    }
  }

  function recordSimulationRun(input = {}) {
    const caseId = texto(input.caseId, 80);
    const question = String(input.question || '').trim().slice(0, 500);
    const answer = String(input.answer || '').trim().slice(0, 4000);
    if (!caseId || !question || !answer) return { ok: false, error: 'Faltan el caso, la pregunta o la respuesta de la evaluación.' };
    try {
      const exists = db.prepare('SELECT id FROM rulo_simulation_cases WHERE id = ?').get(caseId);
      if (!exists) return { ok: false, error: 'El caso de evaluación ya no existe.' };
      const result = db.prepare(`INSERT INTO rulo_simulation_runs
        (case_id, question, answer, provider, model, action, spotify_mode, time_scale, verdict, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
        caseId, question, answer, texto(input.provider, 40), texto(input.model, 120),
        texto(input.action, 60), ['preview', 'play'].includes(input.spotifyMode) ? input.spotifyMode : '',
        Number(input.timeScale) === 10 ? 10 : 1, Date.now()
      );
      return { ok: true, id: Number(result.lastInsertRowid) };
    } catch (error) {
      log('No se pudo guardar la ejecución de evaluación de Rulo: ' + error.message);
      return { ok: false, error: 'No se pudo guardar el resultado de evaluación.' };
    }
  }

  function reviewSimulationRun(id, verdict, note = '') {
    const runId = Number(id);
    const normalizedVerdict = ['pass', 'fail', 'pending'].includes(verdict) ? verdict : '';
    if (!Number.isInteger(runId) || runId <= 0 || !normalizedVerdict) return { ok: false, error: 'La revisión del caso no es válida.' };
    try {
      const result = db.prepare('UPDATE rulo_simulation_runs SET verdict = ?, review_note = ? WHERE id = ?')
        .run(normalizedVerdict, String(note || '').trim().slice(0, 1000), runId);
      return { ok: Number(result.changes || 0) > 0 };
    } catch (error) {
      log('No se pudo revisar la ejecución de evaluación de Rulo: ' + error.message);
      return { ok: false, error: 'No se pudo actualizar la revisión.' };
    }
  }

  function lotteryProgramSnapshot(program) {
    try {
      const row = db.prepare('SELECT * FROM rulo_lottery_program_snapshots WHERE program_number = ?').get(texto(program, 30));
      if (!row) return null;
      let snapshot = null;
      try { snapshot = JSON.parse(row.snapshot_json); } catch { return null; }
      return {
        programNumber: row.program_number,
        capturedAt: Number(row.captured_at) || 0,
        historicalVerified: row.historical_verified === 1,
        note: row.note,
        snapshot
      };
    } catch (error) {
      log('No se pudo consultar la captura de lotería del programa: ' + error.message);
      return null;
    }
  }

  function saveLotteryProgramSnapshot(program, snapshot, options = {}) {
    const programNumber = texto(program, 30);
    if (!/^\d{1,30}$/.test(programNumber) || !snapshot || typeof snapshot !== 'object') {
      return { ok: false, error: 'El número de programa o la captura de lotería no son válidos.' };
    }
    let serialized = '';
    try { serialized = JSON.stringify(snapshot); } catch { return { ok: false, error: 'La captura no se pudo serializar.' }; }
    if (serialized.length > 2_000_000) return { ok: false, error: 'La captura de lotería es demasiado grande.' };
    try {
      const capturedAt = Number(options.capturedAt) || Date.now();
      db.prepare(`INSERT INTO rulo_lottery_program_snapshots
        (program_number, snapshot_json, captured_at, historical_verified, note)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(program_number) DO UPDATE SET snapshot_json = excluded.snapshot_json,
          captured_at = excluded.captured_at, historical_verified = excluded.historical_verified, note = excluded.note`).run(
        programNumber, serialized, capturedAt, options.historicalVerified === true ? 1 : 0, texto(options.note, 500)
      );
      return { ok: true, item: lotteryProgramSnapshot(programNumber) };
    } catch (error) {
      log('No se pudo guardar la captura de lotería del programa: ' + error.message);
      return { ok: false, error: 'No se pudo guardar la captura de lotería.' };
    }
  }

  function audienceCommentsForProgram(program) {
    try {
      return db.prepare(`SELECT * FROM audience_comments_unique
        WHERE program_number = ? ORDER BY ts ASC, id ASC`).all(String(program));
    } catch (error) {
      log('No se pudieron consultar los comentarios del programa: ' + error.message);
      return [];
    }
  }

  // These lookups are internal to Cortex. Audience row IDs and source identity keys never reach a browser route.
  function audienceMemorySubjects(searchTerm = '', limit = 50) {
    const term = texto(searchTerm, 120).trim().toLocaleLowerCase();
    const max = Math.max(1, Math.min(100, Number(limit) || 50));
    const conditions = [
      'audience_user_id IS NOT NULL',
      'is_alert = 0',
      "LOWER(platform) NOT IN ('dashboard', 'simulado')",
      "LOWER(source) <> 'dashboard'"
    ];
    const params = [];
    if (term) {
      conditions.push('(LOWER(requester) LIKE ? OR LOWER(requester_norm) LIKE ?)');
      params.push(`%${term}%`, `%${term}%`);
    }
    try {
      return db.prepare(`SELECT 'audience:' || CAST(audience_user_id AS TEXT) AS subjectKey,
        (SELECT c2.requester FROM audience_comments_unique c2 WHERE c2.audience_user_id = c.audience_user_id
          AND c2.is_alert = 0 AND LOWER(c2.platform) NOT IN ('dashboard', 'simulado')
          ORDER BY c2.ts DESC, c2.id DESC LIMIT 1) AS displayName,
        (SELECT c2.platform FROM audience_comments_unique c2 WHERE c2.audience_user_id = c.audience_user_id
          AND c2.is_alert = 0 AND LOWER(c2.platform) NOT IN ('dashboard', 'simulado')
          ORDER BY c2.ts DESC, c2.id DESC LIMIT 1) AS platform,
        COUNT(*) AS commentCount, COUNT(DISTINCT program_date) AS programCount,
        MIN(program_date) AS firstProgram, MAX(program_date) AS lastProgram, MAX(ts) AS lastSeen
        FROM audience_comments_unique c WHERE ${conditions.join(' AND ')}
        GROUP BY audience_user_id ORDER BY lastSeen DESC LIMIT ?`).all(...params, max);
    } catch (error) {
      log('No se pudieron listar participantes estables para Cuaderno Vivo: ' + error.message);
      return [];
    }
  }

  function audienceMemorySubjectKey(requesterKey) {
    const key = texto(requesterKey, 240).toLocaleLowerCase();
    if (!/^(?:facebook|idv2):\S+$/i.test(key) || key.startsWith('namev2:')) return '';
    try {
      const row = db.prepare(`SELECT audience_user_id FROM audience_comments_unique
        WHERE requester_key = ? AND audience_user_id IS NOT NULL
          AND is_alert = 0 AND LOWER(platform) NOT IN ('dashboard', 'simulado')
        ORDER BY ts DESC, id DESC LIMIT 1`).get(key);
      return row?.audience_user_id ? `audience:${Number(row.audience_user_id)}` : '';
    } catch (error) {
      log('No se pudo resolver la identidad estable para Cuaderno Vivo: ' + error.message);
      return '';
    }
  }

  // Returns only public archived conversation text; no names, IDs, avatars, alerts, or simulation messages.
  function audienceMemoryHistory(subjectKey, limit = 120) {
    const key = String(subjectKey || '').trim().toLocaleLowerCase();
    const audienceUserId = /^audience:(\d{1,20})$/.exec(key)?.[1];
    if (!audienceUserId) return [];
    const max = Math.max(1, Math.min(240, Number(limit) || 120));
    try {
      return db.prepare(`SELECT program_date AS programDate, comment, response
        FROM audience_comments_unique
        WHERE audience_user_id = ? AND is_alert = 0
          AND LOWER(platform) NOT IN ('dashboard', 'simulado') AND LOWER(source) <> 'dashboard'
        ORDER BY ts DESC, id DESC LIMIT ?`).all(Number(audienceUserId), max).reverse();
    } catch (error) {
      log('No se pudo consultar el contexto archivado para Cuaderno Vivo: ' + error.message);
      return [];
    }
  }

  function assignUnassignedAudienceCommentsToProgram(program) {
    const programNumber = texto(program, 30);
    if (!/^\d{1,30}$/.test(programNumber)) return { ok: false, error: 'Número de programa inválido.' };
    try {
      db.exec('BEGIN IMMEDIATE');
      const marker = db.prepare("SELECT MAX(id) AS id FROM audience_comments WHERE program_number <> ''").get();
      const lastAssignedId = Number(marker?.id) || 0;
      const result = db.prepare("UPDATE audience_comments SET program_number = ? WHERE id > ? AND program_number = ''").run(programNumber, lastAssignedId);
      db.exec('COMMIT');
      const comments = Number(result.changes || 0);
      if (comments) backfillAudienceUserLinks();
      return comments
        ? { ok: true, program: programNumber, comments, firstId: lastAssignedId + 1 }
        : { ok: false, error: 'No hay comentarios nuevos sin número de programa desde el último chat guardado.' };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* conserva el error original */ }
      log('No se pudo asignar el número de programa: ' + error.message);
      return { ok: false, error: error.message };
    }
  }

  function updateAudienceResponse(entry, response) {
    const row = typeof entry === 'string' ? { contentKey: entry, comment: 'key', requester: 'key' } : normalizeAudienceComment(entry);
    const text = texto(response, 2000);
    if (!row.contentKey || !text) return false;
    try {
      const result = db.prepare(`
        UPDATE audience_comments SET response = ?
        WHERE content_key = ? AND response = ''
      `).run(text, row.contentKey);
      return Number(result.changes || 0) > 0;
    } catch (error) {
      log('No se pudo guardar la respuesta en el archivo de audiencia: ' + error.message);
      return false;
    }
  }

  function audienceComments(options2) {
    const opts = options2 || {};
    const limite = Math.max(1, Math.min(1000, Number(opts.limit) || 100));
    const offset = Math.max(0, Number(opts.offset) || 0);
    const conditions = [];
    const params = [];
    if (opts.from) { conditions.push('ts >= ?'); params.push(Number(opts.from)); }
    if (opts.to) { conditions.push('ts <= ?'); params.push(Number(opts.to)); }
    if (opts.platform) { conditions.push('platform = ?'); params.push(texto(opts.platform, 40).toLocaleLowerCase()); }
    if (opts.userId) { conditions.push('(user_id = ? OR facebook_user_id = ?)'); params.push(texto(opts.userId, 120), texto(opts.userId, 120)); }
    if (opts.requester) {
      conditions.push('(requester_key = ? OR requester_norm = ? OR user_id = ? OR facebook_user_id = ?)');
      const identityUserId = texto(opts.userId || opts.requester, 120);
      params.push(clavePersona(opts.userId, opts.requester, opts.platform, opts.facebookUserId), nombreNormalizado(opts.requester), identityUserId, identityUserId);
    }
    if (opts.search) {
      const needle = '%' + texto(opts.search, 200).toLocaleLowerCase() + '%';
      conditions.push('(LOWER(comment) LIKE ? OR LOWER(requester) LIKE ? OR LOWER(user_id) LIKE ? OR LOWER(facebook_user_id) LIKE ?)');
      params.push(needle, needle, needle, needle);
    }
    try {
      return db.prepare(`SELECT * FROM audience_comments_unique ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`)
        .all(...params, limite, offset);
    } catch (error) {
      log('No se pudo consultar el archivo de audiencia: ' + error.message);
      return [];
    }
  }

  function databaseTables() {
    try {
      return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all().map(row => row.name);
    } catch (error) {
      log('No se pudieron enumerar las tablas SQLite: ' + error.message);
      return [];
    }
  }

  function databaseTableRows(tableName, options2) {
    const opts = options2 || {};
    const name = String(tableName || '');
    if (!databaseTables().includes(name)) return null;
    const limit = Math.max(10, Math.min(100, Number(opts.limit) || 50));
    const offset = Math.max(0, Number(opts.offset) || 0);
    const search = texto(opts.search, 200);
    const quoted = '"' + name.replace(/"/g, '""') + '"';
    try {
      const schema = db.prepare('PRAGMA table_info(' + quoted + ')').all();
      const columns = schema.map(column => column.name);
      const searchable = schema.filter(column => /char|text|clob/i.test(String(column.type || ''))).map(column => column.name);
      const where = search && searchable.length
        ? ' WHERE (' + searchable.map(column => 'LOWER(CAST("' + column.replace(/"/g, '""') + '" AS TEXT)) LIKE ?').join(' OR ') + ')'
        : '';
      const params = search && searchable.length ? searchable.map(() => '%' + search.toLocaleLowerCase() + '%') : [];
      const total = Number(db.prepare('SELECT COUNT(*) AS total FROM ' + quoted + where).get(...params)?.total || 0);
      const primaryKeys = schema.filter(column => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(column => column.name);
      const ordering = primaryKeys.length ? ' ORDER BY ' + primaryKeys.map(column => '"' + column.replace(/"/g, '""') + '" DESC').join(', ') : '';
      const rows = db.prepare('SELECT * FROM ' + quoted + where + ordering + ' LIMIT ? OFFSET ?').all(...params, limit, offset);
      return { table: name, columns, total, limit, offset, rows };
    } catch (error) {
      log('No se pudo leer la tabla SQLite ' + name + ': ' + error.message);
      return null;
    }
  }

  function databaseSearch(searchTerm, options2) {
    const term = texto(searchTerm, 200).trim();
    const opts = options2 || {};
    const perTableLimit = Math.max(1, Math.min(200, Number(opts.limit) || 100));
    const tables = databaseTables();
    if (!term) return { tables, matches: [] };
    const needle = '%' + term.toLocaleLowerCase() + '%';
    const matches = [];
    for (const table of tables) {
      if (matches.length >= 300) break;
      const quotedTable = '"' + table.replace(/"/g, '""') + '"';
      try {
        const schema = db.prepare('PRAGMA table_info(' + quotedTable + ')').all();
        const searchable = schema.filter(column => /char|text|clob/i.test(String(column.type || '')));
        if (!searchable.length) continue;
        const where = searchable.map(column => 'LOWER(CAST("' + column.name.replace(/"/g, '""') + '" AS TEXT)) LIKE ?').join(' OR ');
        const primaryKeys = schema.filter(column => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(column => '"' + column.name.replace(/"/g, '""') + '" DESC');
        const order = primaryKeys.length ? ' ORDER BY ' + primaryKeys.join(', ') : '';
        const rows = db.prepare('SELECT * FROM ' + quotedTable + ' WHERE (' + where + ')' + order + ' LIMIT ?')
          .all(...searchable.map(() => needle), Math.min(perTableLimit, 300 - matches.length));
        for (const row of rows) matches.push({ table, row });
      } catch (error) { log('No se pudo buscar en SQLite.' + table + ': ' + error.message); }
    }
    return { tables, matches };
  }

  function audienceIdentityQuery(searchTerm) {
    const term = texto(searchTerm, 120).trim().toLocaleLowerCase();
    if (!term) return { query: '', comments: 0, identities: [] };
    const needle = '%' + term + '%';
    try {
      const where = `LOWER(requester) LIKE ? OR LOWER(user_id) LIKE ? OR LOWER(facebook_user_id) LIKE ? OR LOWER(requester_key) LIKE ?`;
      const params = [needle, needle, needle, needle];
      const total = Number(db.prepare(`SELECT COUNT(*) AS comments FROM audience_comments_unique WHERE ${where}`).get(...params)?.comments || 0);
      const identities = db.prepare(`SELECT requester, platform, user_id, facebook_user_id, requester_key,
        COUNT(*) AS comments, MIN(program_date) AS firstDate, MAX(program_date) AS lastDate
        FROM audience_comments_unique WHERE ${where}
        GROUP BY requester, platform, user_id, facebook_user_id, requester_key ORDER BY comments DESC LIMIT 50`).all(...params);
      return { query: term, comments: total, identities };
    } catch (error) {
      log('No se pudo consultar la identidad en el archivo de audiencia: ' + error.message);
      return { query: term, comments: 0, identities: [], error: error.message };
    }
  }

  function audienceTopCommenters(options2) {
    const opts = options2 || {};
    const limite = Math.max(1, Math.min(100, Number(opts.limit) || 20));
    const condiciones = ["LOWER(platform) <> 'dashboard'", "LOWER(source) <> 'dashboard'"];
    const params = [];
    if (opts.from) { condiciones.push('ts >= ?'); params.push(Number(opts.from)); }
    if (opts.to) { condiciones.push('ts <= ?'); params.push(Number(opts.to)); }
    if (opts.platform) { condiciones.push('platform = ?'); params.push(texto(opts.platform, 40).toLocaleLowerCase()); }
    const orderBy = opts.orderBy === 'days' ? 'program_days DESC, comments DESC' : 'comments DESC, program_days DESC';
    try {
      return db.prepare(`
        SELECT requester_key, MAX(CASE WHEN facebook_user_id <> '' THEN facebook_user_id ELSE user_id END) AS user_id,
          (SELECT c2.requester FROM audience_comments_unique c2 WHERE c2.requester_key = c.requester_key AND LOWER(c2.platform) <> 'dashboard' AND LOWER(c2.source) <> 'dashboard' ORDER BY c2.ts DESC LIMIT 1) AS requester,
          COUNT(*) AS comments, COUNT(DISTINCT program_date) AS program_days,
          MIN(program_date) AS first_program, MAX(program_date) AS last_program
        FROM audience_comments_unique c
        WHERE ${condiciones.map(value => value.replace(/\bplatform\b/g, 'c.platform').replace(/\bsource\b/g, 'c.source')).join(' AND ')} AND c.is_alert = 0
        GROUP BY requester_key ORDER BY ${orderBy}, requester COLLATE NOCASE LIMIT ?
      `).all(...params, limite);
    } catch (error) {
      log('No se pudo consultar el ranking de audiencia: ' + error.message);
      return [];
    }
  }

  function audienceDaysForPerson(person, options2) {
    const identity = clavePersona(options2?.userId, person, options2?.platform);
    const name = nombreNormalizado(person);
    try {
      return db.prepare(`
        SELECT program_date, GROUP_CONCAT(DISTINCT platform) AS platforms, COUNT(*) AS comments,
          MIN(ts) AS first_comment, MAX(ts) AS last_comment
        FROM audience_comments_unique WHERE (requester_key = ? OR requester_norm = ? OR user_id = ? OR facebook_user_id = ?)
          AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0
        GROUP BY program_date ORDER BY program_date DESC
      `).all(identity, name, texto(options2?.userId || person, 120), texto(options2?.userId || person, 120));
    } catch (error) {
      log('No se pudo consultar la actividad de la persona: ' + error.message);
      return [];
    }
  }

  function audienceAttendanceForRequesterKey(requesterKey) {
    const key = texto(requesterKey, 240).trim().toLocaleLowerCase();
    const lastPart = key.split(':').at(-1) || '';
    if (!/^(?:facebook|idv2):\S+$/i.test(key) || !lastPart || /^(?:unknown|null|undefined|anonymous|guest|\[object object\])$/i.test(lastPart)) return [];
    try {
      return db.prepare(`SELECT program_number AS programNumber, program_date AS programDate,
        COUNT(*) AS comments, MIN(ts) AS firstCommentAt, MAX(ts) AS lastCommentAt
        FROM audience_comments_unique
        WHERE LOWER(requester_key) = ? AND is_alert = 0
          AND LOWER(platform) NOT IN ('dashboard', 'simulado')
          AND LOWER(source) <> 'dashboard'
        GROUP BY program_number, program_date
        ORDER BY program_date DESC, CAST(program_number AS INTEGER) DESC`).all(key);
    } catch (error) {
      log('No se pudo consultar la asistencia histórica por identidad estable: ' + error.message);
      return [];
    }
  }

  function audienceSummary() {
    try {
      return db.prepare(`
        SELECT COUNT(*) AS comments, COUNT(DISTINCT requester_key) AS people,
          COUNT(DISTINCT program_date) AS program_days,
          MIN(program_date) AS first_program, MAX(program_date) AS last_program
        FROM audience_comments_unique WHERE LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0
      `).get();
    } catch (error) {
      log('No se pudo resumir el archivo de audiencia: ' + error.message);
      return null;
    }
  }

  function audienceIdentityStats() {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS comments,
        SUM(CASE WHEN (facebook_user_id <> '' OR user_id <> '') AND LOWER(CASE WHEN facebook_user_id <> '' THEN facebook_user_id ELSE user_id END) NOT IN ('unknown','null','undefined','anonymous','[object object]') THEN 1 ELSE 0 END) AS identified_comments,
        COUNT(DISTINCT requester_key) AS people
        FROM audience_comments_unique WHERE LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0`).get();
      const comments = Number(row?.comments || 0), identified = Number(row?.identified_comments || 0);
      return { comments, identifiedComments: identified, people: Number(row?.people || 0), coveragePercent: comments ? Math.round(identified * 1000 / comments) / 10 : 0 };
    } catch (error) {
      log('No se pudo medir la cobertura de identidad de audiencia: ' + error.message);
      return null;
    }
  }

  function audienceMostRegular(limit) {
    return audienceTopCommenters({ limit: limit || 10, orderBy: 'days' });
  }

  function audienceBusiestDays(limit) {
    try {
      return db.prepare(`SELECT program_date, COUNT(*) AS comments, COUNT(DISTINCT requester_key) AS people
        FROM audience_comments_unique WHERE LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0
        GROUP BY program_date ORDER BY comments DESC, program_date DESC LIMIT ?`).all(Math.max(1, Math.min(30, Number(limit) || 10)));
    } catch (error) {
      log('No se pudieron consultar las fechas con más actividad: ' + error.message);
      return [];
    }
  }

  function audienceFrequentTerms(limit) {
    const stopwords = new Set(('para como pero porque cuando donde quien quienes que cual cuales con sin una uno unos unas del los las el la de en por es son fue hay mas muy tambien todo todos estar estuvo tiene tienen desde hasta sobre entre esta este esto eso algo poco mucho cada como hola saludos gracias buen buena buenos buenas dia dias noche noches programa programas rulo musica música tema temas pone ponen reproduce reproducir cancion canciones pedido pedidos chat vivo gente radio').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/));
    try {
      const rows = db.prepare(`SELECT comment FROM audience_comments_unique
        WHERE LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0`).all();
      const counts = new Map();
      rows.forEach(row => {
        const plain = textoPlanoComentario(row.comment);
        plain.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}]{4,}/gu)?.forEach(word => {
          if (!stopwords.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
        });
      });
      return { comments: rows.length, words: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).slice(0, Math.max(1, Math.min(30, Number(limit) || 12))).map(([word, mentions]) => ({ word, mentions })) };
    } catch (error) {
      log('No se pudieron analizar las palabras frecuentes: ' + error.message);
      return { comments: 0, words: [] };
    }
  }

  function claimAudienceGreeting(requesterKey, programDate, greetedAt) {
    try {
      const result = db.prepare('INSERT OR IGNORE INTO audience_return_greetings (requester_key, program_date, greeted_at) VALUES (?, ?, ?)')
        .run(texto(requesterKey, 180), texto(programDate, 10), Number(greetedAt) || Date.now());
      return Number(result.changes || 0) > 0;
    } catch (error) {
      log('No se pudo registrar el saludo de regreso: ' + error.message);
      return false;
    }
  }

  function audienceProgramSummary(programDate) {
    try {
      const selectedDate = texto(programDate, 10) || db.prepare(`SELECT MAX(program_date) AS program_date FROM audience_comments_unique
        WHERE LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0`).get()?.program_date;
      if (!selectedDate) return null;
      const summary = db.prepare(`SELECT ? AS program_date, COUNT(*) AS comments, COUNT(DISTINCT requester_key) AS people,
        SUM(CASE WHEN response <> '' THEN 1 ELSE 0 END) AS rulo_replies,
        MIN(ts) AS started_at, MAX(ts) AS ended_at
        FROM audience_comments_unique WHERE program_date = ? AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0`).get(selectedDate, selectedDate);
      summary.alerts = Number(db.prepare(`SELECT COUNT(*) AS count FROM audience_comments_unique WHERE program_date = ?
        AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 1`).get(selectedDate)?.count || 0);
      const commenters = db.prepare(`SELECT requester, COUNT(*) AS comments FROM audience_comments_unique
        WHERE program_date = ? AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0
        GROUP BY requester_key ORDER BY comments DESC, requester COLLATE NOCASE LIMIT 10`).all(selectedDate);
      summary.returning_people = Number(db.prepare(`SELECT COUNT(DISTINCT today.requester_key) AS count FROM audience_comments_unique today
        WHERE today.program_date = ? AND today.is_alert = 0 AND LOWER(today.platform) <> 'dashboard' AND LOWER(today.source) <> 'dashboard'
          AND EXISTS (SELECT 1 FROM audience_comments_unique prior WHERE prior.requester_key = today.requester_key AND prior.program_date < today.program_date AND prior.is_alert = 0 AND LOWER(prior.platform) <> 'dashboard' AND LOWER(prior.source) <> 'dashboard')`)
        .get(selectedDate)?.count || 0);
      const terms = audienceFrequentTermsForDate(selectedDate, 12);
      const highlights = audienceHighlights(selectedDate, 5);
      return { ...summary, commenters, terms, highlights };
    } catch (error) {
      log('No se pudo preparar el resumen del programa: ' + error.message);
      return null;
    }
  }

  function audienceFrequentTermsForDate(programDate, limit) {
    const rows = db.prepare(`SELECT comment FROM audience_comments_unique WHERE program_date = ?
      AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0`).all(programDate);
    return countFrequentTerms(rows, limit);
  }

  function countFrequentTerms(rows, limit) {
    const stopwords = new Set(('para como pero porque cuando donde quien quienes que cual cuales con sin una uno unos unas del los las el la de en por es son fue hay mas muy tambien todo todos estar estuvo tiene tienen desde hasta sobre entre esta este esto eso algo poco mucho cada como hola saludos gracias buen buena buenos buenas dia dias noche noches programa programas rulo musica música tema temas pone ponen reproduce reproducir cancion canciones pedido pedidos chat vivo gente radio').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/));
    const counts = new Map();
    rows.forEach(row => textoPlanoComentario(row.comment).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}]{4,}/gu)?.forEach(word => {
      if (!stopwords.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    }));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).slice(0, Math.max(1, Math.min(30, Number(limit) || 12))).map(([word, mentions]) => ({ word, mentions }));
  }

  function audienceHighlights(programDate, limit) {
    try {
      const selectedDate = texto(programDate, 10);
      if (!selectedDate) return [];
      return db.prepare(`SELECT CAST(ts / 300000 AS INTEGER) * 300000 AS window_start,
        SUM(CASE WHEN is_alert = 0 THEN 1 ELSE 0 END) AS comments,
        COUNT(DISTINCT CASE WHEN is_alert = 0 THEN requester_key END) AS people,
        SUM(CASE WHEN is_alert = 0 AND response <> '' THEN 1 ELSE 0 END) AS rulo_replies,
        SUM(CASE WHEN is_alert = 1 THEN 1 ELSE 0 END) AS reactions
        FROM audience_comments_unique WHERE program_date = ? AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard'
        GROUP BY CAST(ts / 300000 AS INTEGER) ORDER BY comments DESC, window_start LIMIT ?`)
        .all(selectedDate, Math.max(1, Math.min(20, Number(limit) || 5))).map(row => ({
          ...row, label: new Date(row.window_start).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
        }));
    } catch (error) {
      log('No se pudieron detectar momentos activos: ' + error.message);
      return [];
    }
  }

  function audiencePersonProfile(person) {
    const normalized = nombreNormalizado(person);
    if (!normalized) return { identities: [], words: [] };
    try {
      const identities = db.prepare(`SELECT requester_key, requester AS name, MAX(facebook_user_id) AS facebook_user_id,
        COUNT(*) AS comments, COUNT(DISTINCT program_date) AS program_days, MIN(program_date) AS first_program, MAX(program_date) AS last_program,
        GROUP_CONCAT(DISTINCT platform) AS platforms
        FROM audience_comments_unique WHERE requester_norm = ? AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0
        GROUP BY requester_key ORDER BY comments DESC LIMIT 10`).all(normalized);
      const allRows = [];
      identities.slice(0, 5).forEach(identity => {
        const comments = db.prepare(`SELECT comment FROM audience_comments_unique WHERE requester_key = ? AND LOWER(platform) <> 'dashboard' AND LOWER(source) <> 'dashboard' AND is_alert = 0 LIMIT 20000`).all(identity.requester_key);
        allRows.push(...comments);
      });
      return { identities: identities.map(({ requester_key, ...rest }) => rest), words: countFrequentTerms(allRows, 12) };
    } catch (error) {
      log('No se pudo armar el perfil de participación: ' + error.message);
      return { identities: [], words: [] };
    }
  }

  function audienceReturningMembers(limit) {
    try {
      return db.prepare(`SELECT c.requester_key,
        (SELECT c2.requester FROM audience_comments_unique c2 WHERE c2.requester_key = c.requester_key AND c2.is_alert = 0 ORDER BY c2.ts DESC LIMIT 1) AS requester,
        COUNT(DISTINCT c.program_date) AS program_days, COUNT(*) AS comments,
        MIN(c.program_date) AS first_program, MAX(c.program_date) AS last_program
        FROM audience_comments_unique c WHERE c.is_alert = 0 AND LOWER(c.platform) <> 'dashboard' AND LOWER(c.source) <> 'dashboard'
        GROUP BY c.requester_key HAVING COUNT(DISTINCT c.program_date) > 1
        ORDER BY last_program DESC, program_days DESC, comments DESC LIMIT ?`).all(Math.max(1, Math.min(30, Number(limit) || 10)))
        .map(({ requester_key, ...row }) => row);
    } catch (error) {
      log('No se pudo consultar quiénes vuelven: ' + error.message);
      return [];
    }
  }

  // Consultas determinísticas y de solo lectura. Nunca se ejecuta SQL enviado
  // por el usuario ni se exponen comentarios completos al dashboard.
  function audienceQuestion(question) {
    const raw = texto(question, 500);
    const cleanQuestion = raw.replace(/^[¿¡\s]+|[?!.\s]+$/g, '').trim();
    const normalized = cleanQuestion.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    if (!raw) return { ok: false, answer: 'Escribe una pregunta sobre la audiencia.' };
    if (/mas fiel|mas constante|asidu/.test(normalized) && /persona|audiencia|fan|fans|quien/.test(normalized)) {
      const rows = audienceMostRegular(10);
      const best = rows[0];
      return best
        ? { ok: true, answer: `${best.requester} aparece en ${best.program_days} fechas, con ${best.comments} comentarios. Uso “más fiel” como participación en más fechas del archivo; los datos disponibles van del ${best.first_program} al ${best.last_program}.`, data: { type: 'regular', rows } }
        : { ok: true, answer: 'Todavía no hay comentarios archivados para calcular la participación habitual.', data: { type: 'regular', rows } };
    }
    if (/quien|persona|fan|fans/.test(normalized) && /mas|numero|n[uú]mero|top|comento|comenta|comentarios/.test(normalized)) {
      const rows = audienceTopCommenters({ limit: 10 });
      if (!rows.length) return { ok: true, answer: 'Todavía no hay comentarios archivados para calcular el ranking.', data: { type: 'top', rows } };
      const best = rows[0];
      return { ok: true, answer: `Quien más comentó es ${best.requester || 'nombre desconocido'}, con ${best.comments} comentarios en ${best.program_days} programas/días. El archivo cubre del ${best.first_program} al ${best.last_program}. “Fan número 1” lo tomo como una forma informal de llamar al participante más activo; no mide otros tipos de apoyo.`, data: { type: 'top', rows } };
    }
    if (/cuantos|cuantas|total|resumen/.test(normalized) && /coment|person|program|dia/.test(normalized)) {
      const summary = audienceSummary();
      if (!summary) return { ok: false, answer: 'No pude leer el archivo permanente de audiencia.' };
      return { ok: true, answer: `El archivo tiene ${summary.comments} comentarios de ${summary.people} personas en ${summary.program_days} fechas de programa. Rango guardado: ${summary.first_program || 'sin datos'} a ${summary.last_program || 'sin datos'}.`, data: { type: 'summary', summary } };
    }
    const profileMatch = cleanQuestion.match(/\b(?:que suele pedir|que pide|que temas? (?:suele )?comenta|de que habla|perfil de participacion de|historial de)\s+(.+)$/i);
    if (profileMatch) {
      const person = profileMatch[1].replace(/[¿?¡!.,:;]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!person) return { ok: false, answer: 'Indica el nombre visible para consultar, por ejemplo: “¿Qué suele pedir Ana?”.' };
      const profile = audiencePersonProfile(person);
      if (!profile.identities.length) return { ok: true, answer: `No encontré un perfil archivado para “${person}”.`, data: { type: 'person-profile', person, ...profile } };
      return { ok: true, answer: '', data: { type: 'person-profile', person, ...profile } };
    }
    if (/palabra|tema|habla|mencion|frecuent|repetid/.test(normalized)) {
      const result = audienceFrequentTerms(12);
      if (!result.words.length) return { ok: true, answer: 'Todavía no hay suficientes comentarios archivados para encontrar palabras frecuentes.', data: { type: 'frequent-terms', ...result } };
      return { ok: true, answer: `Las palabras más repetidas en ${result.comments} comentarios son: ${result.words.map(item => `${item.word} (${item.mentions})`).join(', ')}. Es un recuento literal de palabras; todavía no agrupa sinónimos ni interpreta temas.`, data: { type: 'frequent-terms', ...result } };
    }
    if (/dia|fecha|program/.test(normalized) && /mas|mayor|actividad|movido/.test(normalized)) {
      const rows = audienceBusiestDays(10);
      return { ok: true, answer: rows.length ? `Las fechas con más comentarios son: ${rows.map(row => `${row.program_date} (${row.comments} comentarios, ${row.people} personas)`).join('; ')}.` : 'Todavía no hay fechas archivadas.', data: { type: 'busiest-days', rows } };
    }
    if (/dia|fecha|program|estuvo|asist|participo|vino/.test(normalized)) {
      const person = cleanQuestion.replace(/^(?:y\s*)?(?:decime|dime|indica|muestra|quiero saber|sabes|sabe|cu[aá]ndo|qu[eé] d[ií]as|en qu[eé] d[ií]as|cu[aá]les d[ií]as|cu[aá]les fueron los d[ií]as|qu[eé] programas|en qu[eé] programas)\s*/i, '')
        .replace(/\b(?:estuvo|participo|participó|vino|comento|comentó|con nosotros|en total|en el vivo|en los programas|los dias|los días|los programas|de la audiencia)\b/gi, ' ')
        .replace(/[¿?¡!.,:;]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!person || /^(?:dias|fechas|programas|alguien|una persona)$/i.test(person)) return { ok: false, answer: 'Indica el nombre visible, por ejemplo: “¿Qué días estuvo Ana con nosotros?”.' };
      const rows = audienceDaysForPerson(person);
      if (!rows.length) return { ok: true, answer: `No encontré comentarios archivados con el nombre “${person}”. Si esa persona usa otro nombre o plataforma, puede figurar por separado.`, data: { type: 'person-days', person, rows } };
      const dates = rows.map(row => `${row.program_date} (${row.comments} comentario${row.comments === 1 ? '' : 's'})`);
      return { ok: true, answer: `${person} aparece en ${rows.length} fechas de programa: ${dates.join(', ')}.`, data: { type: 'person-days', person, rows } };
    }
    const summary = audienceSummary();
    const top = audienceTopCommenters({ limit: 10 });
    const regular = audienceMostRegular(10);
    const busiestDays = audienceBusiestDays(10);
    const terms = audienceFrequentTerms(15);
    const returning = audienceReturningMembers(10);
    const highlights = summary?.last_program ? audienceHighlights(summary.last_program, 5) : [];
    if (!summary?.comments) return { ok: true, answer: 'Todavía no hay suficiente historial archivado para responder esa pregunta.', data: { type: 'open', summary, top, regular, busiestDays, terms, highlights, returning } };
    return { ok: true, answer: '', data: { type: 'open', summary, top, regular, busiestDays, terms, highlights, returning } };
  }

  function recordInteraction(entry) {
    const data = entry || {};
    const ts = Number(data.timestamp) || Date.now();
    try {
      insertInteraction.run(
        ts,
        new Date(ts).toISOString(),
        session,
        texto(data.source, 20) || 'chat',
        texto(data.platform, 20),
        texto(data.requester, 80),
        texto(data.requesterId, 80),
        texto(data.comment, 500),
        aBool(data.isRequest),
        texto(data.parsedSource, 20),
        texto(data.artist, 120),
        texto(data.title, 120),
        texto(data.genre, 40),
        texto(data.query, 200),
        texto(data.status, 30) || (data.ok === true ? 'played' : 'error'),
        texto(data.reason || data.message, 300),
        aBool(data.aiInterpreted),
        texto(data.aiModel, 80),
        texto(data.aiFallbackReason, 300),
        texto(data.replyText, 400),
        texto(data.replyContext, 30),
        texto(data.replyVariant, 300),
        aEntero(data.replyRandom),
        aBool(data.replyAi),
        texto(data.replySource, 30),
        texto(data.replyModel, 80),
        texto(data.replyFallbackReason, 300),
        texto(data.trackName, 200),
        texto(data.trackArtist, 200),
        texto(data.trackUri, 120),
        texto(data.trackSource, 20),
        aEntero(data.seconds),
        aEntero(data.durationMs),
        aEntero(data.sincePlayMs),
        0,
        0
      );
      // Si lo que se guarda es un salto o una pausa, se marca el pedido de ese
      // mismo tema (el ultimo de los ultimos 5 minutos): asi se sabe si gusto.
      if (data.trackName && (data.status === 'skipped' || data.status === 'paused')) {
        try {
          db.prepare(
            "UPDATE interactions SET skipped_after = 1 WHERE id = (SELECT id FROM interactions WHERE LOWER(track_name) = LOWER(?) AND status = 'played' AND ts >= ? ORDER BY ts DESC LIMIT 1)"
          ).run(texto(data.trackName, 200), ts - 5 * 60 * 1000);
        } catch (error) {
          log('No se pudo marcar el salto: ' + error.message);
        }
      }
      return true;
    } catch (error) {
      log('No se pudo guardar la interaccion en la base: ' + error.message);
      return false;
    }
  }

  function pruneInteractionsBefore(cutoffTimestamp) {
    const cutoff = Number(cutoffTimestamp);
    if (!Number.isFinite(cutoff) || cutoff <= 0) return 0;
    try {
      const removed = Number(db.prepare('DELETE FROM interactions WHERE ts < ?').run(Math.floor(cutoff)).changes) || 0;
      if (removed > 0) checkpointInteractionDeletion();
      return removed;
    } catch (error) {
      log('No se pudieron eliminar las interacciones vencidas: ' + error.message);
      return null;
    }
  }

  function clearInteractions() {
    try {
      const removed = Number(db.prepare('DELETE FROM interactions').run().changes) || 0;
      if (removed > 0) checkpointInteractionDeletion();
      return removed;
    }
    catch (error) {
      log('No se pudo vaciar el historial de interacciones: ' + error.message);
      return null;
    }
  }

  function checkpointInteractionDeletion() {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    catch (error) { log('No se pudo compactar el WAL tras borrar interacciones: ' + error.message); }
  }

  function recordEvent(type, detail, aiModel) {
    const ts = Date.now();
    try {
      insertEvent.run(
        ts,
        new Date(ts).toISOString(),
        session,
        texto(type, 40),
        texto(typeof detail === 'string' ? detail : JSON.stringify(detail || {}), 600),
        texto(aiModel, 80)
      );
      return true;
    } catch (error) {
      log('No se pudo guardar el evento en la base: ' + error.message);
      return false;
    }
  }

  function recordRouletteTicketAdjustment(data) {
    const adjustmentId = texto(data?.adjustmentId, 100);
    const awardId = texto(data?.awardId, 180);
    const spinId = texto(data?.spinId, 100);
    const prizeId = texto(data?.prizeId, 80);
    const lotteryId = texto(data?.lotteryId, 128);
    if (!adjustmentId || !awardId || !spinId || !prizeId || !lotteryId) return false;
    try {
      db.prepare(`INSERT OR IGNORE INTO rulo_roulette_ticket_adjustments (
        adjustment_id, award_id, spin_id, prize_id, lottery_id, lottery_name, winner_name,
        previous_extra_tickets, current_extra_tickets, delta, assigned_ticket_count,
        base_limit, effective_limit, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          adjustmentId,
          awardId,
          spinId,
          prizeId,
          lotteryId,
          texto(data.lotteryName, 150),
          texto(data.winnerName, 120),
          Math.max(0, Number(data.previousExtraTickets) || 0),
          Math.max(0, Number(data.currentExtraTickets) || 0),
          Number(data.delta) || 0,
          Math.max(0, Number(data.assignedTicketCount) || 0),
          Math.max(1, Number(data.baseLimit) || 1),
          Math.max(1, Number(data.effectiveLimit) || 1),
          Math.max(0, Number(data.timestamp) || Date.now())
        );
      return Boolean(db.prepare('SELECT adjustment_id FROM rulo_roulette_ticket_adjustments WHERE adjustment_id = ?').get(adjustmentId));
    } catch (error) {
      log('No se pudo registrar el ajuste de tickets de la Ruleta en SQLite: ' + error.message);
      return false;
    }
  }

  function rouletteTicketAdjustments(options2 = {}) {
    const limit = Math.max(1, Math.min(100, Number(options2.limit) || 25));
    try {
      return db.prepare('SELECT * FROM rulo_roulette_ticket_adjustments ORDER BY created_at DESC LIMIT ?').all(limit);
    } catch (error) {
      log('No se pudieron leer los ajustes de tickets de la Ruleta: ' + error.message);
      return [];
    }
  }

  function desde(dias) {
    const cantidad = Math.max(1, Math.min(3650, Number(dias) || 7));
    return Date.now() - cantidad * 24 * 60 * 60 * 1000;
  }

  // Resumen para el dashboard: lo que sirve para buscar mejoras.
  function stats(dias) {
    const from = desde(dias);
    const uno = (sql, ...params) => {
      try {
        const row = db.prepare(sql).get(...params);
        return row || {};
      } catch (error) {
        log('Consulta de analisis fallida: ' + error.message);
        return {};
      }
    };
    const varios = (sql, ...params) => {
      try {
        return db.prepare(sql).all(...params);
      } catch (error) {
        log('Consulta de analisis fallida: ' + error.message);
        return [];
      }
    };

    const total = uno('SELECT COUNT(*) AS n FROM interactions WHERE ts >= ?', from).n || 0;
    const porEstado = varios(
      'SELECT status, COUNT(*) AS n FROM interactions WHERE ts >= ? GROUP BY status ORDER BY n DESC',
      from
    );
    return {
      enabled: true,
      filePath,
      dias: Math.max(1, Math.min(3650, Number(dias) || 7)),
      total,
      pedidos: uno('SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND is_request = 1', from).n || 0,
      reproducidas: uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND status = 'played'", from).n || 0,
      noEncontradas: uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND status = 'notfound'", from).n || 0,
      rechazadas: uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND status IN ('wait_user','wait_global','busy')", from).n || 0,
      conIaInterpretando: uno('SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND ai_interpreted = 1', from).n || 0,
      conIaRespondiendo: uno('SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND reply_ai = 1', from).n || 0,
      conIaCualquiera: uno('SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND (ai_interpreted = 1 OR reply_ai = 1)', from).n || 0,
      porEstado,
      porFuente: varios('SELECT source, COUNT(*) AS n FROM interactions WHERE ts >= ? GROUP BY source ORDER BY n DESC', from),
      porPlataforma: varios("SELECT platform, COUNT(*) AS n FROM interactions WHERE ts >= ? AND platform <> '' GROUP BY platform ORDER BY n DESC LIMIT 8", from),
      porHora: varios("SELECT CAST(strftime('%H', iso) AS INTEGER) AS hora, COUNT(*) AS n FROM interactions WHERE ts >= ? GROUP BY hora ORDER BY hora", from),
      topArtistas: varios("SELECT artist, COUNT(*) AS n FROM interactions WHERE ts >= ? AND artist <> '' GROUP BY LOWER(artist) ORDER BY n DESC LIMIT 8", from),
      topTemas: varios("SELECT track_name, track_artist, COUNT(*) AS n FROM interactions WHERE ts >= ? AND track_name <> '' GROUP BY LOWER(track_name) ORDER BY n DESC LIMIT 8", from),
      // Lo mas util para entrenar: que pidieron y no se encontro.
      noEncontradasDetalle: varios(
        "SELECT comment, query, requester, iso FROM interactions WHERE ts >= ? AND status = 'notfound' ORDER BY ts DESC LIMIT 20",
        from
      ),
      topPedidosRepetidos: varios(
        "SELECT comment, COUNT(*) AS n FROM interactions WHERE ts >= ? AND comment <> '' GROUP BY LOWER(comment) HAVING n > 1 ORDER BY n DESC LIMIT 8",
        from
      ),
      eventos: varios('SELECT type, COUNT(*) AS n FROM events WHERE ts >= ? GROUP BY type ORDER BY n DESC', from),
      // Las canciones que puso Rulo: cuantas veces sonaron y cuantas se saltaron.
      topCanciones: varios(
        `SELECT track_name, track_artist,
                COUNT(*) AS veces,
                SUM(CASE WHEN status = 'played' THEN 1 ELSE 0 END) AS puestas,
                SUM(CASE WHEN status = 'continuation' THEN 1 ELSE 0 END) AS continuaciones,
                SUM(CASE WHEN track_name <> '' THEN skipped_after ELSE 0 END) AS saltadas
         FROM interactions
         WHERE ts >= ? AND track_name <> ''
         GROUP BY LOWER(track_name)
         ORDER BY puestas DESC, veces DESC
         LIMIT 12`,
        from
      ),
      // Lo que Rulo puso solo (continuacion) vs lo que pidio la gente.
      porOrigenTema: varios(
        "SELECT COALESCE(NULLIF(track_source, ''), 'pedido') AS origen, COUNT(*) AS n FROM interactions WHERE ts >= ? AND track_name <> '' GROUP BY origen ORDER BY n DESC",
        from
      ),
      // Que tan bien les cae: de lo que sono, cuanto se salto o se pauso enseguida.
      saltadas: varios(
        "SELECT track_name, track_artist, status, seconds, since_play_ms, iso FROM interactions WHERE ts >= ? AND status IN ('skipped','paused') AND track_name <> '' ORDER BY ts DESC LIMIT 15",
        from
      ),
      tasaSalteo: (() => {
        const puestas = uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND status = 'played' AND track_name <> ''", from).n || 0;
        const saltadas = uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND skipped_after = 1 AND status = 'played'", from).n || 0;
        return { puestas, saltadas, porcentaje: puestas ? Math.round((saltadas / puestas) * 100) : 0 };
      })(),
      // Que respuestas funcionan: usadas y cuantas veces se salto el tema despues.
      respuestas: varios(
        `SELECT reply_context AS contexto, reply_variant AS variante, reply_ai AS de_ia,
                COUNT(*) AS veces,
                SUM(skipped_after) AS saltadas
         FROM interactions
         WHERE ts >= ? AND reply_variant <> ''
         GROUP BY reply_variant
         ORDER BY veces DESC
         LIMIT 12`,
        from
      ),
      // Recordatorio: lo que todavia no se miro en el panel de analisis.
      recordatorio: (() => {
        const pendientes = uno('SELECT COUNT(*) AS n FROM interactions WHERE reviewed = 0').n || 0;
        const nuevosNoEncontrados = uno("SELECT COUNT(*) AS n FROM interactions WHERE reviewed = 0 AND status = 'notfound'").n || 0;
        const ultimaRevision = uno('SELECT MAX(ts) AS ts FROM interactions WHERE reviewed = 1').ts || null;
        const primeraPendiente = uno('SELECT MIN(ts) AS ts FROM interactions WHERE reviewed = 0').ts || null;
        const dias = primeraPendiente ? Math.floor((Date.now() - primeraPendiente) / 86400000) : 0;
        return { pendientes, nuevosNoEncontrados, ultimaRevision, diasEsperando: dias };
      })(),
      ultimaActividad: uno('SELECT MAX(ts) AS ts FROM interactions').ts || null
    };
  }

  // Avisos: lo que conviene mirar. Cada uno trae nivel, codigo y mensaje.
  function avisos(dias) {
    const from = desde(dias);
    const uno = (sql, ...params) => {
      try { return db.prepare(sql).get(...params) || {}; } catch (error) { return {}; }
    };
    const varios = (sql, ...params) => {
      try { return db.prepare(sql).all(...params); } catch (error) { return []; }
    };
    const lista = [];
    const pedidos = uno('SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND is_request = 1', from).n || 0;
    const noEncontradas = uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND status = 'notfound'", from).n || 0;
    const tasa = pedidos ? Math.round((noEncontradas / pedidos) * 100) : 0;

    if (pedidos >= 5 && tasa >= 25) {
      lista.push({
        nivel: 'warn',
        codigo: 'tasa_no_encontradas',
        mensaje: `No se encontró el ${tasa}% de los pedidos (${noEncontradas} de ${pedidos}). Mira la lista de abajo y agrega correcciones.`
      });
    }
    varios(
      `SELECT comment, COUNT(*) AS n FROM interactions
       WHERE ts >= ? AND status = 'notfound' AND comment <> '' GROUP BY LOWER(comment) HAVING n >= 3 ORDER BY n DESC LIMIT 5`,
      from
    ).forEach(fila => lista.push({
      nivel: 'warn',
      codigo: 'pedido_repetido',
      mensaje: `"${fila.comment}" no se encontró ${fila.n} veces: cargalo como corrección o sumá la palabra.`
    }));

    const sinRevisar = uno('SELECT COUNT(*) AS n FROM interactions WHERE reviewed = 0').n || 0;
    if (sinRevisar >= 10) {
      lista.push({ nivel: 'info', codigo: 'sin_revisar', mensaje: `Hay ${sinRevisar} interacciones nuevas para mirar en el análisis.` });
    }
    const apagado = uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND status = 'notfound' AND ai_interpreted = 0", from).n || 0;
    if (tasa >= 15 && apagado >= 5) {
      lista.push({ nivel: 'info', codigo: 'ia_apagada', mensaje: `Hay ${apagado} pedidos que no se entendieron sin la IA: probá activar el cerebro.` });
    }
    const saltadas = uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND skipped_after = 1", from).n || 0;
    const puestas = uno("SELECT COUNT(*) AS n FROM interactions WHERE ts >= ? AND status = 'played' AND track_name <> ''", from).n || 0;
    if (puestas >= 8 && saltadas / puestas >= 0.35) {
      lista.push({
        nivel: 'info',
        codigo: 'se_salta_mucho',
        mensaje: `Se saltó el ${Math.round((saltadas / puestas) * 100)}% de los temas puestos (${saltadas} de ${puestas}): mira qué canciones conviene evitar.`
      });
    }
    return lista;
  }

  // Marca como revisado lo que ya se miro en el panel.
  function markReviewed() {
    try {
      const resultado = db.prepare('UPDATE interactions SET reviewed = 1 WHERE reviewed = 0').run();
      return Number(resultado.changes || 0);
    } catch (error) {
      log('No se pudo marcar como revisado: ' + error.message);
      return 0;
    }
  }

  function rows(options2) {
    const opts = options2 || {};
    const from = desde(opts.dias);
    const limite = Math.max(1, Math.min(2000, Number(opts.limite) || 100));
    try {
      if (opts.estado) {
        return db.prepare('SELECT * FROM interactions WHERE ts >= ? AND status = ? ORDER BY ts DESC LIMIT ?')
          .all(from, texto(opts.estado, 30), limite);
      }
      return db.prepare('SELECT * FROM interactions WHERE ts >= ? ORDER BY ts DESC LIMIT ?').all(from, limite);
    } catch (error) {
      log('No se pudieron leer las filas de analisis: ' + error.message);
      return [];
    }
  }

  function learningInbox(options2) {
    const opts = options2 || {};
    const from = desde(opts.dias || 90);
    const limite = Math.max(1, Math.min(500, Number(opts.limite) || 100));
    try {
      return db.prepare(`SELECT id, ts, iso, requester, comment, query, status, reason,
        parsed_source, ai_interpreted, ai_model, ai_fallback_reason, reply_source, reply_fallback_reason
        FROM interactions WHERE ts >= ? AND is_request = 1 AND reviewed = 0
          AND status IN ('notfound', 'not_understood') ORDER BY ts DESC LIMIT ?`).all(from, limite);
    } catch (error) {
      log('No se pudo cargar la bandeja de pedidos para revisar: ' + error.message);
      return [];
    }
  }

  function markLearningReviewed(ids) {
    const cleanIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 200);
    if (!cleanIds.length) return 0;
    try {
      const result = db.prepare(`UPDATE interactions SET reviewed = 1 WHERE reviewed = 0 AND id IN (${cleanIds.map(() => '?').join(',')})`).run(...cleanIds);
      return Number(result.changes || 0);
    } catch (error) {
      log('No se pudieron marcar los pedidos revisados: ' + error.message);
      return 0;
    }
  }

  function csv(dias) {
    const from = desde(dias);
    let filas = [];
    try {
      filas = db.prepare('SELECT * FROM interactions WHERE ts >= ? ORDER BY ts').all(from);
    } catch (error) {
      log('No se pudo exportar el CSV: ' + error.message);
      return '';
    }
    const escapar = value => {
      const texto2 = value === undefined || value === null ? '' : String(value);
      return '"' + texto2.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
    };
    const lineas = [CAMPOS.join(',')];
    filas.forEach(fila => lineas.push(CAMPOS.map(campo => escapar(fila[campo])).join(',')));
    return lineas.join('\r\n') + '\r\n';
  }

  function audienceCsv(dias) {
    const from = desde(dias);
    try {
      const filas = db.prepare(`SELECT ts, program_date, platform, source, capture_account, stream_id,
        requester, user_id, facebook_user_id, comment, response, event, is_alert, message_id
        FROM audience_comments_unique WHERE ts >= ? ORDER BY ts ASC LIMIT 1000000`).all(from);
      const columnas = ['ts', 'program_date', 'platform', 'source', 'capture_account', 'stream_id',
        'requester', 'user_id', 'facebook_user_id', 'comment', 'response', 'event', 'is_alert', 'message_id'];
      const escapar = value => {
        let text = value === undefined || value === null ? '' : String(value);
        if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
      };
      return [columnas.join(','), ...filas.map(row => columnas.map(column => escapar(row[column])).join(','))].join('\r\n') + '\r\n';
    } catch (error) {
      log('No se pudo exportar el archivo de audiencia: ' + error.message);
      return '';
    }
  }

  function backupTo(destination) {
    try {
      const target = path.resolve(String(destination || ''));
      if (!target || target === path.parse(target).root || fs.existsSync(target)) return false;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      return fs.existsSync(target);
    } catch (error) {
      log('No se pudo crear la copia consistente de SQLite: ' + error.message);
      return false;
    }
  }

  return {
    enabled: true,
    filePath,
    recordInteraction,
    pruneInteractionsBefore,
    clearInteractions,
    recordAudienceComment,
    updateAudienceAvatar,
    importLegacyAudienceComments,
    audiencePrograms,
    audienceCommentsForProgram,
    audienceMemorySubjects,
    audienceMemoryHistory,
    audienceMemorySubjectKey,
    ruloBehaviorRules,
    saveRuloBehaviorRule,
    deleteRuloBehaviorRule,
    simulationCases,
    saveSimulationCase,
    deleteSimulationCase,
    simulationCaseRuns,
    recordSimulationRun,
    reviewSimulationRun,
    lotteryProgramSnapshot,
    saveLotteryProgramSnapshot,
    recordRouletteTicketAdjustment,
    rouletteTicketAdjustments,
    assignUnassignedAudienceCommentsToProgram,
    updateAudienceResponse,
    audienceComments,
    databaseTables,
    databaseTableRows,
    databaseSearch,
    audienceIdentityQuery,
    audienceTopCommenters,
    audienceDaysForPerson,
    audienceAttendanceForRequesterKey,
    audienceSummary,
    audienceIdentityStats,
    audienceMostRegular,
    audienceBusiestDays,
    audienceFrequentTerms,
    audienceProgramSummary,
    audienceHighlights,
    audiencePersonProfile,
    audienceReturningMembers,
    claimAudienceGreeting,
    audienceQuestion,
    recordEvent,
    stats,
    avisos,
    markReviewed,
    rows,
    learningInbox,
    markLearningReviewed,
    csv,
    audienceCsv,
    backupTo,
    close() { try { db.close(); } catch (error) { /* nada */ } }
  };
}

module.exports = { createAnalytics, CAMPOS, textoPlanoComentario };
