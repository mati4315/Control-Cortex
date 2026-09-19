'use strict';
// Historial de interacciones en SQLite (Rulo/Spotify/spotify-analytics.db).
//
// Guarda TODO lo que pasa con los pedidos para poder analizarlo despues:
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
  reply_text TEXT,
  reply_context TEXT,
  reply_variant TEXT,
  reply_random INTEGER,
  reply_ai INTEGER DEFAULT 0,
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
`;

const CAMPOS = [
  'ts', 'iso', 'session', 'source', 'platform', 'requester', 'requester_id', 'comment',
  'is_request', 'parsed_source', 'artist', 'title', 'genre', 'query', 'status', 'reason',
  'ai_interpreted', 'ai_model', 'reply_text', 'reply_context', 'reply_variant', 'reply_random',
  'reply_ai', 'track_name', 'track_artist', 'track_uri', 'track_source', 'seconds', 'duration_ms',
  'since_play_ms', 'skipped_after', 'reviewed'
];

// Columnas que se agregaron despues: si la base ya existia, se suman solas.
const COLUMNAS_NUEVAS = [
  ['track_source', 'TEXT'],
  ['since_play_ms', 'INTEGER'],
  ['skipped_after', 'INTEGER DEFAULT 0'],
  ['reviewed', 'INTEGER DEFAULT 0']
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
      recordEvent: () => false,
      stats: () => null,
      avisos: () => [],
      markReviewed: () => 0,
      rows: () => [],
      csv: () => '',
      close: () => {}
    };
  }

  let db = null;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    db = new DatabaseSync(filePath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA);
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
      recordEvent: () => false,
      stats: () => null,
      avisos: () => [],
      markReviewed: () => 0,
      rows: () => [],
      csv: () => '',
      close: () => {}
    };
  }

  const insertInteraction = db.prepare(
    'INSERT INTO interactions (' + CAMPOS.join(', ') + ') VALUES (' + CAMPOS.map(() => '?').join(', ') + ')'
  );
  const insertEvent = db.prepare('INSERT INTO events (ts, iso, session, type, detail, ai_model) VALUES (?, ?, ?, ?, ?, ?)');

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
        texto(data.replyText, 400),
        texto(data.replyContext, 30),
        texto(data.replyVariant, 300),
        aEntero(data.replyRandom),
        aBool(data.replyAi),
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

  return {
    enabled: true,
    filePath,
    recordInteraction,
    recordEvent,
    stats,
    avisos,
    markReviewed,
    rows,
    csv,
    close() { try { db.close(); } catch (error) { /* nada */ } }
  };
}

module.exports = { createAnalytics, CAMPOS };
