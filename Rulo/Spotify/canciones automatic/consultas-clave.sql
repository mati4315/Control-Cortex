-- ============================================================================
--  Consultas clave de la biblioteca musical (todas con su índice)
-- ============================================================================
--  Estas son las consultas que van a usar el bot, el scanner y el dashboard.
--  Están pensadas para NO recorrer la tabla completa: con 3.000 canciones
--  igual funcionarían, pero así el costo se mantiene igual con 30.000.
--
--  Verificación: node "Rulo/Spotify/canciones automatic/probar-esquema.js"
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) ARRANQUE DEL BOT: qué se reprodujo hoy (se carga una vez en RAM)
--    Índice: idx_play_fecha
-- ---------------------------------------------------------------------------
SELECT track_id, play_mode, played_at
FROM play_history
WHERE played_date = ?;                    -- 'YYYY-MM-DD' (fecha lógica del bot)


-- ---------------------------------------------------------------------------
-- 2) QUÉ FALTA REPRODUCIR HOY (para el dashboard; el bot usa su set en RAM)
--    Usa la vista v_candidatos_auto (índice idx_play_auto_dia + idx_tracks_offline)
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS candidatas FROM v_candidatos_auto;

-- Elegir una al azar (sólo para pruebas/diagnóstico: en el bot se elige en JS
-- desde el array en RAM, sin tocar la base)
SELECT id, title, artist, start_at, end_at
FROM v_candidatos_auto
ORDER BY RANDOM()
LIMIT 1;


-- ---------------------------------------------------------------------------
-- 3) LETRAS: leer la de una canción (1 sola fila, 1 solo acceso a disco)
--    Índice: PRIMARY KEY de lyrics (track_id)
-- ---------------------------------------------------------------------------
SELECT l.source, l.language, l.synced, l.instrumental, l.provider, l.lines_json
FROM lyrics l
WHERE l.track_id = ?;

-- ¿Hace falta resolverla? (evita preguntar a LRCLIB por lo que ya sabemos que no tiene)
SELECT t.id, t.title, t.artist, t.album, t.duration_ms, t.lyrics_status
FROM tracks t
WHERE t.spotify_track_id = ?
  AND t.lyrics_status <> 'ok';


-- ---------------------------------------------------------------------------
-- 4) LETRAS: guardar / actualizar (upsert, sin leer antes)
-- ---------------------------------------------------------------------------
INSERT INTO lyrics (track_id, source, language, synced, instrumental, provider, duration_ms, lines_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(track_id) DO UPDATE SET
  source      = excluded.source,
  language    = excluded.language,
  synced      = excluded.synced,
  instrumental= excluded.instrumental,
  provider    = excluded.provider,
  duration_ms = excluded.duration_ms,
  lines_json  = excluded.lines_json,
  fetched_at  = datetime('now');

UPDATE tracks SET lyrics_status = 'ok', lyrics_checked_at = datetime('now') WHERE id = ?;

-- Sin letra en ninguna fuente: se anota para no volver a preguntar
UPDATE tracks SET lyrics_status = 'none', lyrics_checked_at = datetime('now') WHERE id = ?;


-- ---------------------------------------------------------------------------
-- 5) SCANNER: detectar cambios sin hashear todo
--    Índice: idx_tracks_nombre (o UNIQUE local_path)
-- ---------------------------------------------------------------------------
SELECT id, file_size, file_mtime, file_hash, start_at, end_at, analysis_status
FROM tracks
WHERE local_path = ?;

-- Candidatas al análisis de inicio/final: locales, habilitadas y sin analizar
SELECT id, local_path, duration_ms
FROM tracks
WHERE offline = 1 AND analysis_status = 'pending'
ORDER BY id
LIMIT ?;                                   -- de a lotes, no todo junto


-- ---------------------------------------------------------------------------
-- 6) TRABAJOS: encolar de a uno por canción y tipo (el índice parcial lo garantiza)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO analysis_jobs (track_id, kind, status) VALUES (?, 'offset', 'pending');

-- Tomar el próximo trabajo (el UPDATE condicional evita que dos procesos tomen el mismo)
UPDATE analysis_jobs
SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1
WHERE id = (
  SELECT id FROM analysis_jobs WHERE status = 'pending' ORDER BY id LIMIT 1
)
AND status = 'pending';

SELECT id, track_id, kind, attempts
FROM analysis_jobs
WHERE status = 'processing' AND started_at = (SELECT MAX(started_at) FROM analysis_jobs);

-- Cerrar el trabajo
UPDATE analysis_jobs SET status = 'completed', finished_at = datetime('now'), error_message = NULL WHERE id = ?;
UPDATE analysis_jobs SET status = 'failed',    finished_at = datetime('now'), error_message = ?    WHERE id = ?;
-- Más de 3 intentos: a revisión manual
UPDATE analysis_jobs SET status = 'manual_review', finished_at = datetime('now')
WHERE id = ? AND attempts >= 3;
-- Índice: idx_jobs_estado + idx_jobs_pendiente


-- ---------------------------------------------------------------------------
-- 7) REPRODUCCIÓN: registrar
-- ---------------------------------------------------------------------------
-- Automático: si ya sonó hoy, la base lo rechaza sin romper nada (regla del sistema)
INSERT OR IGNORE INTO play_history (track_id, played_date, play_mode, play_source, start_at, end_at)
VALUES (?, ?, 'auto', ?, ?, ?);

-- Manual: puede repetir cuantas veces quiera
INSERT INTO play_history (track_id, played_date, play_mode, play_source, start_at, end_at)
VALUES (?, ?, 'manual', ?, ?, ?);

-- Índices: idx_play_fecha, idx_play_track, idx_play_auto_dia (único parcial)


-- ---------------------------------------------------------------------------
-- 8) DASHBOARD: un solo SELECT para todo el resumen
-- ---------------------------------------------------------------------------
SELECT * FROM v_biblioteca_resumen;

-- Letras por origen
SELECT source, COUNT(*) AS cuantas FROM lyrics GROUP BY source ORDER BY cuantas DESC;


-- ---------------------------------------------------------------------------
-- 9) DIAGNÓSTICO / MANTENIMIENTO
-- ---------------------------------------------------------------------------
-- Canciones locales duplicadas (mismo archivo en dos filas)
SELECT local_path, COUNT(*) FROM tracks WHERE local_path IS NOT NULL GROUP BY local_path HAVING COUNT(*) > 1;

-- Sin Track ID de Spotify (hay que resolverlas para usar la API)
SELECT id, title, artist FROM tracks WHERE spotify_track_id IS NULL LIMIT 50;

-- Analizadas a mano: el scanner no debe sobrescribirlas
SELECT id, title, start_at, end_at FROM tracks WHERE analysis_status = 'manual';

-- Rango de offset inválido (validación de datos, no debería haber)
SELECT id, title, start_at, end_at, duration_ms
FROM tracks
WHERE duration_ms IS NOT NULL AND (
  start_at < 0 OR start_at > 15 OR
  (end_at IS NOT NULL AND (end_at > duration_ms / 1000.0 OR end_at < duration_ms / 1000.0 - 15))
);

-- Espacio que ocupan las letras guardadas
SELECT COUNT(*) AS canciones, ROUND(SUM(LENGTH(lines_json)) / 1024.0, 1) AS kb FROM lyrics;
