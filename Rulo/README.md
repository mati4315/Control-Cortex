# Rulo

Espacio independiente para las funciones y overlays propios del bot. Todo lo nuevo de Rulo vive acá; SocialStream Ninja solo consume copias vía `local-overrides`.

## Páginas (servidas por Control Cortex en el puerto 4000)

| Página | URL | Uso |
| --- | --- | --- |
| Overlay de respuestas | `http://192.168.4.100:4000/rulo-bot-overlay.html?session=XJ9hQ2JDHH` | Fuente Navegador de OBS. Solo respuestas del bot. |
| Dashboard | `http://192.168.4.100:4000/rulo-dashboard.html?session=XJ9hQ2JDHH` | Configuración visual, URLs para OBS y vista previa por estado. |
| Historial | `http://192.168.4.100:4000/rulo-chat-historial.html?session=XJ9hQ2JDHH` | Comentarios de audiencia + respuestas, con filtros y limpieza. |
| Prototipo de mascota | `http://192.168.4.100:4000/rulo-mascota.html?session=XJ9hQ2JDHH` | Direcciones visuales de los 6 estados (no va a OBS). |
| Dashboard de Spotify | `http://192.168.4.100:4000/rulo-spotify.html` | Ajustes del cambio automático de música: esperas, modo prueba sin esperas, dispositivo, pruebas y registro. |
| Entrenamiento del bot | `http://192.168.4.100:4000/rulo-spotify-training.html` | Vocabulario (palabras clave, verbos, géneros, correcciones) con analizador en vivo y el cerebro (IA) opcional. |
| Redirección legada | `http://192.168.4.100:4000/rulo-chat-dock.html` | 302 a `rulo-chat-historial.html` para no romper enlaces viejos. |

La URL base ya no está escrita a mano en varios archivos: el backend la detecta (`GET /api/cortex-base-url`) y genera `SocialStream Ninja/local-overrides/cortex-base-url.js` en cada arranque. Si cambia la IP LAN, se actualiza sola (los overrides la consumen con respaldo).

## Nombre visible: una sola fuente de verdad

`Rulo/rulo-config.json` manda. El payload del módulo de Spotify ya **no** puede pisar el nombre del overlay: el backend fuerza `botName` con el valor de la configuración (`POST /api/rulo-config` desde el dashboard).

- El nombre del overlay, del historial y del dashboard sale de `rulo-config.json`.
- El dock propio de SocialStream Ninja sigue usando `spotifyBotName = "Anormalia"` dentro de la extensión: es otra superficie y se cambia desde los ajustes de SSN, no desde Rulo.
- El texto fijo `Anormalia 22` del overlay de letras es el nombre del programa elegido por el usuario; no lo toca nada.

## Estados (mood) de la mascota

El evento `rulo_bot_message` incluye `mood`, que el backend valida contra esta lista exacta:

```text
idle | thinking | success | warning | error | speaking
```

| Estado | Cuándo |
| --- | --- |
| `idle` | Comandos informativos (`!spotifydevices`, `!spotifyoffset`). |
| `thinking` | El pedido entro a buscar en Spotify (aviso provisorio: se ve en el overlay y no queda en el historial). |
| `success` | Tema encontrado y reproduciendo. |
| `warning` | Cooldown activo o pedido mal armado. |
| `error` | Tema no encontrado, dispositivo ausente o fallo de reproducción. |
| `speaking` | Repetición de una respuesta desde el historial. |

El overlay usa el estado para color, animación y (si está activado) el asset `/rulo-assets/<estado>.svg`. Si falta el asset, cae a la inicial sin romperse. Contrato completo en `assets/states.json` y `assets/README.md`.

## APIs de Rulo (backend)

| Método | Ruta | Uso |
| --- | --- | --- |
| GET/POST | `/api/rulo-config` | Leer/guardar configuración (`botName`, `accent`, `showMascot`, `overlayTheme`, animación, etc.). El POST emite `rulo_config_updated`. |
| GET/POST | `/api/rulo-bot-message` | Última respuesta del bot (con `mood`) y publicación al overlay. |
| GET | `/api/rulo-chat-messages` | Últimos 50 comentarios (`items` + `total`). |
| POST | `/api/rulo-chat-message` | Alta de comentario de audiencia (lo usa `rulo-chat-relay.js`). |
| POST | `/api/rulo-chat-clear` | Vacía historial en memoria y en disco; emite `rulo_chat_cleared`. |
| POST | `/api/rulo-repeat-response` | Repite una respuesta en el overlay (mood `speaking`). |
| GET | `/api/cortex-base-url` | URL base LAN detectada + Session ID. |

Eventos WebSocket: `rulo_bot_message`, `rulo_chat_item`, `rulo_chat_cleared`, `rulo_config_updated`.

## Historial persistente

- Se guardan hasta 200 comentarios en `Rulo/rulo-chat-history.json` (se escriben con retardo de 400 ms para no golpear el disco).
- Al arrancar el backend se restauran; el WS y el GET entregan los últimos 50.
- El botón **Limpiar historial** del historial pide confirmación (segundo clic en 4 s) y borra memoria + archivo.

## Archivos

| Archivo | Uso |
| --- | --- |
| `rulo-bot-overlay.html` | Fuente Navegador de OBS. Acepta `?preview=1&mood=<estado>` y `?theme=light\|dark` (el parametro gana sobre la config) para probar sin OBS. |
| `rulo-dashboard.html` | Configuración visual, URLs para OBS y vista previa por estado. |
| `rulo-chat-historial.html` | Docks de chat: estado P2P (con aviso persistente y marca roja en "Mas Opciones" cuando no hay peers), destacar comentarios y, en el panel inferior "Mas Opciones", los filtros (texto, plataforma, "solo sin respuesta", contador) y "Limpiar historial". La respuesta sin contenido no se muestra (la celda queda invisible y aparece cuando llega). En el centro del encabezado: lupa - / Restablecer / lupa + para el tamano de letra (80%-180%, recordado entre sesiones). El estado (Conectado / Peers P2P) y el link Dashboard viven adentro de "Mas Opciones". Al bajar en el chat el encabezado se oculta (titulo y boton) y queda solo la barra de letra; al subir vuelve a aparecer. Esa barra tiene lupa -, Restablecer y lupa +; en la punta izquierda del encabezado hay una flecha para mostrarlo/ocultarlo a mano y en la punta derecha el boton sol/luna que cambia entre tema oscuro (por defecto) y claro. El tema se recuerda entre sesiones y afecta solo a esta pagina. Filas alternadas: en dos columnas por fila (comentario+respuesta juntos) y, apilado en movil, por celda para que nunca queden dos del mismo color pegados. Header mas claro que el resto. En movil (<=620px) los controles de letra quedan como barra justo arriba del chat. |
| `rulo-mascota.html` | Prototipo de la mascota (6 estados, CSS puro). |
| `rulo-chat-relay.js` | Override SSN que replica mensajes no-bot hacia Cortex. |
| `rulo-config.json` | Configuración persistente de Rulo. |
| `rulo-chat-history.json` | Historial persistente (generado). |
| `assets/` | `states.json` + `README.md` de la mascota (sin arte todavía). |
| `Spotify/` | `spotify-dashboard.html` (ajustes), `spotify-training.html` (entrenamiento del bot), `spotify-settings.json` + `spotify-vocabulary.json` + `spotify-aliases.json` (datos editables) y los generados (`spotify-request-log.json`, `spotify-devices.json`) + su `README.md`. |

## Ajustes de música (Spotify)

La fuente única de verdad de los pedidos de música es `Rulo/Spotify/spotify-settings.json`, controlada
desde `/rulo-spotify.html`. El módulo de la extensión (`spotify-auto-music.js`, v26) consulta
`GET /api/spotify-client-state` cada 4 s: recibe los ajustes en vivo y ejecuta los comandos que
encola el dashboard (probar tema, simular comentario, pausa/siguiente/anterior). Detalle completo en
`Rulo/Spotify/README.md`.

## Después de tocar un override

1. Reiniciar `Control Cortex\backend\server.js` (corre el auto-patcher).
2. Abrir `brave://extensions` → **Actualizar** en SocialStream Ninja.
3. Recargar las Browser Sources de OBS que correspondan.

Comprobar sintaxis antes de recargar:

```bash
node --check "D:/plugins para mi OBS/Control Cortex/backend/server.js"
node --check "D:/plugins para mi OBS/Rulo/rulo-chat-relay.js"
node --check "D:/plugins para mi OBS/Control Cortex/integrations/spotify-auto-music/spotify-auto-music.js"
```

## Pendiente conocido

- El clic en un comentario del historial hacia `featured.html` usa el puente P2P de VDO/SSN: hace falta `featured.html` abierto con el mismo Session ID y al menos un peer distinto de `dock`. El historial ahora muestra "Peers P2P: N" y avisa cuando no hay ninguno.
- No hay arte de mascota todavía (ver `rulo-mascota.html` para elegir dirección).
