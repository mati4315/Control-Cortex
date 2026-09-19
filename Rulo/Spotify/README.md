# Rulo / Spotify

Ajustes y herramientas del cambio automático de música (pedidos por chat → Spotify Web API).

## Dashboard

Abrir en el navegador:

```
http://127.0.0.1:4000/rulo-spotify.html
```

También: `http://192.168.4.100:4000/rulo-spotify.html` (misma red, para el celular).
El backend sirve el archivo `spotify-dashboard.html` de esta carpeta.

Desde ahí se controla todo sin tocar código ni reiniciar el backend:

| Control | Qué hace |
| --- | --- |
| Pedidos de música por chat | Interruptor general del módulo |
| Modo prueba (sin esperas) | Ignora la espera global y la por usuario (para probar temas seguidos) |
| Solo comandos | Ignora el lenguaje natural, exige `!playnow` / `!tema` / `!musica` |
| Respuestas personalizadas | Antepone el nombre del que pidió |
| Avisos en el overlay | Manda o no los mensajes al overlay de Rulo |
| Continuidad automática | Encola un tema similar al terminar el pedido |
| Espera global / por usuario | Segundos (0 = sin espera) |
| Largo mínimo | Comentarios más cortos no se analizan |
| Quitar los primeros segundos | Salto inicial + corte del final |
| Dispositivo que debe reproducir | Nombre parcial del dispositivo Spotify |
| Cada cuánto consulta la extensión | 1-15 s: es la demora de la cola de comandos |
| Pruebas | Reproducir un tema ya, **buscar sin reproducir**, simular un comentario, **solo analizar** (sin reproducir) y pausa/siguiente/anterior |
| Registro | Últimos 50 pedidos (chat y pruebas) con resultado |

Los cambios se guardan solos (400 ms después de tocar el control) y la extensión los toma al instante
por WebSocket (o en `pollSeconds` segundos si usa el respaldo). No hace falta recargar nada.

## Entrenamiento del bot: palabras clave y cerebro

Página: **/rulo-spotify-training.html** (archivo `Rulo/Spotify/spotify-training.html`). Se llega desde el
panel de Spotify: link **Entrenamiento del bot** en el header, o desde el panel de correcciones.

Ahí se edita todo lo que el bot entiende, sin tocar código:

| Sección | Qué controla |
| --- | --- |
| Palabras de música | `musicWords`: tema, temita, temazo, canción, rola… |
| Verbos de pedido | `requestVerbs`: poneme, pasame, quiero escuchar, manda… |
| Saludos / muletillas | lo que se descarta antes de analizar el pedido |
| Artículos | un/la/los… (también detectan el artículo pegado: laberiso → la beriso) |
| Comandos | `!playnow`, `!tema`, `!musica` (saltean el análisis y el largo mínimo) |
| Géneros | palabra del chat → género de Spotify (folklore → folk) |
| Errores de escritura | pares de letras que se prueban al buscar (i→y, b→v…) |
| Búsqueda | intentos máximos por pedido y variantes por palabra |
| Cerebro (IA) | endpoint, modelo, instrucciones y cuándo consultarla |
| Analizador | escribís un comentario y te dice qué entendió (no reproduce nada) |

Todo se guarda en `Rulo/Spotify/spotify-vocabulary.json`, que es **la fuente de verdad del parser**: la
extensión lo recibe al instante por WebSocket y el archivo sirve para versionar el entrenamiento. Los
cambios se guardan solos 600 ms después de editar.

### Cerebro (IA), opcional

Con el cerebro activado, cuando un comentario **no** se entiende con las reglas, Cortex le pregunta a la
IA y espera este JSON:

```json
{"action":"play","artist":"","title":"","genre":"","query":"","confidence":0.8,"reply":""}
```

- Con `"action":"none"` no hace nada (el comentario no era un pedido).
- Sirve cualquier endpoint: si la URL contiene `/chat/completions` se usa el formato de chat de OpenAI
  (system + user) y la respuesta se lee de `choices[0].message.content`; si no, se manda
  `{comment, requester, genres, instructions}` y se espera el objeto del pedido.
- La clave va en `Control Cortex/backend/.env` como `SPOTIFY_AI_API_KEY` (nunca en el JSON; el
  dashboard solo muestra si está puesta).
- «Solo si el comentario tiene alguna palabra de las listas» evita gastar llamadas en saludos.
- Probado en vivo con endpoints simulados: uno compatible OpenAI y uno propio, con y sin clave.

## Qué entiende el bot (tolerancia a errores de escritura)

El parser acepta saludos y muletillas al principio, "temita/temazo/temón" como sinónimo de "tema",
verbos con "a" y pedidos sin la palabra "tema". Ejemplos que funcionan tal cual:

```text
Un tema de laberiso                      -> artista "laberiso" (prueba "la beriso" solo)
Un tema de gladis la bomba tucumana      -> artista
Un tema de la beriso                     -> artista
Hola matias un temita de los palmeras    -> artista "los palmeras"
Pasame a ke personajes                   -> artista
Poneme algun reguetón                    -> género reggaeton
```

Cómo lo logra:

1. **Limpieza**: saca saludos (`hola`, `buenas`, `que tal`…), muletillas (`che`, `por favor`, `dale`…)
   y menciones (`@usuario`).
2. **Sinónimos**: `tema`, `temita`, `temazo`, `temón`, `musica`, `musiquita`, `cancion`, `rola`, `track`.
   El pedido puede estar en cualquier parte del comentario, no solo al principio.
3. **Géneros con variantes**: `reguetón`, `regueton`, `regeton`, `reggaeton`… van todos a reggaeton.
4. **Búsqueda tolerante**: si la primera búsqueda no trae nada, prueba variantes — artículo pegado
   (`laberiso` → `la beriso`), sin artículo (`los palmeras` → `palmeras`) y confusiones típicas
   (i/y, b/v, s/z, ll/y, qu/k, c/s). Máximo 7 intentos por pedido.
5. **Correcciones aprendidas**: cuando una variante funciona, se guarda la equivalencia en
   `Rulo/Spotify/spotify-aliases.json` y la próxima vez busca directo. Se ven y se cargan a mano
   desde el panel **Correcciones aprendidas** del dashboard.

## Por qué las pruebas "encolaban" y cómo se resolvió

El token de Spotify vive **dentro de la extensión** SocialStream Ninja, no en el backend. Por eso el
dashboard no puede hablar con Spotify: deja el pedido en una **cola** en Cortex y la extensión lo
retira. Ahora hay dos caminos:

| Camino | Demora | Cuándo |
| --- | --- | --- |
| WebSocket (`/api/spotify-ws`) | **~10-30 ms** (medido) | Siempre que la extensión esté abierta |
| Consulta periódica (`pollSeconds`) | hasta `pollSeconds` s | Respaldo si el WebSocket no está |

El WebSocket existe porque Brave/Chrome **estrangular los timers de las páginas de fondo a una vez por
minuto**: con solo la consulta periódica, los comandos llegaban cada 60 s aunque el intervalo fuera de
1 s (se veía en el registro: 20:46:44, 20:47:44, 20:48:44). Con el enlace abierto el comando llega al
instante y el poll queda como red de seguridad (por ejemplo si la extensión se recarga).

`pollSeconds` sigue siendo útil si querés menos tráfico o si el WebSocket no puede abrirse. Los
comandos se entregan en lote: si tocás tres botones seguidos, se ejecutan los tres en la misma
entrega. El dashboard muestra el chip "Extensión SSN: conectada vNN · instantánea" cuando el enlace
está activo, y "· por consulta" cuando está usando el respaldo.

Importante: si el chip muestra una versión vieja (por ejemplo v19 cuando el archivo ya es v26),
quedó una pestaña de SocialStream Ninja abierta con el código anterior. Recargá la extensión en
`brave://extensions` → Actualizar y recargá también esa pestaña.

## Archivos de esta carpeta

| Archivo | Contenido |
| --- | --- |
| `spotify-settings.json` | Fuente única de verdad de los ajustes (lo escribe el backend) |
| `spotify-aliases.json` | Correcciones de escritura aprendidas (`laberiso` → `la beriso`) |
| `spotify-vocabulary.json` | Vocabulario del bot: palabras clave, verbos, géneros, correcciones y config del cerebro |
| `spotify-training.html` | La interfaz de entrenamiento |
| `spotify-request-log.json` | Últimos 50 pedidos con resultado |
| `spotify-devices.json` | Último reporte de dispositivos Spotify de la extensión |
| `spotify-dashboard.html` | La interfaz |

El backend vive en `Control Cortex/backend/server.js` y expone:

```
GET  /api/spotify-status            estado completo para el dashboard
GET  /api/spotify-settings          ajustes actuales
POST /api/spotify-settings          guarda ajustes (parcial o completo)
POST /api/spotify-settings-reset    vuelve a los valores por defecto
GET  /api/spotify-client-state      poll de la extensión (ajustes + comando pendiente)
POST /api/spotify-test-request      encola "reproducir este tema"
POST /api/spotify-simulate-comment  encola un comentario de prueba
POST /api/spotify-transport         pause | resume | next | previous | devices
POST /api/spotify-request-log       la extensión reporta cada pedido
POST /api/spotify-devices-report    la extensión reporta los dispositivos
GET  /api/spotify-vocabulary        como esta entrenado el bot (palabras, verbos, generos, IA)
POST /api/spotify-vocabulary        guarda el vocabulario editado
POST /api/spotify-vocabulary-reset  vuelve al vocabulario por defecto
POST /api/spotify-ai-interpret      cerebro: interpreta un comentario con la IA configurada
GET  /api/spotify-aliases           correcciones de escritura guardadas
POST /api/spotify-aliases           guarda una correccion {from, to}
POST /api/spotify-aliases-delete    quita una {from}
POST /api/spotify-aliases-clear     vacia todas
GET  /api/spotify-device-target     compatibilidad (panel viejo de Cortex)
POST /api/spotify-device-target     compatibilidad
GET  /api/spotify-playback-offset   compatibilidad
POST /api/spotify-playback-offset   compatibilidad
```

Los tres endpoints viejos siguen funcionando y escriben sobre el mismo archivo de ajustes
(`Control Cortex/backend/spotify-device-target.json` y `spotify-playback-offset.json` quedan
como espejo de solo lectura para no romper nada).

## Cómo llegan los ajustes a la extensión

El módulo `Control Cortex/integrations/spotify-auto-music/spotify-auto-music.js` (v26) consulta
`/api/spotify-client-state` cada 4 segundos con `?alive=1&version=26&token=<0|1>`. Esa misma
llamada le entrega un comando pendiente del dashboard (probar tema, simular comentario,
transporte) y sirve para que el dashboard muestre "Extensión SSN: conectada".

El backend copia ese archivo a `SocialStream Ninja/local-overrides/` al arrancar. Después de
tocar el módulo hay que reiniciar el backend y recargar la extensión en `brave://extensions`.

## Prueba rápida del flujo completo

1. Abrir el dashboard y verificar "Extensión SSN: conectada" (idealmente "· instantánea").
   Para entrenar el bot: **/rulo-spotify-training.html** → editás las listas y usás el analizador.
2. Encender **Modo prueba (sin esperas)**.
3. Con «Solo analizar» (no reproduce nada) probar frases como `Un tema de laberiso` o
   `Hola matias un temita de los palmeras`: el registro dice qué entendió cada una.
4. Con «Buscar sin reproducir» ver qué tema encuentra Spotify para un nombre mal escrito.
5. En «Simular un comentario del chat» escribir `poneme un tema de Amar Azul` y enviar (esto sí reproduce).
6. Mirar el registro: aparece el pedido con el tema elegido.
7. Repetir el mismo comentario enseguida: en modo prueba no debe decir "Espera 40s".
8. Apagar el modo prueba y repetir dos veces seguidas: la segunda tiene que pedir espera.

## Pestaña "Bot / Rulo" (`/rulo-spotify-bot.html`)

Cómo pide la gente **y** qué contesta el bot. Tres pestañas ahora: **Ajustes** (`/rulo-spotify.html`),
**Entrenamiento** (`/rulo-spotify-training.html`) y **Bot / Rulo** (`/rulo-spotify-bot.html`).

- **Cómo pide la gente**: las mismas listas que la página de entrenamiento (palabras de música, verbos,
  comandos, saludos y muletillas), editables acá también. Guardan en el mismo lugar.
- **Respuestas del bot**: cada momento del pedido es un *contexto* (pedido aceptado, no encontrado, espera
  general, espera del mismo usuario, sin dispositivo, error, aviso mientras busca, comando enviado…) y cada
  contexto tiene **varias respuestas posibles**, una por línea. Se elige una al azar y **el bot no repite las
  últimas** (`recent`, por defecto 4). Si apagás el azar, usa siempre la primera.
- **Datos que se completan solos**: `{nombre}` (el que pidió), `{tema}`, `{artista}`, `{pedido}`, `{busqueda}`,
  `{genero}`, `{segundos}`, `{dispositivo}`, `{accion}`, `{comando}`, `{dispositivos}`, `{entendido}`.
  Si una variante pide un dato que en ese momento no existe (por ejemplo `{genero}` en un pedido de un tema),
  el bot la **saltea** y elige otra.
- Si la variante **no** trae `{nombre}` y la personalización está encendida, se le agrega el nombre delante
  (como antes); si la trae, se usa tal cual.
- **Generar 3 con IA**: pide al cerebro variantes nuevas para ese contexto, en el estilo del streamer, sin
  repetir las que ya están, y las agrega a la lista (se guardan solas). Sin el cerebro configurado avisa qué
  falta, no rompe nada.
- **Vista previa**: muestra cómo quedaría cada contexto con datos de ejemplo ("Matías pidió Costumbres de
  Damas Gratis"), y "Ver 5 seguidas" sirve para comprobar que varía y no repite.

Las respuestas viven en el bloque `responses` de `Rulo/Spotify/spotify-vocabulary.json` (20 contextos, 72
respuestas de fábrica). El módulo de la extensión las lee en vivo por WebSocket: se cambian y el bot las usa
sin recargar nada. Si el archivo no tiene el bloque (instalación vieja), el backend lo agrega solo al arrancar.

## Historial de análisis en SQLite (`spotify-analytics.db`)

Todo lo que pasa con los pedidos queda guardado en `Rulo/Spotify/spotify-analytics.db` para poder
analizarlo después y buscar mejoras. Usa **`node:sqlite`**, que viene dentro de Node: no hay que
instalar nada.

**Qué guarda (`interactions`)** — una fila por cada comentario que llegó, con:

| Qué | Detalle |
| --- | --- |
| Cuándo y en qué sesión | `ts`, `iso`, `session` (cada arranque del backend) |
| Quién y dónde | `requester`, `requester_id`, `platform` (youtube, tiktok, dashboard…) |
| **La pregunta** | `comment` (el texto tal cual lo escribió), `is_request` |
| Cómo lo entendió el bot | `parsed_source` (natural, comando, género, **ia**), `artist`, `title`, `genre`, `query` |
| Qué pasó | `status` (played, notfound, wait_user, wait_global, busy, no_device, error…), `reason`, `seconds` |
| **La respuesta** | `reply_text`, `reply_context` (ok, notFound, waitGlobal…), `reply_variant` (qué variante salió), `reply_random` |
| **Si usó IA** | `ai_interpreted` + `ai_model` (la IA entendió el pedido) y `reply_ai` (la respuesta era una variante escrita por la IA) |
| La música | `track_name`, `track_artist`, `track_uri` |
| Cuánto tardó | `duration_ms` |

**Qué guarda (`events`)** — acciones sueltas: `ai_replies` (variantes generadas con IA),
`vocabulary_saved` (cada cambio de entrenamiento, con los totales), `alias_learned` (correcciones).

**Las canciones que puso Rulo.** Cada tema que suena queda con `track_name`, `track_artist`, `track_uri` y
`track_source`: **`pedido`** (lo pidió alguien) o **`continuacion`** (lo puso Rulo solo, la continuación automática).
Con eso el ranking de más pedidas distingue una cosa de la otra.

**¿Les gustó? (enganche).** Si después de un tema lo **saltan** (`next`/`previous`) o lo **pausan** desde el
dashboard, queda una fila con estado `skipped`/`paused`, el tema y `since_play_ms` (a los cuántos segundos), y el
pedido original de ese tema se marca con `skipped_after = 1`. Así se ve qué canciones conviene evitar y qué
respuestas acompañan mejor. El salto automático de 10 segundos **no** cuenta: es una regla configurada, no una
decisión de la gente.

**Avisos y recordatorio.** El resumen trae `avisos` (tasa de no encontradas ≥ 25 %, un mismo comentario que falla
3+ veces, se salta demasiado, IA apagada con muchos fallos, muchas sin revisar) y `recordatorio` (cuántas
interacciones quedan sin revisar y hace cuántos días). El panel muestra los avisos, un cartel de recordatorio y
un chip **"Análisis: N sin revisar"** en el estado, que se apaga con *Marcar como revisado*.

**Sugerencias con IA.** El botón *Sugerir mejoras con IA* manda los comentarios que no se encontraron al cerebro y
devuelve, por cada uno, qué falló y qué cargar (`alias` para errores de escritura, `palabra` para palabras de
pedido nuevas, `genero`, `cancion`/`artista`). Cada sugerencia se aplica con un clic: suma la corrección
aprendida, la palabra o el género. Sin el cerebro configurado avisa y no toca nada.

**Recordatorio automático (Hermes).** Hay un trabajo programado **"Rulo - recordatorio de analisis"** que corre
**todos los lunes a las 10** y manda este resumen al chat. La lógica del resumen vive en
`Control Cortex/tools/recordatorio-analisis.py` (se puede correr a mano:
`python "Control Cortex/tools/recordatorio-analisis.py" 30`), y el trabajo semanal necesita el **gateway de
Hermes** andando: `hermes gateway install` (una vez, queda autoarrancando) o `hermes gateway run`.

**Cómo verlo**

- En el panel de Spotify, sección **Análisis**: números del período (interacciones, pedidos,
  reproducidas, no encontradas, con espera, con IA) + lo que pidieron y no se encontró + lo más pedido +
  las canciones que puso Rulo (con saltos) + qué se salteó + sugerencias de la IA.
- `GET /api/spotify-analytics?dias=7` → el resumen completo en JSON (incluye `topCanciones`, `tasaSalteo`,
  `respuestas`, `avisos` y `recordatorio`).
- `GET /api/spotify-analytics-rows?dias=30&limite=200&estado=notfound` → las filas.
- `GET /api/spotify-analytics-alerts?dias=7` → solo los avisos.
- `GET /api/spotify-analytics.csv?dias=30` → **CSV** para abrirlo en Excel o Sheets y filtrar a gusto.
- `POST /api/spotify-analytics-reviewed` → marca lo visto (apaga el recordatorio).
- `POST /api/spotify-ai-suggest {dias}` → sugerencias de la IA para lo que no se encontró.

Con eso se ve enseguida dónde mejorar: los comentarios que no se encontraron (van derecho a la lista
de palabras/correcciones), los pedidos repetidos, las canciones que más gustan (y las que se saltean),
los horarios y las plataformas.

> La base **no se sube** a GitHub: tiene los comentarios y los nombres del chat. Está en el `.gitignore`
> del repo y en las exclusiones del subidor.

## Pruebas automáticas

```bash
cd "D:/plugins para mi OBS/Rulo/tests" && npm test
```

`spotify-dashboard-test.js` carga `spotify-dashboard.html` en jsdom, mockea `fetch` y valida
los chips de estado, el guardado de ajustes, el modo prueba, las pruebas manuales y el registro.
`spotify-training-test.js` hace lo mismo con la página de entrenamiento (vocabulario, géneros,
correcciones, analizador y el estado de la instalación).
`spotify-bot-test.js` prueba la pestaña Bot / Rulo: listado editable, respuestas por contexto, azar
sin repetir, vista previa, generación con IA y la recarga cuando el archivo cambia afuera.
`ssn-patcher-test.js` prueba el parcheo de SocialStream Ninja: anclajes con cualquier versión y
comillas, idempotencia y una migración completa en una carpeta temporal.
`spotify-files-test.js` prueba la relectura de los JSON de `Rulo/Spotify` (edición externa, guardado
propio, archivo roto o borrado).
`spotify-responses-test.js` prueba el módulo de respuestas (normalización, limpieza, marca de IA y
detección de errores que el proveedor devuelve con status 200).
`spotify-analytics-test.js` prueba el historial SQLite: guardado, resumen, filas, CSV y que no se
pierda nada al reabrir.

## Si actualizás SocialStream Ninja

Todo lo que Control Cortex necesita dentro de la extensión se re-aplica solo al arrancar el backend,
y esta página (vocabulario, ajustes, correcciones y registro) vive en `Rulo\Spotify`, así que **no
se pierde**. Los pasos están en `Control Cortex\MIGRAR-SOCIALSTREAM.md` y los accesos directos en
`Control Cortex\SSN 1..4 *.bat`. Después de migrar, la sección *Estado de la instalación* de la
página de entrenamiento dice si quedó algo pendiente.

## Editar los JSON a mano (o con una IA)

`spotify-settings.json`, `spotify-vocabulary.json` y `spotify-aliases.json` se pueden editar por fuera:
el backend los relee en cuanto cambian (mira fecha y tamaño, cada 2 segundos y antes de cada consulta),
avisa a la extensión por WebSocket al instante y no hace falta reiniciar nada. Si el archivo está a medio
escribir o tiene un JSON inválido, se sigue usando lo que ya estaba cargado y queda el aviso en el log.

En las páginas: el vocabulario se recarga solo en el formulario cuando el archivo cambió afuera (si no
estás escribiendo en ese momento); los ajustes hacen lo mismo. Si estás editando y algo cambió por fuera,
la página **no** pisa lo que escribiste y te avisa para que aprietes *Recargar del servidor*.

Los archivos, en resumen:

| Archivo | Qué guarda | Se relee solo |
| --- | --- | --- |
| `spotify-settings.json` | esperas, modo prueba, dispositivo, salto de 10 s | sí |
| `spotify-vocabulary.json` | cómo está entrenado el bot (palabras, verbos, géneros, comandos, cerebro IA) | sí |
| `spotify-aliases.json` | correcciones de escritura aprendidas | sí |
| `spotify-request-log.json` | últimos 50 pedidos (lo escribe el backend) | no hace falta |
| `spotify-devices.json` | dispositivos vistos (lo escribe el módulo) | no hace falta |

## Variedad de temas (un tema de un artista, sin decir cuál)

Cuando alguien pide **un artista** (o un género) sin nombrar un tema puntual
("pasame otro tema de Ke Personajes", "poneme cumbia"), el bot **no pone siempre el
mismo**: pide hasta 20 resultados a Spotify y los va sacando de una **bolsa mezclada
por artista**, sin repetir ninguno hasta agotarla. Al agotarse, mezcla de nuevo
salteando los que ya sonaron en la sesión. Los temas con el mismo nombre (el single y
el del disco) cuentan una sola vez, así no suena "lo mismo" dos veces.

- Pedido puntual ("el tema Costumbres de Damas Gratis") → sigue siendo el mejor
  resultado de Spotify, exacto, sin azar.
- Se apaga desde el dashboard: **Variedad de temas → elegir uno al azar**
  (`artistVariety`, encendido de fábrica) y **cuántos resultados mirar**
  (`artistVarietyPool`, 5 a 50, por defecto 20).
- Los pedidos de artista no usan el caché de búsqueda (si no, siempre daría el mismo).
- Cada elección queda en el historial: podés ver qué tema salió por cada artista en
  **Análisis → Las canciones que puso Rulo**.

