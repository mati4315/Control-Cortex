# Guía maestra — Rulo + Spotify: biblioteca local, letras y análisis automático

**Adaptación de:** `guia-actualizada-rulo-spotify.md`
**Fecha:** 19 de septiembre de 2026
**Proyecto:** Rulo / Control Cortex / SocialStream Ninja / OBS / Spotify
**Raíz:** `D:\plugins para mi OBS`

Esta versión reemplaza a la guía genérica: **todo lo que dice acá fue verificado contra tu proyecto real** (rutas, archivos, versiones, pruebas), y las decisiones están tomadas en función de **no romper lo que ya funciona** y de **optimizar**.

Archivos que acompañan esta guía (ya probados):

| Archivo | Qué es |
| --- | --- |
| `esquema-music.sql` | Tablas nuevas (biblioteca, letras, historial, trabajos), listas para aplicar |
| `consultas-clave.sql` | Las consultas que van a usar el bot, el scanner y el dashboard |
| `probar-esquema.js` | Prueba el esquema sobre una base temporal: **18/18 OK** (incluye mediciones de tiempo) |

Nada de esto se aplicó todavía a tu base real: se probó sobre una copia temporal.

---

## 0. Qué cambia respecto de la guía original

| La guía decía | Tu proyecto, verificado | Decisión adaptada |
| --- | --- | --- |
| Crear `music.db` | Ya existe `Rulo\Spotify\spotify-analytics.db` (SQLite, WAL, tablas `interactions` y `events`, 502 pruebas) | **Una sola base**: las tablas nuevas van ahí. Un archivo, una conexión, un backup. (Renombrar a `rulo-musica.db` más adelante es un cambio de una línea) |
| "El overlay ya descarta estados antiguos, compensa red…" | `Control Cortex\frontend\spotify-lyrics-overlay.html` (537 líneas) **ya pide las letras a LRCLIB directo desde el overlay**, sin caché | Se mueve la consulta al backend **con caché en SQLite** y el overlay la recibe por endpoint. La lógica de sincronización por progreso real **no se toca** |
| Sub-agentes separados (spotify-flujo, lyrics-engine, music-library, audio-analysis, qa-stream) | Tu sistema es **una app Node** (`Control Cortex\backend`) + un módulo de extensión + páginas HTML + una suite de pruebas | Se traduce a **módulos, páginas y archivos de prueba** concretos (§8) |
| Comandos `!scan`, `!lyrics`, `!addskip`… | Los comandos salen del **vocabulario en JSON** (`spotify-vocabulary.json`, editable desde la página Bot) y las acciones del dashboard | Los comandos nuevos se cargan como **datos**, no como código (§9) |
| "~3.000 canciones" | Todavía no hay biblioteca: en `D:\RADIO` hay 5 audios | La carpeta de música es **configurable y puede no existir**: el scanner tiene que tolerarlo (rescan incremental, sin fallar) |
| Análisis de audio + IA | **ffmpeg 9.0.1 y ffprobe ya están instalados** | Análisis con ffmpeg, sólo en los bordes. La IA queda como último recurso |
| `start_at`/`end_at` | Hoy el sistema usa `skipEnabled` + `skipSeconds` (offset de arranque) | Se mantiene `skip_seconds` por compatibilidad y se agregan `start_at`/`end_at`; el offset actual se migra al nuevo campo |
| "no modificar audio original" | Ya es la regla | Se mantiene: sólo `start_at`/`end_at`, nunca recodificar |
| Letras locales de Spotify | Investigación cerrada (informe en `Rulo\otros\investigacion-letras-spotify.md`) | Sólo como fuente opcional, apagada por defecto, y con validación (§6.4) |

---

## 1. Estado real del proyecto (lo que hay, con nombre y apellido)

### Backend

```text
Control Cortex\backend\server.js        Express + WebSocket + todas las APIs de Spotify/Cortex
Control Cortex\backend\versions.js      SPOTIFY_MODULE_VERSION (hoy 31) — versión que espera el loader
Control Cortex\backend\ssn-patcher.js   re-aplica todo lo que Cortex necesita dentro de SSN en cada arranque
Control Cortex\backend\file-store.js    recarga en caliente los JSON (settings, vocabulary, aliases)
Control Cortex\backend\spotify-analytics.js   SQLite (node:sqlite, sin dependencias): interactions + events
Control Cortex\backend\spotify-responses.js   normalización de las respuestas del bot
```

### Integración con Spotify (corre dentro de la extensión)

```text
Control Cortex\integrations\spotify-auto-music\spotify-auto-music.js   (v31)
SocialStream Ninja\local-overrides\spotify-auto-music.js               (copia espejo, la sincroniza el backend)
```

Ya hace: interpretar pedidos naturales, alias aprendidos, variedad por artista/género (bolsa mezclada), cooldown global y por usuario, selección de dispositivo, offset (`skipEnabled`/`skipSeconds`), cola de continuación, respuestas del bot con variantes, WebSocket contra el backend, y reporte de cada interacción a SQLite.

### Páginas (servidas por el backend)

```text
http://127.0.0.1:4000/rulo-spotify.html            dashboard principal (ajustes, dispositivos, pruebas, historial, análisis)
http://127.0.0.1:4000/rulo-spotify-training.html   entrenamiento (vocabulario), estado de la instalación
http://127.0.0.1:4000/rulo-spotify-bot.html        bot / Rulo: palabras clave y respuestas por contexto
Control Cortex\frontend\spotify-lyrics-overlay.html  overlay de letras para OBS (LRCLIB + sincronización por progreso real)
```

### Datos

```text
Rulo\Spotify\spotify-settings.json     ajustes (recarga en caliente, editable desde el dashboard)
Rulo\Spotify\spotify-vocabulary.json   vocabulario + respuestas del bot (datos, no código)
Rulo\Spotify\spotify-aliases.json      correcciones aprendidas
Rulo\Spotify\spotify-request-log.json  registro de pedidos
Rulo\Spotify\spotify-analytics.db      SQLite: interactions + events (WAL). NO se sube a GitHub
```

### Pruebas y herramientas

```text
Rulo\tests\           502 pruebas (npm test): módulo, dashboard, entrenamiento, bot, respuestas, archivos, SQLite, parcheo SSN
Control Cortex\tools\ migrar-ssn.js, subir-rulo.js, recordatorio-analisis.py
Rulo\otros\           investigar-letras-spotify.js, investigacion-letras-spotify.md
```

---

## 2. Reglas de oro (no negociables)

1. **No romper lo que funciona.** La reproducción, el cooldown, el offset, la cola de continuación, las respuestas y el overlay no se tocan sin prueba real en OBS.
2. **Una sola fuente de verdad por dato:**
   - biblioteca, letras, historial y trabajos → **SQLite**;
   - ajustes, vocabulario y alias → **los JSON** (los editan tus páginas y se recargan en caliente);
   - nunca los dos para lo mismo.
3. **El audio original no se toca.** Sólo `start_at`/`end_at` en la base.
4. **Si una fuente de letras falla, el stream sigue.** Ningún error de letras frena la música.
5. **Sin secretos en código, JSON, páginas ni logs.** La clave de IA vive en `Control Cortex\backend\.env`.
6. **Nada nuevo rompe las 502 pruebas.** Cada módulo nuevo entra con sus propias pruebas.
7. **Lo generado dentro de SSN no se edita a mano.** Se cambia la fuente y se reinicia Cortex (el auto-patcher copia).

---

## 3. Arquitectura objetivo

```text
                       ┌──────────────────────────────┐
                       │           CHAT               │
                       └──────────────┬───────────────┘
                                      │
                    ┌─────────────────▼─────────────────┐
                    │  spotify-auto-music.js (extensión) │  parser · dispositivo · offset · cola
                    └───────┬───────────────────┬───────┘
                            │                   │
                 reproducción│                   │consulta de letras
                            │                   │
        ┌───────────────────▼───┐        ┌──────▼──────────────────────────┐
        │  Spotify (Web API)    │        │  backend: modulo-letras          │
        │  ya funcionando       │        │  1) SQLite   2) caché Spotify*   │
        └───────────────────────┘        │  3) LRCLIB   4) manual / nada    │
                                         └──────┬──────────────────────────┘
                                                │
                            ┌───────────────────▼───────────────────┐
                            │      spotify-analytics.db (1 base)    │
                            │  tracks · lyrics · play_history ·     │
                            │  analysis_jobs · interactions · events│
                            └───────────────────┬───────────────────┘
                                                │
        ┌───────────────────┬───────────────────┴────────┬────────────────────┐
        │                   │                            │                    │
   scanner biblioteca   análisis start/end        overlay de letras      dashboard
   (archivos locales)   (ffmpeg, bordes)          (OBS Browser Source)   (páginas Rulo)
```

`*` la caché local de Spotify queda **apagada por defecto** y sólo como optimización sin red.

**Lo que NO se toca:** el módulo `spotify-auto-music.js` en su parte de reproducción, el WebSocket de comandos, los cooldowns, la bolsa de variedad, las respuestas del bot, el patcher de SSN y la sincronización por progreso real del overlay.

---

## 4. Optimización: las decisiones y los números

Todo lo que sigue está medido en tu máquina (Node 24.19.0, `node:sqlite`, ffmpeg 9.0.1).

### 4.1 Una sola base de datos

**Medido** (con 3.000 canciones y 999 letras de prueba):

| Operación | Tiempo |
| --- | --- |
| Carga masiva de 3.000 canciones (una sola transacción) | **48 ms** |
| 500 lecturas de letra (una por canción, por clave primaria) | **2,3 ms** (0,005 ms cada una) |
| Contar candidatas de hoy (vista + índice parcial) | **1,8 ms** |
| Elegir una canción al azar | **3,2 ms** |
| Resumen completo del dashboard (un `SELECT`) | < 1 ms |

Por qué una sola base y no dos: una conexión, un WAL, un backup, una ruta que recordar, y las consultas del dashboard pueden cruzar biblioteca + historial + análisis sin `ATTACH`. Dos bases obligarían a duplicar la capa de acceso y a sincronizar dos archivos en cada respaldo.

### 4.2 Letras: caché persistente y consulta en el backend

Situación actual: **el overlay le pide las letras a LRCLIB en cada cambio de tema**, desde el Browser Source de OBS. Cada tema nuevo = una llamada a internet; si LRCLIB está lento o caído, la letra no aparece; y al recargar la escena de OBS se vuelve a pedir.

Optimización (subsistema `letras`):

1. El overlay pide a Cortex: `GET /api/letras?track=<id>&artist=&title=&album=&duration=` (mismo origen, mismo WebSocket, sin CORS).
2. El backend resuelve con el orden de §6 y **guarda el resultado en SQLite**.
3. La próxima vez (misma canción, otro día, otra sesión, otro overlay) sale de SQLite: **cero red**.
4. Si el backend no responde, el overlay conserva su llamada directa a LRCLIB como último recurso (una línea de respaldo, la que ya tiene).

**Medido**: una letra sincronizada real de 60 líneas ocupa **5,9 KB** en la base → **3.000 canciones ≈ 17 MB en disco** y **0 KB en RAM** (se lee bajo demanda). LRCLIB **nunca recibe más de una consulta por canción** (se recuerda también el "no tiene letras" con `lyrics_status='none'`, para no volver a preguntar).

Reglas del resolver:

- Validar el resultado con la **duración** (LRCLIB devuelve `duration`): si difiere más de 3 s del tema pedido, se descarta y se sigue con la fuente siguiente. Evita pegar la letra de otra versión/remix.
- Prefetch en segundo plano **con límite de 1 consulta por segundo** y sólo para canciones candidatas del automático (no ráfagas).
- Guardar `source` siempre (`lrclib` / `spotify_local` / `manual`) para poder auditar qué se mostró.

### 4.3 Scanner de la biblioteca

- **Detección de cambios sin hashear**: comparar `file_size` + `file_mtime`; el hash (`file_hash`) se calcula **sólo si el archivo cambió**. Con 3.000 archivos, hashear todo en cada scan es el error clásico.
- **Insertar/actualizar en lotes y en una sola transacción** (medido: 3.000 filas en 48 ms, contra segundos si se hace fila por fila).
- Rescan incremental: sólo lo nuevo o lo modificado (por fecha de la carpeta), sin recorrer todo el árbol si no hace falta.
- La carpeta de música es **un ajuste** (`musicLibraryPath`), tolerante a que no exista o esté vacía.
- Nunca borrar filas por "no veo el archivo": marcar `offline = 0` y dejar registro (un disco desconectado no debe vaciar la biblioteca).

### 4.4 Análisis de `start_at` / `end_at`

**Medido con ffmpeg sobre un MP3 real de 1711 s** (`D:\RADIO\enganchados\…`):

| Tarea | Tiempo |
| --- | --- |
| Detectar silencio + volumen en los primeros 15 s (`-ss 0 -t 15`, `silencedetect` + `volumedetect`) | **363 ms** |
| Detectar silencio en los últimos 15 s (`-sseof -15`) | **348 ms** |
| Resultado real en ese archivo | silencio del final: `silence_start: 13.276` → **`end_at = duración − 1,72 s`** |

Por lo tanto: **~0,7 s por canción** (nunca se decodifica la canción completa) → 3.000 canciones ≈ **35 minutos**, y con 2 trabajos en paralelo ≈ **18 minutos**, en segundo plano, sin afectar el stream.

Reglas:

- Umbrales: `silencedetect=noise=-30dB:d=0.25` para silencio y `volumedetect` para nivel medio/bajo. Se guardan los dos resultados crudos para poder reajustar sin volver a analizar.
- `start_at` = primer instante con contenido real después del silencio/instrumental (tope 15 s); `end_at` = último instante con contenido antes del silencio final (tope: `duración − 15 s` → `duración`).
- **Validación**: `0 ≤ start_at ≤ 15`, `duración − 15 ≤ end_at ≤ duración`, `start_at < end_at`. Si no se cumple → no se guarda nada.
- **Fallback seguro**: `start_at = 0`, `end_at = duración`.
- **IA sólo si el resultado es ambiguo** (ni silencio claro ni inicio claro), y sólo con esos 15 s de audio como entrada. Un resultado de IA que no pase la validación se descarta.
- `analysis_status = 'manual'` cuando lo define el usuario: el scanner **nunca** lo pisa.
- Cuello de botella real = ffmpeg. Por eso: **un worker**, lote de a 50, transacción por lote, y concurrencia 2 como máximo.

### 4.5 Presupuesto de RAM (con 3.000 canciones)

| Qué | Cuánto |
| --- | --- |
| Metadata en RAM (id, spotify id, título, artista, duración, offline, enabled, start/end) | **≈ 400 KB** (objetos JS), nunca más de ~1 MB |
| `played_today_ids` (Set de enteros) | ≈ 100 KB |
| `offline_track_ids` (Set) | ≈ 100 KB |
| Letras en RAM | **0 permanente**; caché LRU de 3–20 canciones ≈ 30–120 KB |
| **Total** | **< 2 MB** |

Las letras **nunca** se cargan todas: se leen por canción y se descartan.

### 4.6 Los índices que hacen la diferencia

- `UNIQUE spotify_track_id` → una fila por canción, venga del scanner o de un pedido del chat.
- `UNIQUE local_path` → el mismo archivo no entra dos veces.
- `INDEX (offline, enabled)` → el automático no recorre la tabla.
- `UNIQUE INDEX (track_id, played_date) WHERE play_mode='auto'` → **la regla "no repetir en automático el mismo día" la garantiza la base**, y no afecta a los pedidos manuales (pueden repetir).
- `UNIQUE INDEX (track_id, kind) WHERE status IN ('pending','processing')` → imposible encolar el mismo trabajo dos veces.
- `INDEX lyrics_status` → no se vuelve a preguntar por lo que ya sabemos que no tiene letra.
- `INDEX (artist, title)` → búsquedas por nombre cuando todavía no hay Track ID.

Verificación de que se usan: `probar-esquema.js` corre `EXPLAIN QUERY PLAN` y confirma `SEARCH … USING PRIMARY KEY` / uso del índice parcial.

### 4.7 Lo que NO se optimiza porque ya está bien

- Los JSON de ajustes/vocabulario no van a SQLite: se editan desde las páginas y `file-store.js` los recarga en caliente en ≤2 s. Moverlos a la base agregaría trabajo y perdería esa edición en vivo.
- Las respuestas del bot ya son datos con variantes y bolsa mezclada.
- La variedad por artista/género ya tiene su bolsa en memoria (no consulta la base).
- El overlay ya sigue el progreso real de Spotify y compensa el tránsito de red: **no se le agrega un segundo reloj**.

---

## 5. Modelo de datos

Las tablas están en `esquema-music.sql` (aplicable tal cual, idempotente). Resumen:

```text
tracks
  id · spotify_track_id (único) · title · artist · album · duration_ms
  offline · enabled · local_path (único) · file_size · file_mtime · file_hash
  start_at · end_at · skip_seconds · analysis_status · lyrics_status · lyrics_checked_at
  created_at · updated_at

lyrics          (una fila por canción, líneas normalizadas en JSON)
  track_id (PK) · source · language · synced · instrumental · provider · duration_ms
  lines_json · fetched_at · updated_at

play_history
  id · track_id · played_date · played_at · play_mode (auto|manual) · play_source · start_at · end_at
  UNIQUE (track_id, played_date) WHERE play_mode='auto'

analysis_jobs
  id · track_id · kind (offset|scan|lyrics) · status · attempts · error_message · started_at · finished_at
  UNIQUE (track_id, kind) WHERE status IN ('pending','processing')
```

Vistas incluidas: `v_candidatos_auto` (lo que falta hoy) y `v_biblioteca_resumen` (los 9 números del dashboard en **un solo `SELECT`**).

Ejemplo de `lines_json`:

```json
[{"startMs":25530,"endMs":28680,"text":"Ella despidió a su amor"}]
```

Detalle de por qué una fila por canción y no una fila por línea: una lectura por canción (0,005 ms medido), sin `JOIN`, y no necesitás consultar líneas sueltas por SQL.

---

## 6. Letras: resolución y fuentes

### 6.1 Orden de resolución

```text
resolverLetras(tema)
  1) SQLite            → si está, listo (0 red)
  2) caché de Spotify  → SÓLO si está habilitada; normaliza y guarda
  3) LRCLIB            → consulta, valida duración, normaliza y guarda
  4) manual / sin letra → se anota lyrics_status='none' (con fecha) para no repetir la consulta
```

Si algo falla en (2) **se registra y se sigue**: nunca una excepción que corte la reproducción ni la respuesta del bot.

### 6.2 Formato normalizado único

```json
{ "trackId":"...", "source":"lrclib", "language":"es", "synced":true,
  "lines":[{"startMs":25530,"endMs":28680,"text":"Ella despidió a su amor"}] }
```

El overlay no conoce el formato de cada fuente: recibe esto (y ya sabe sincronizarlo contra el progreso real). Su formato interno actual es `{timeMs, text}`, así que el puente es un `map` de tres líneas.

### 6.3 LRCLIB (fuente externa principal)

- Sin cuenta ni clave. `GET /api/get?artist_name=&track_name=&album_name=&duration=` y `GET /api/search?q=`.
- Devuelve `syncedLyrics` (formato LRC `[mm:ss.xx]`), `plainLyrics`, `instrumental`, `duration` y un `lyricsfile` ya estructurado con `start_ms`/`end_ms`.
- **Sin letra responde HTTP 200 con `error: true`** (no 404): hay que mirar el flag, no el status.
- Mandar cabecera de cliente identificatoria (`Lrclib-Client`) y respetar el límite: **1 consulta por segundo**.
- **Validar la duración** antes de aceptar (diferencia ≤ 3 s).

### 6.4 Caché local de Spotify (opcional, apagada por defecto)

Lo que se sabe (informe completo en `Rulo\otros\investigacion-letras-spotify.md`):

- El cliente de escritorio (Microsoft Store 1.300.277.0) guarda el JSON de letras, comprimido con gzip, en `%LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0\LocalCache\Spotify\Browser\Cache\Cache_Data\`. Se leyó con éxito **con Spotify cerrado y sin administrador** (12 letras reales, `LINE_SYNCED`, Musixmatch).
- El cuerpo **no** trae el Track ID: la clave (URL `color-lyrics/v2/track/<ID>`) vive en `data_1` y los cuerpos en `data_2`/`data_3`. **Unirlos exige parsear el índice de la caché de Chromium**; no alcanza con buscar texto.
- Puede haber **cuerpos viejos** en zona reutilizada (restos), así que la asociación debe validarse.
- La cobertura es parcial (sólo lo que el cliente pidió) y se pierde con "Borrar caché".

Condiciones para activarlo (`spotifyLocalLyricsEnabled = false` por defecto):

1. Hacer antes el experimento controlado (`Rulo\otros\investigar-letras-spotify.js --foto antes|despues`) y dejar registrado qué archivo cambia al abrir las letras.
2. Implementarlo aislado como `leer-cache-spotify.js`, con salida `NormalizedLyrics | null` y **sin lanzar excepciones**.
3. Validar cada letra leída contra la **duración** del tema y contra el título/artista esperados; si no coincide, descartarla (protege del riesgo de mostrar la letra equivocada en el stream).
4. No usarla nunca como fuente única: es un ahorro de red, no la base del sistema.

---

## 7. Reproducción: manual, automático y ciclo diario

### Pedido manual (como hoy, con dos agregados)

```text
chat → parser → Track ID → buscar en la base
   ├── hay fila con archivo local?  → se reproduce por Spotify igual (ver §7.3),
   │                                  pero con start_at/end_at aplicados
   └── no hay fila → Spotify como siempre
```
El pedido manual **puede repetir** la canción aunque ya haya sonado hoy.

### Automático (nuevo)

```text
se acabó el tema / timer
   ↓
candidatos = biblioteca en RAM filtrada por (offline=1, enabled=1, no está en played_today_ids)
   ↓ (si queda vacía → reinicio del ciclo: se limpia played_today_ids y se vuelve a elegir)
elegir al azar
   ↓
reproducir + aplicar start_at/end_at
   ↓
INSERT OR IGNORE en play_history (auto)  +  agregar a played_today_ids
```

- La elección se hace **en memoria** (Set + array), no con `ORDER BY RANDOM()` en cada tema.
- El `INSERT OR IGNORE` + el índice único parcial hacen que la regla diaria no dependa de la lógica del bot.
- Al agotarse el catálogo **no se bloquea**: se avisa y arranca un ciclo nuevo (§23 de la guía original, conservado).

### 7.3 Decisión abierta: ¿quién reproduce el archivo local?

Este es el único punto donde la guía original y tu sistema real chocan: **Spotify Web API no reproduce archivos locales**. Hay tres caminos y conviene elegir con la cabeza fría:

| Opción | Ventaja | Costo / riesgo |
| --- | --- | --- |
| **A. El archivo local no se reproduce: la biblioteca sólo aporta `start_at`/`end_at` y el "no repetir"** (recomendada para empezar) | No toca nada del pipeline que ya funciona (Spotify + overlay + now playing). Es sólo metadata | No hay ahorro de ancho de banda ni reproducción sin internet |
| B. Reproductor externo (mpv/VLC por consola) controlado por el backend | Reproducción local real, sin navegador | Hay que crear un canal de estado nuevo (el overlay hoy se alimenta del estado de Spotify de SSN), control de proceso, volumen y pantalla |
| C. Página propia con `<audio>` servido por el backend, como Browser Source de OBS | Todo queda en Cortex (mismo origen + WebSocket), sin programas externos | Necesita una fuente nueva en la escena de OBS y que el overlay acepte dos orígenes de estado |

**Recomendación:** implementar A primero (Fase 4) —da el 80% del beneficio con riesgo casi nulo— y dejar B/C para una fase posterior, cuando el pipeline de la biblioteca ya esté probado en vivo. La decisión debe documentarse antes de escribir código de reproducción local.

---

## 8. Módulos y páginas (traducción de los "agentes" de la guía)

| Pieza de la guía | En tu proyecto |
| --- | --- |
| `spotify-flujo` | `spotify-auto-music.js` (ya existe; se le agrega el pedido de letras al backend y la consulta de `start_at`/`end_at`) |
| `cortex-backend` | `Control Cortex\backend\server.js` + `db.js` nuevo (conexión única a la base) |
| `lyrics-engine` | `Control Cortex\backend\letras\resolver.js` + `lrclib.js` + `leer-cache-spotify.js` (opcional) |
| `music-library` | `Control Cortex\backend\biblioteca\scanner.js` + `metadatos.js` (ffprobe) |
| `audio-analysis` | `Control Cortex\backend\biblioteca\analisis-jobs.js` (worker ffmpeg + cola) |
| `qa-stream` | `Rulo\tests\` (jsdom + `node:sqlite` + ffmpeg real) y prueba en OBS |
| Dashboard de biblioteca | nueva sección/pestaña en `Rulo\Spotify\spotify-dashboard.html` |

Regla: **un módulo nuevo = un archivo de prueba nuevo** en `Rulo\tests\`, agregado al `npm test`.

---

## 9. Fases (con criterio de terminado)

### Fase 1 — Base persistente
- Aplicar `esquema-music.sql` (script `aplicar-esquema.js`, con copia de seguridad previa).
- `db.js`: una sola conexión, WAL, `foreign_keys=ON`, y el helper de fecha lógica.
- **Terminado cuando**: `probar-esquema.js` pasa, la base real tiene las tablas y el dashboard/analítica siguen funcionando igual.

### Fase 2 — Biblioteca (scanner)
- Ajuste nuevo `musicLibraryPath` en el dashboard.
- Scanner incremental con `size+mtime`, leve, en segundo plano, comandos `!scan` y `!scan --new` (cargados como datos en el vocabulario).
- Identificación del Track ID: por metadatos (título+artista+duración) contra el catálogo ya disponible, y **guardando el candidato para revisar** cuando hay dudas.
- **Terminado cuando**: 3.000 archivos escaneados sin bloquear el backend, sin duplicados, y un disco desconectado no borra nada.

### Fase 3 — `start_at` / `end_at`
- Worker de análisis (ffmpeg, bordes, validación, fallback) + `analysis_jobs`.
- Override manual desde el dashboard (`analysis_status='manual'`).
- **Terminado cuando**: lote de 50 canciones analizado sin afectar el stream y los valores se aplican en la reproducción (usando el mecanismo de offset actual).

### Fase 4 — Reproducción automática (opción A)
- Ciclo diario, `played_today_ids`, elección en RAM, registro en `play_history`, reinicio de ciclo.
- **Terminado cuando**: una sesión completa sin repetir en automático, el manual sí repite, y todo sobrevive a un reinicio del backend.

### Fase 5 — Letras (SQLite + LRCLIB + overlay)
- Endpoint `/api/letras`, caché en SQLite, normalizado, prefetch con límite.
- Overlay: pedir al backend y dejar LRCLIB directo como último recurso.
- **Terminado cuando**: la segunda vez que suena un tema la letra aparece sin red, y con LRCLIB caído las ya cacheadas se siguen viendo.

### Fase 6 (opcional) — Caché local de Spotify
- Sólo tras el experimento controlado y con validación por duración. Apagada por defecto.

### Fase 7 (opcional) — Reproducción local real (opciones B o C)
- Requiere decisión escrita antes de empezar.

---

## 10. Pruebas obligatorias

Además de la suite actual (`cd Rulo\tests && npm test` — hoy **502 pruebas**), cada fase agrega las suyas:

| Área | Casos |
| --- | --- |
| Base | esquema idempotente · índices usados · `INSERT OR IGNORE` bloquea el repetido automático y permite el manual · borrado en cascada |
| Scanner | archivo nuevo · archivo modificado (mismo tamaño, otra fecha) · archivo borrado del disco · duplicados por ruta · carpeta inexistente |
| Análisis | silencio al inicio · sin silencio (start_at=0) · silencio al final (end_at correcto) · archivo corrupto (`analysis_status='failed'`, sin romper) · override manual no se pisa · valores fuera de rango se descartan |
| Letras | SQLite primero · LRCLIB válido · LRCLIB con duración distinta se descarta · `error:true` sin letra · instrumental · sin letra se recuerda y no se vuelve a consultar · overlay con el backend caído (respaldo directo) |
| Caché Spotify | habilitada/deshabilitada · caché vacía · caché corrupta · Spotify cerrado · letra que no valida se descarta |
| Ciclo diario | no repetir en automático · manual repite · agotamiento del catálogo y reinicio · fecha lógica al cambiar el día |
| Integración | un pedido del chat sigue funcionando igual · el offset actual sigue aplicándose · el overlay sigue sincronizando con el progreso real |

Nada se considera terminado sin una prueba real en OBS (chat → tema → letra → corte).

---

## 11. Despliegue (tu flujo real)

Cuando cambies algo que vive dentro de la extensión:

```text
1. Subir la versión en Control Cortex\backend\versions.js (hoy 31).
2. Reiniciar el backend → el auto-patcher copia el módulo a SSN y actualiza el loader.
3. brave://extensions → Actualizar en SocialStream Ninja.
4. OBS → recargar los Browser Sources.
5. Probar de verdad (chat + overlay + offset).
```

Cuando sea sólo backend/páginas (lo más común): reiniciar el backend y recargar la página (F5) alcanza; el módulo no cambia.
Comandos útiles que ya tenés: `SSN 1 - Estado.bat`, `SSN 2 - Respaldo.bat`, `MIGRAR-SOCIALSTREAM.md`, `SUBIR Rulo a GitHub.bat` (recordá: la base **no** se sube).

---

## 12. Logs y diagnóstico

```text
[letras]   track=<id> source=sqlite|spotify_local|lrclib  synced=1 lineas=64 ms=2
[letras]   track=<id> sin letras (se recuerda)
[letras]   cache de Spotify no disponible (se sigue sin ella)
[biblioteca] scan: 3000 archivos, 12 nuevos, 3 modificados, 41 ms
[analisis] track=<id> start_at=8.2 end_at=237.5 (ffmpeg 0.7 s)
[analisis] track=<id> ambiguo → IA
[auto]     elige track=<id> (faltan 1240 hoy) · ciclo reiniciado
```

En las páginas: la sección de análisis existente ya muestra resumen, avisos y recordatorio; la biblioteca agrega sus propios números con la vista `v_biblioteca_resumen`.

Nunca loguear cookies, tokens ni credenciales.

---

## 13. Seguridad y licencias

- Nada de descifrar DRM, extraer audio protegido ni modificar la instalación de Spotify. El lector de letras (si se usa) sólo lee texto ya presente en la caché local del propio usuario.
- Las letras son **contenido licenciado** (Musixmatch vía Spotify; LRCLIB con su propia licencia): mostrar letras en el stream es responsabilidad del canal, igual que hoy.
- Guardar siempre el `source` de cada letra: permite auditar qué se mostró y de dónde salió.
- La clave de la IA sigue viviendo en `Control Cortex\backend\.env`.
- La base con datos del chat se mantiene fuera de GitHub.

---

## 14. Qué NO hacer

```text
- Cargar las 3.000 letras en RAM.
- Hacer de la caché de Spotify una fuente obligatoria o la única.
- Bloquear la reproducción (o la respuesta del bot) porque falló el parser de letras.
- Hardcodear la ruta de Spotify: detectar instalación y rutas.
- Asumir que caché = biblioteca permanente.
- Recodificar o recortar los archivos de audio.
- Duplicar datos: ajustes/vocabulario en JSON y en SQLite a la vez.
- Consultar LRCLIB en cada tema o sin límite de frecuencia.
- Volver a preguntar por canciones que ya sabemos que no tienen letra.
- Decodificar la canción completa para sacar 15 segundos de las puntas.
- Editar a mano archivos generados dentro de SSN.
- Guardar secretos en logs, JSON o documentación.
- Cambiar la reproducción sin una prueba real en OBS.
```

---

## 14.bis Estado de implementación (19 de septiembre de 2026)

Lo que ya está hecho y verificado (con pruebas que corren en `npm test`):

| Pieza | Archivo | Pruebas |
| --- | --- | --- |
| Base única + esquema aplicado a la base real (con backup previo) | `Control Cortex/backend/db.js` | 18/18 (`probar-esquema.js`) |
| Conexión compartida (una sola para todo el backend) | `db.js` (analítica y biblioteca la comparten) | las del historial siguen OK |
| Scanner de la biblioteca (ffprobe, detector de cambios, adopción de fichas) | `biblioteca/scanner.js` | **31/31** con audios reales |
| Análisis de inicio/final (ffmpeg, cola con reintentos, override manual) | `biblioteca/analisis.js` | **24/24** con silencios reales |
| Letras: SQLite → (caché de Spotify opcional) → LRCLIB, con validación | `biblioteca/letras.js` + `biblioteca/lrclib.js` | **31/31** |
| Modo automático: elección en RAM, ciclo diario, historial, planificador | `biblioteca/auto.js` | **28/28** |
| Reproducción del automático: URI directa + `start_at`/`end_at` (módulo v32) | `spotify-auto-music.js` | **136/136** |
| Overlay pidiendo las letras a Cortex (LRCLIB como respaldo) | `Control Cortex/frontend/spotify-lyrics-overlay.html` | +13 del dashboard |
| Sección "Biblioteca local" en el dashboard (carpeta, interruptores, escanear, analizar, probar) | `Rulo/Spotify/spotify-dashboard.html` | **80/80** |

**Endpoints nuevos** (todos verificados en vivo):

```text
GET  /api/biblioteca                 resumen + estado de análisis, letras y modo automático
GET  /api/biblioteca-tracks          lista de canciones (filtros: offline, buscar, limite)
POST /api/biblioteca-scan            escanea la carpeta configurada
POST /api/biblioteca-analizar        encola y procesa un lote de inicio/final
POST /api/biblioteca-track           edición manual (start_at/end_at pasan a 'manual')
POST /api/biblioteca-auto            elegir / recargar el modo automático
GET  /api/letras                     letras normalizadas (lo usa el overlay)
GET  /api/letras-estado              cuántas hay guardadas y de qué fuente
POST /api/letras-traer               trae de a poco las que faltan (1 por segundo)
```

**Ajustes nuevos** (en el dashboard, se guardan solos): `musicLibraryPath`, `autoBiblioteca`, `spotifyLocalLyrics`.

**Fase 4 completa (19-sep-2026).** El circuito entero funciona:

1. **Disparador:** el backend revisa cada 20 s; si `autoBiblioteca` está encendido, no hubo pedidos en `autoEsperaSegundos` (240 por defecto) y no hay una canción de la biblioteca sonando, elige una y **encola el comando** por el canal que ya existía (`queueSpotifyCommand`), registrando la reproducción en `play_history`.
2. **El módulo (v32) reproduce por URI**: `spotify:track:<id>` se busca directo en `/v1/tracks/<id>` (sin pasar por el buscador de texto) y **aplica `start_at`/`end_at` de esa canción** (arranca en el segundo indicado y corta donde dice `end_at`).
3. **Sin huecos:** cuando una canción llega a su final lógico, el módulo avisa a `POST /api/biblioteca-auto-termino` y el backend adelanta la siguiente a 5 s.

Verificado en vivo: el planificador encoló
`{type: play, uri: spotify:track:<id>, startAt: 4.5, endAt: 190, auto: true}` y el estado quedó
`{ciclo: 1, habilitado: true, reproducidasHoy: 1, proximoEnMs: 223578}`.

**Requiere recargar la extensión** (`brave://extensions`) porque cambió el módulo a v32: el backend ya lo copió a SSN y el loader apunta a `?v=32`.

**Fase 6 (caché local de Spotify)** sigue apagada y sólo con la validación por duración; falta el experimento controlado del §6.4.
**Fase 7 (reproductor local)** sigue pendiente de decisión (§7.3): hoy la biblioteca reproduce por Spotify, con sus offsets.

## 15. Anexos

### 15.1 Archivos

De esta carpeta:

```text
canciones automatic\
  GUIA-RULO-SPOTIFY.md      esta guía
  esquema-music.sql         tablas nuevas (idempotente, probado)
  aplicar-esquema.js        aplica el esquema a la base real, con copia de seguridad previa
  consultas-clave.sql       consultas del bot/scanner/dashboard
  probar-esquema.js         prueba del esquema + mediciones (18/18 OK)
  LEEME.md                  mapa de la carpeta y orden de uso
```

Ya implementados en el proyecto (los del §14.bis):

```text
Control Cortex\backend\db.js                          conexión única + migraciones
Control Cortex\backend\biblioteca\scanner.js         biblioteca local (ffprobe)
Control Cortex\backend\biblioteca\analisis.js        inicio/final con ffmpeg
Control Cortex\backend\biblioteca\letras.js          resolución de letras
Control Cortex\backend\biblioteca\lrclib.js          cliente de LRCLIB
Control Cortex\backend\biblioteca\auto.js            modo automático y ciclo diario
Rulo\tests\biblioteca-*-test.js                       4 archivos de prueba nuevos
```

### 15.2 Comandos

```bash
# probar el esquema sobre una base temporal (no toca tus datos)
node "Rulo/Spotify/canciones automatic/probar-esquema.js"

# aplicar las tablas a la base real (hace copia de seguridad antes)
node "Rulo/Spotify/canciones automatic/aplicar-esquema.js"

# suite completa del proyecto
cd "Rulo/tests" && npm test

# investigación de la caché de letras de Spotify (opcional)
node "Rulo/otros/investigar-letras-spotify.js"

# verificar sintaxis de lo que se toque
node --check "Control Cortex/backend/server.js"
node --check "Control Cortex/integrations/spotify-auto-music/spotify-auto-music.js"
```

### 15.3 Decisiones pendientes (antes de escribir código)

1. **Quién reproduce el audio local** (§7.3): A (sólo metadata) recomendada para arrancar; B o C más adelante.
2. **Carpeta de la biblioteca** (`musicLibraryPath`): definir la ruta definitiva.
3. **Umbrales de análisis**: los valores medidos funcionan, pero conviene ajustarlos con tus enganchados y cumbias reales antes de correr las 3.000.
4. **Renombrar la base** a `rulo-musica.db` (opcional, cuando ya esté todo estable).
5. **Caché de Spotify**: activar o no (§6.4) después del experimento controlado.
