# Entrega: Fases 2 a 5 de la biblioteca musical (terminadas)

**Fecha:** 19 de septiembre de 2026
**Proyecto:** Rulo / Control Cortex / SocialStream Ninja / OBS / Spotify
**Estado:** **Fases 1 a 5 completas y verificadas. 639 pruebas pasando** (arrancaron en 502).

---

## Resumen ejecutivo

Se implementó y verificó el circuito completo de la biblioteca musical:

```text
carpeta de música → scanner (ffprobe) → SQLite (tracks)
                        ↓
        análisis con ffmpeg → start_at / end_at
                        ↓
   modo automático (elige, no repite en el ciclo) → comando a la extensión
                        ↓
     módulo v32 reproduce por URI con sus offsets → registra en play_history
                        ↓
   letras: SQLite → (caché de Spotify, opcional) → LRCLIB → overlay de OBS
```

Nada de lo que ya funcionaba se rompió: la reproducción por pedidos, los cooldowns, la variedad por artista, las respuestas del bot y el parcheo de SSN siguen igual.

---

## Fase 4 completa: el modo automático cierra el circuito

Era lo único que quedaba a medias. Ahora funciona en tres piezas:

1. **Planificador (backend, cada 20 s).** Si `autoBiblioteca` está encendido, no hubo pedidos en `autoEsperaSegundos` (240 por defecto) y no hay una canción de la biblioteca sonando, elige una al azar y **encola el comando** por el canal que ya existía (`queueSpotifyCommand`), y registra la reproducción en `play_history` (la base garantiza que no se repita dentro del ciclo).
2. **Módulo v32.** Reproduce por `spotify:track:<id>`: busca directo en `/v1/tracks/<id>` (sin pasar por el buscador de texto) y **aplica el `start_at`/`end_at` de esa canción**: arranca en el segundo indicado y corta en el final lógico.
3. **Sin huecos.** Cuando la canción llega a su final lógico, el módulo avisa a `POST /api/biblioteca-auto-termino` y el backend adelanta la siguiente a 5 segundos.

### Verificación en vivo (esto es exactamente lo que recibe la extensión)

```json
{ "type": "play", "uri": "spotify:track:PRUEBAPRUEBAPRUEBAPRUE01",
  "startAt": 4.5, "endAt": 190, "auto": true }
```

```json
{ "ciclo": 1, "habilitado": true, "esperaSegundos": 30,
  "puede": { "si": false, "motivo": "esperando a que termine lo que suena", "faltanMs": 223578 },
  "enBiblioteca": 1, "candidatas": 0, "reproducidasHoy": 1, "historial": { "auto": 1 } }
```

La prueba de la extensión también cubre el corte real: con la canción en 186 s de 200 s y `end_at = 190`, el módulo **pasa al siguiente tema** y **le avisa al backend** (las dos cosas se verifican en las pruebas del módulo).

---

## Evidencia en vivo, fase por fase

| Fase | Pruebas | Verificación en vivo |
| --- | --- | --- |
| 1 · Base única + migraciones | 18/18 | Esquema aplicado a la base real **con backup previo**; las 15 interacciones del chat quedaron intactas |
| 2 · Scanner de la biblioteca | **31/31** | `D:\RADIO\enganchados`: 4 archivos detectados en **285 ms** (con ffprobe real) |
| 3 · Análisis inicio/final | **24/24** | 4 canciones reales en **1850 ms** (0,46 s cada una). `Enganchado Villero 2000 (Parte 3)`: 1711 s → `end_at = 1709,3` (idéntico al valor medido a mano) |
| 4 · Automático + módulo v32 | **28/28** + **136/136** | El planificador encoló la canción con sus offsets; el corte por `end_at` pasa al siguiente y avisa |
| 5 · Letras con caché | **31/31** | 1ª vez: LRCLIB real (**64 líneas**, primera a 25.530 ms) → guardada en SQLite. 2ª vez: **sin red** (`guardadas: 1, kb: 4`) |

### Suite completa

```text
92/92  interfaz de Rulo            39/39  pestaña Bot / Rulo
 4/4   panel Control Cortex       136/136 módulo de Spotify
81/81  dashboard de Spotify        42/42  parcheo de SSN
48/48  entrenamiento               16/16  archivos de Spotify
33/33  módulo de respuestas        34/34  historial SQLite
31/31  scanner                     24/24  análisis
31/31  letras                      28/28  modo automático
------------------------------------------------------------
639 pruebas OK
```

---

## Qué tenés que hacer (un solo paso)

**Recargá la extensión en `brave://extensions`** → quedó en **v32**.

El backend ya copió el módulo a `SocialStream Ninja\local-overrides\` (mismo hash que el fuente) y el loader apunta a `?v=32`. Sin esa recarga, el modo automático encola los comandos pero la extensión no sabe aplicar los offsets por canción.

**Las letras ya funcionan sin recargar nada**: el overlay pide a Cortex y LRCLIB queda como respaldo.

### Cómo probarlo

```text
Dashboard → Biblioteca local
  1. Escribí la carpeta de música            (se guarda solo)
  2. "Escanear carpeta"                      → arma la lista
  3. "Analizar 10 (inicio/final)"            → mide los offsets
  4. Marcá "Modo automático"                 → y ajustá la espera
  5. "Probar: elegir al azar"                → muestra qué pondría y con qué offsets
```

---

## Archivos nuevos y modificados

**Módulos nuevos** (`Control Cortex\backend\`):

```text
db.js                  conexión única + migraciones (una sola base)
biblioteca\scanner.js  biblioteca local: ffprobe, detector de cambios, adopción de fichas
biblioteca\analisis.js inicio/final con ffmpeg, cola con reintentos, override manual
biblioteca\letras.js   resolución de letras (SQLite → caché Spotify → LRCLIB)
biblioteca\lrclib.js   cliente de LRCLIB (LRC, validación por duración)
biblioteca\auto.js     modo automático, ciclo diario, planificador
```

**Pruebas nuevas** (`Rulo\tests\`): `biblioteca-scanner-test.js`, `biblioteca-analisis-test.js`, `biblioteca-letras-test.js`, `biblioteca-auto-test.js` (registradas en `npm test`, que ahora corre 14 archivos).

**Modificados**: `server.js` (endpoints, ajustes, planificador), `integrations\spotify-auto-music\spotify-auto-music.js` (**v32**: URI directa, `start_at`/`end_at` por canción, aviso de fin), `versions.js` (32), `frontend\spotify-lyrics-overlay.html` (pide a Cortex primero), `Rulo\Spotify\spotify-dashboard.html` (sección Biblioteca local), `spotify-analytics.js` (usa la conexión compartida), `esquema-music.sql` (columna de ciclo + detalle del análisis).

**Endpoints nuevos**:

```text
GET  /api/biblioteca                 resumen + estado de análisis, letras y automático
GET  /api/biblioteca-tracks          lista (filtros: offline, buscar, limite)
POST /api/biblioteca-scan            escanea la carpeta configurada
POST /api/biblioteca-analizar        encola y procesa un lote de inicio/final
POST /api/biblioteca-track           edición manual (start_at/end_at → 'manual')
POST /api/biblioteca-auto            elegir / recargar el modo automático
POST /api/biblioteca-auto-termino    aviso de fin lógico (lo llama el módulo)
GET  /api/letras                     letras normalizadas (lo usa el overlay)
GET  /api/letras-estado              cuántas hay guardadas y de dónde salieron
POST /api/letras-traer               trae de a poco las que faltan (1 por segundo)
```

**Ajustes nuevos** (dashboard, se guardan solos): `musicLibraryPath`, `autoBiblioteca`, `autoEsperaSegundos`, `spotifyLocalLyrics`.

---

## Lo que queda afuera (a propósito)

- **Fase 6 — caché local de Spotify:** apagada por defecto, con validación por duración. Requiere el experimento controlado (`Rulo\otros\investigar-letras-spotify.js --foto antes|despues`) antes de activarla.
- **Fase 7 — reproductor local:** hoy la biblioteca reproduce por Spotify con sus offsets. Quién reproduce el archivo local (Spotify vs. player propio) sigue siendo la decisión abierta del §7.3 de la guía.

---

## Optimizaciones que quedaron activas

| Qué | Resultado medido |
| --- | --- |
| Una sola base y una sola conexión | 3.000 canciones cargan en 48 ms; leer una letra 0,005 ms; candidatas de hoy 1,8 ms |
| Una fila por canción en `letras` (líneas en JSON) | 5,9 KB por canción → 3.000 canciones ≈ 17 MB **en disco y 0 KB en RAM** |
| ffprobe sólo si el archivo cambió | El segundo escaneo no ejecuta ffprobe ni una vez |
| ffmpeg sólo en los bordes de 15 s | 0,46 s por canción (no se decodifica la canción completa) |
| Las letras no se vuelven a pedir | Una consulta a LRCLIB por canción en toda la vida del sistema |
| La regla diaria la garantiza la base | Índice único parcial por `(track_id, played_date, cycle)` |

---

## Notas menores

- En la base quedó **1 fila de la prueba de letras** (Maná, con `offline = 0`, no entra en el modo automático) y las **15 interacciones del chat intactas**.
- El modo automático quedó **apagado** al terminar las pruebas (como estaba antes).
- El backend corre con tu mismo `node server.js` en el puerto 4000.

## Comandos útiles

```bash
# pruebas (14 archivos, incluidos los 4 nuevos de la biblioteca)
cd "Rulo/tests" && npm test
cd "Rulo/tests" && npm run test:biblioteca

# esquema y mediciones (no toca tus datos)
node "Rulo/Spotify/canciones automatic/probar-esquema.js"

# verificar sintaxis tras tocar el backend o el módulo
node --check "Control Cortex/backend/server.js"
node --check "Control Cortex/integrations/spotify-auto-music/spotify-auto-music.js"
```
