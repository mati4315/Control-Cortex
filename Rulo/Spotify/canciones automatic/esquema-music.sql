-- ============================================================================
--  Esquema de la biblioteca musical de Rulo + letras + historial + trabajos
-- ============================================================================
--  Va en la MISMA base que ya usa el proyecto (una sola SQLite, una sola
--  conexión, un solo backup): Rulo\Spotify\spotify-analytics.db
--  (cuando se la renombre a rulo-musica.db, esto no cambia).
--
--  Aplicar con:  node "Rulo/Spotify/canciones automatic/aplicar-esquema.js"
--  Es idempotente: se puede correr las veces que haga falta.
--
--  Decisiones de optimización (y por qué):
--   * Una fila por canción en `lyrics` con las líneas normalizadas en JSON.
--     Un solo SELECT por canción en vez de N filas por línea; SQLite lee la
--     fila completa de una. No necesitamos consultar líneas sueltas por SQL.
--   * `tracks.file_size` + `tracks.file_mtime` = detector de cambios barato:
--     el scanner compara tamaño/fecha y sólo hashea cuando algo cambió.
--   * `lyrics_status` en tracks evita volver a preguntar a LRCLIB por las
--     canciones que ya sabemos que NO tienen letra.
--   * Índices parciales para el ciclo diario y para no duplicar trabajos.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- biblioteca
CREATE TABLE IF NOT EXISTS tracks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  spotify_track_id TEXT UNIQUE,                 -- NULL si todavía no se identificó
  title           TEXT NOT NULL,
  artist          TEXT NOT NULL DEFAULT '',
  album           TEXT NOT NULL DEFAULT '',
  duration_ms     INTEGER,
  offline         INTEGER NOT NULL DEFAULT 0,   -- 1 = hay archivo local usable
  enabled         INTEGER NOT NULL DEFAULT 1,   -- 0 = no elegir en automático
  local_path      TEXT UNIQUE,                  -- ruta absoluta del archivo
  file_size       INTEGER,                      -- detector de cambios (sin hashear)
  file_mtime      INTEGER,
  file_hash       TEXT,                         -- sólo se calcula si cambió el archivo
  start_at        REAL,                         -- segundos, inicio lógico
  end_at          REAL,                         -- segundos, fin lógico
  skip_seconds    REAL,                         -- compatibilidad con lo actual
  analysis_status TEXT NOT NULL DEFAULT 'pending',   -- pending|processing|completed|failed|manual_review|manual
  detalle_analisis TEXT,                        -- JSON crudo de ffmpeg (para reajustar sin reanalizar)
  lyrics_status   TEXT NOT NULL DEFAULT 'pending',   -- pending|ok|none
  lyrics_checked_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracks_offline   ON tracks(offline, enabled);
CREATE INDEX IF NOT EXISTS idx_tracks_estado    ON tracks(analysis_status);
CREATE INDEX IF NOT EXISTS idx_tracks_nombre    ON tracks(artist, title);
CREATE INDEX IF NOT EXISTS idx_tracks_letras    ON tracks(lyrics_status);

-- ------------------------------------------------------------------- letras
-- Una fila por canción. `lines_json` = [{startMs,endMs,text}, ...]
CREATE TABLE IF NOT EXISTS lyrics (
  track_id     INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,                   -- lrclib | spotify_local | manual
  language     TEXT,
  synced       INTEGER NOT NULL DEFAULT 0,      -- 1 = tiene tiempos por línea
  instrumental INTEGER NOT NULL DEFAULT 0,
  provider     TEXT,                            -- Musixmatch, LRCLIB, ...
  duration_ms  INTEGER,                         -- duración con la que se obtuvo (valida el match)
  lines_json   TEXT NOT NULL DEFAULT '[]',
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------- reproducciones
CREATE TABLE IF NOT EXISTS play_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_date TEXT NOT NULL,                    -- YYYY-MM-DD, fecha lógica del bot
  played_at   TEXT NOT NULL DEFAULT (datetime('now')),
  play_mode   TEXT NOT NULL DEFAULT 'auto',     -- auto | manual
  cycle       INTEGER NOT NULL DEFAULT 1,       -- vuelta del modo automático (ver más abajo)
  play_source TEXT,                             -- local | spotify
  start_at    REAL,                             -- lo que realmente se aplicó
  end_at      REAL
);

CREATE INDEX IF NOT EXISTS idx_play_fecha ON play_history(played_date);
CREATE INDEX IF NOT EXISTS idx_play_track ON play_history(track_id, played_date);
-- La regla "en automático no se repite" la garantiza la base, POR CICLO:
--   ciclo 1 = primera vuelta del día; si se agota el catálogo arranca el ciclo 2
--   (así el bot nunca se queda sin música, pero tampoco repite dentro de la vuelta).
-- El índice es parcial: las solicitudes manuales pueden repetir cuanto quieran.
DROP INDEX IF EXISTS idx_play_auto_dia;
CREATE UNIQUE INDEX IF NOT EXISTS idx_play_auto_ciclo
  ON play_history(track_id, played_date, cycle) WHERE play_mode = 'auto';

-- ------------------------------------------------------------------ trabajos
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id      INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'offset',  -- offset | scan | lyrics
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|processing|completed|failed|manual_review
  attempts      INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_estado ON analysis_jobs(status, id);
-- Un solo trabajo pendiente por canción y tipo: nada de colas duplicadas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_pendiente
  ON analysis_jobs(track_id, kind) WHERE status IN ('pending', 'processing');

-- ------------------------------------------------------------- automatismos
CREATE TRIGGER IF NOT EXISTS trg_tracks_updated
AFTER UPDATE ON tracks FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE tracks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_lyrics_updated
AFTER UPDATE ON lyrics FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE lyrics SET updated_at = datetime('now') WHERE track_id = NEW.track_id;
END;

-- --------------------------------------------------------------- vistas útiles
-- Candidatas para el modo automático de hoy (para el dashboard y diagnósticos;
-- el bot elige desde su set en RAM, no consultando esto en cada tema).
DROP VIEW IF EXISTS v_candidatos_auto;
CREATE VIEW v_candidatos_auto AS
SELECT t.id, t.spotify_track_id, t.title, t.artist, t.duration_ms,
       t.start_at, t.end_at, t.local_path
FROM tracks t
WHERE t.offline = 1
  AND t.enabled = 1
  AND NOT EXISTS (
    SELECT 1 FROM play_history p
    WHERE p.track_id = t.id
      AND p.played_date = date('now', 'localtime')
      AND p.play_mode = 'auto'
  );

DROP VIEW IF EXISTS v_biblioteca_resumen;
CREATE VIEW v_biblioteca_resumen AS
SELECT
  (SELECT COUNT(*) FROM tracks)                                   AS tracks,
  (SELECT COUNT(*) FROM tracks WHERE offline = 1)                  AS offline,
  (SELECT COUNT(*) FROM tracks WHERE enabled = 1 AND offline = 1)   AS disponibles,
  (SELECT COUNT(*) FROM tracks WHERE spotify_track_id IS NULL)      AS sin_spotify_id,
  (SELECT COUNT(*) FROM tracks WHERE analysis_status = 'pending')   AS sin_analizar,
  (SELECT COUNT(*) FROM tracks WHERE lyrics_status = 'none')        AS sin_letras,
  (SELECT COUNT(*) FROM lyrics)                                     AS con_letras,
  (SELECT COUNT(*) FROM play_history WHERE played_date = date('now','localtime')) AS reproducidas_hoy,
  (SELECT COUNT(*) FROM (SELECT 1 FROM v_candidatos_auto))          AS candidatas_hoy;
