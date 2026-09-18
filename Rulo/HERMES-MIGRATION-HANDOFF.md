# Handoff para Hermes Agent: Rulo, Spotify y SocialStream Ninja

Fecha de contexto: 2026-09-18

Este documento permite que Hermes continue el trabajo sin reconstruir el proyecto desde cero. El usuario trabaja en Windows, transmite con OBS y utiliza SocialStream Ninja (SSN) como extension de Brave para recibir chat y controlar Spotify.

## Objetivo del sistema

Hay dos productos conectados:

1. Pedidos de musica desde el chat: las personas escriben pedidos naturales, SSN busca y reproduce en Spotify.
2. Rulo: interfaz propia, separada de SSN, para mostrar respuestas de Anormalia, configurar su apariencia y revisar comentarios/respuestas.

El usuario quiere seguir evolucionando Rulo hacia una mascota animada. No cambiar nombres, rutas ni integraciones de terceros sin revisar las dependencias que se listan abajo.

## Raiz y rutas importantes

Workspace compartido:

`D:\plugins para mi OBS`

Codigo propio y persistente:

| Area | Ruta | Responsabilidad |
| --- | --- | --- |
| Backend central | `Control Cortex\backend\server.js` | Express, WebSocket, APIs, auto-patcher de SSN y configuracion de Rulo. |
| Panel principal | `Control Cortex\frontend\app.js` | Tarjeta Spotify y enlaces/copias de URLs de Rulo. |
| Estilos del panel | `Control Cortex\frontend\style.css` | Estilos de tarjeta Spotify/Rulo. |
| Overlay Spotify | `Control Cortex\frontend\spotify-lyrics-overlay.html` | Now playing, letras y sincronizacion. |
| Modulo de pedidos | `Control Cortex\integrations\spotify-auto-music\spotify-auto-music.js` | Parser, busqueda, cooldown, dispositivo, offset, respuestas y relay Rulo. |
| Fuente Rulo | `Rulo\` | Todo lo especifico de Rulo. Mantener aqui las funcionalidades nuevas. |
| Copia consumida por SSN | `SocialStream Ninja\local-overrides\` | Copias generadas/cargadas por la extension. No editar como fuente principal. |
| Cargador de SSN | `SocialStream Ninja\loader.js` | Debe cargar los overrides una sola vez. |

Archivos actuales dentro de `Rulo`:

| Archivo | Uso |
| --- | --- |
| `rulo-bot-overlay.html` | Fuente Navegador de OBS. Muestra solo respuestas de Anormalia. |
| `rulo-dashboard.html` | Configuracion visual y enlaces de Rulo. |
| `rulo-chat-historial.html` | Tercer dock: comentario de audiencia a la izquierda y respuesta del bot a la derecha. |
| `rulo-chat-relay.js` | Override SSN que replica mensajes no-bot hacia Cortex. |
| `rulo-config.json` | Configuracion persistente visual de Rulo. Fuente unica del nombre visible. |
| `rulo-chat-history.json` | Historial persistente (hasta 200 comentarios, generado por el backend). |
| `rulo-mascota.html` | Prototipo de direcciones visuales para los 6 estados. |
| `assets/` | `states.json` (contrato de estados) y `README.md`. Sin arte todavia. |
| `README.md` | Referencia de URLs, APIs, estados y flujo de trabajo. |
| `HERMES-MIGRATION-HANDOFF.md` | Este documento. |

## URLs y Session ID

Session ID estable actual: `XJ9hQ2JDHH`.

IP LAN actual de la maquina de Cortex: `192.168.4.100`.

| Recurso | URL actual |
| --- | --- |
| Panel Control Cortex | `http://localhost:4000/` |
| Overlay Spotify/letras | `http://192.168.4.100:4000/spotify-lyrics-overlay.html?session=XJ9hQ2JDHH&ln=es&showqueue&lyrics&cortexrelay&style=comic&accent=%239fd50b` |
| Overlay bot Rulo para OBS | `http://192.168.4.100:4000/rulo-bot-overlay.html?session=XJ9hQ2JDHH` |
| Dashboard Rulo | `http://192.168.4.100:4000/rulo-dashboard.html?session=XJ9hQ2JDHH` |
| Historial Rulo | `http://192.168.4.100:4000/rulo-chat-historial.html?session=XJ9hQ2JDHH` |
| Prototipo de mascota | `http://192.168.4.100:4000/rulo-mascota.html?session=XJ9hQ2JDHH` |
| Featured de SSN | `https://socialstream.ninja/featured.html?session=XJ9hQ2JDHH&ln=es&v=3.50.13` |

La IP ya no se mantiene a mano. El backend la detecta al arrancar, la expone en `GET /api/cortex-base-url`, genera `SocialStream Ninja/local-overrides/cortex-base-url.js` y el panel + los overrides la consumen desde ahi:

- `spotify-auto-music.js` / `spotify-cortex-overlay-relay.js` / `Rulo\rulo-chat-relay.js`: usan `window.CORTEX_BASE_URL` con respaldo `192.168.4.100:4000`.
- `Control Cortex\frontend\app.js`: pide la base al backend antes de armar las URLs que se copian para OBS.
- Override manual: variable de entorno `CORTEX_BASE_URL=http://<ip>:4000` al arrancar el backend.
- Pendiente solo si cambia la IP: los enlaces ya pegados en OBS y la documentacion guardada.

## Flujo de datos

```text
Chat de audiencia
  -> SocialStream Ninja background
  -> spotify-auto-music.js interpreta pedido
  -> Spotify Web API/controla dispositivo
  -> SSN publica respuesta Anormalia en dock normal
  -> relay HTTP /api/rulo-bot-message
  -> Cortex WebSocket
  -> rulo-bot-overlay.html y rulo-chat-historial.html

Chat de audiencia
  -> sendToDestinations de SSN
  -> rulo-chat-relay.js (solo mensajes no-bot)
  -> /api/rulo-chat-message
  -> Cortex WebSocket
  -> rulo-chat-historial.html
```

El backend busca el comentario mas reciente sin respuesta del mismo solicitante durante 120 segundos y le asocia la respuesta de Anormalia. La respuesta usa el primer nombre; el comentario puede tener nombre completo. La comparacion admite que `Matias` corresponda a `Matias Moreira`.

## Spotify: comportamiento implementado

El bot visible se llama `Anormalia`. El texto fijo `Anormalia 22` en el overlay de letras es el nombre elegido por el usuario para ese programa; no reemplazarlo por un estado de Spotify.

El modulo acepta pedidos naturales, entre otros:

```text
poneme Yo Tomo Licor de Amar Azul
quiero el tema de Estrelar - Marcos Valle
tema Los Dias Que No Estas - Barbi Recanati
quiero escuchar Ke Personajes
pone un tema del Polaco
pone un tema de El Polaco
pone un tema Los del Fuego
pone algo de cumbia
pone un tema de rock
pone algun tema romantico
```

Caracteristicas actuales:

- Cooldown global por defecto de 40 segundos y cooldown individual de 120 segundos.
- Seleccion de dispositivo remoto configurable desde Cortex. El dispositivo usado por el usuario es `NOTEBOOK-MATI`.
- Comando `!spotifydevices` para diagnosticar dispositivos.
- Comando `!spotifyoffset` para informar el salto configurado.
- Offset configurable de 1 a 120 segundos; se inicia la pista desde ese segundo y salta al siguiente antes del final.
- Proteccion contra seek tardio: si Spotify ya supero el offset, no vuelve atras la cancion.
- Cola de continuacion: busca una recomendacion/alternativa cuando acaba una pista solicitada.
- La respuesta exitosa debe conservar esta voz: `Listo Matias, ya se esta reproduciendo: ...`.
- Respuestas de pedido incluyen el primer nombre, por ejemplo: `Marcos, ya pediste un tema hace poco. Espera 14s.`
- Las respuestas del modulo se publican tambien en Rulo mediante `postRuloBotResponse`.

Limitacion conocida: el cliente Spotify de Microsoft Store no fue confiable para el control remoto; Spotify Web funciono mejor. No cambiar este supuesto sin una prueba real con el dispositivo de emision.

## Overlay Spotify y letras

`spotify-lyrics-overlay.html` recibe estados de Spotify por relay de Cortex y transporte SSN.

Mejoras implementadas:

- Descarta estados antiguos para evitar que barra/letra vuelvan atras.
- Compensa tiempo de transito de red para barras y letras.
- Usa URI/ID de pista, no solo titulo, para detectar cambios.
- Cancela respuestas tardias de LRCLIB para evitar letras de una pista anterior.
- Recibe un aviso de cambio inmediato cuando hay pedido de chat, seguido por confirmacion de Spotify.

No hacer que las letras calculen un offset separado: deben seguir el mismo progreso real que recibe el overlay.

## Rulo: estado y APIs

Configuracion persistida actual en `Rulo\rulo-config.json`:

```json
{
  "botName": "Rulo",
  "accent": "#221a61",
  "avatarLetter": "A",
  "visibleMs": 7000,
  "maxWidth": 760,
  "fontSize": 1.35,
  "panelOpacity": 0.94,
  "showRequester": true,
  "animation": "slide"
}
```

Resuelto el 2026-09-18: `Rulo\rulo-config.json` es la fuente unica de verdad del nombre visible. El backend fuerza `botName` con el valor de la configuracion en `/api/rulo-bot-message` y en `/api/rulo-repeat-response`, y el overlay, el historial y el dashboard lo leen de ahi (se actualiza en vivo con `rulo_config_updated`). Valor elegido por el usuario: `Rulo`. El payload del modulo de Spotify ya no puede pisarlo. El dock propio de SSN sigue usando `spotifyBotName = "Anormalia"` dentro de la extension: es otra superficie y se cambia desde los ajustes de SSN.

APIs de Rulo en `server.js`:

| Metodo | Ruta | Uso |
| --- | --- | --- |
| GET/POST | `/api/rulo-config` | Leer/guardar configuracion; el POST emite `rulo_config_updated`. |
| GET/POST | `/api/rulo-bot-message` | Ultima respuesta del bot y publicacion al overlay. |
| GET/POST | `/api/rulo-chat-messages` / `/api/rulo-chat-message` | Historial temporal de comentarios (maximo 50). |
| POST | `/api/rulo-repeat-response` | Repite una respuesta en el overlay Rulo. |

Eventos WebSocket de Cortex:

- `rulo_bot_message`: una respuesta de Anormalia.
- `rulo_chat_item`: un comentario nuevo o el mismo comentario actualizado con respuesta.
- `rulo_config_updated`: configuracion visual modificada desde dashboard.

## Historial y featured.html

`rulo-chat-historial.html` muestra `chatimg` cuando existe.

Acciones actuales:

- Click en columna de Anormalia: llama `/api/rulo-repeat-response`; vuelve a aparecer en `rulo-bot-overlay.html`.
- Click en comentario de audiencia: intenta enviar el comentario como `overlayNinja` por un iframe oculto de VDO/SocialStream Ninja, hacia peers distintos de `dock`. El payload incluye `id`, `mid`, `chatname`, `chatmessage`, `chatimg`, `type` y `textonly`.

Esto requiere que `featured.html` este abierto con la misma Session ID y que el iframe P2P se conecte correctamente. Es la integracion que Hermes debe probar primero de forma visual: enviar un comentario desde Rulo y confirmar que aparece destacado en featured.html. Si no ocurre, inspeccionar la conexion `connectedPeers` del iframe y comparar con `sendDataP2P` de `SocialStream Ninja\dock.html`.

La URL vieja `rulo-chat-dock.html` redirige 302 a `rulo-chat-historial.html` para no romper enlaces anteriores.

## Auto-patcher de SSN

Al arrancar Cortex, `server.js` hace lo siguiente:

1. Mantiene la `key` de `SocialStream Ninja\manifest.json` para proteger el ID de extension de Brave.
2. Copia los overrides desde fuentes propias hacia `SocialStream Ninja\local-overrides`.
3. Inserta lineas en `SocialStream Ninja\loader.js` si faltan.
4. Elimina cargas duplicadas de `spotify-auto-music.js`.

Overrides esperados:

```text
stable-ssn-session-id.js
spotify-auto-music.js
spotify-cortex-overlay-relay.js
rulo-chat-relay.js
```

Actualmente el loader debe incluir una sola vez:

```text
./local-overrides/spotify-auto-music.js?v=18
./local-overrides/rulo-chat-relay.js?v=1
```

Despues de modificar cualquier override:

1. Reiniciar `Control Cortex\backend\server.js` para ejecutar el auto-patcher si corresponde.
2. Abrir `brave://extensions`.
3. Pulsar `Actualizar` en SocialStream Ninja.
4. Recargar los Browser Sources de OBS que correspondan.

## Arranque y verificacion

Backend:

```powershell
Set-Location 'D:\plugins para mi OBS\Control Cortex\backend'
node server.js
```

Comprobaciones utiles:

```powershell
node --check 'D:\plugins para mi OBS\Control Cortex\backend\server.js'
node --check 'D:\plugins para mi OBS\Control Cortex\integrations\spotify-auto-music\spotify-auto-music.js'
Invoke-RestMethod 'http://127.0.0.1:4000/api/rulo-config'
Invoke-RestMethod 'http://127.0.0.1:4000/api/rulo-chat-messages'
```

No imprimir ni copiar secretos en documentos, chats, commits o logs. El backend contiene configuracion de OBS mediante variables de entorno y valores locales; Hermes debe tratarlos como secretos.

Actualizado el 2026-09-18: las credenciales de OBS WebSocket ya no estan en el codigo. Viven en `Control Cortex\backend\.env` y `Bienvendos y Banner\.env` (gitignoreados), que cada `server.js` carga con `loadEnvFile` (parser propio, sin dependencias). `Bienvendos y Banner\settings.json` quedo con `obsPassword` vacio y usa el `.env` como respaldo. El historial de git nunca contuvo el valor (verificado sobre HEAD).

## Recomendaciones de subagentes/mini-agentes

Usar agentes con responsabilidades separadas. Evitar que un agente de UI modifique los relays de SSN sin una prueba de integracion.

| Subagente sugerido | Responsabilidad | Entregable |
| --- | --- | --- |
| `rulo-ui` | Dashboard, overlay, historial, futura mascota y accesibilidad. | Cambios solo en `Rulo\` y pruebas visuales. |
| `ssn-integracion` | Overrides, loader, Session ID, relays y featured P2P. | Prueba de extension recargada y listado exacto de scripts cargados. |
| `spotify-flujo` | Parser natural, busqueda, dispositivos, cooldown, offset y cola. | Casos de prueba de texto y prueba de reproduccion real. |
| `cortex-backend` | APIs Express, WebSocket, persistencia, validacion y migraciones. | Pruebas de endpoints y compatibilidad de configuracion. |
| `qa-stream` | Pruebas end-to-end en Brave, SSN, OBS y Spotify Web. | Checklist de resultados y capturas si es necesario. |
| `seguridad-config` | Revision de secretos, CORS, limites de payload y datos del chat. | Lista de riesgos y cambios minimos recomendados. |

## Skills recomendadas para Hermes

| Skill | Cuando usarla |
| --- | --- |
| `computer-use` | Para actualizar extension de Brave, abrir overlays, comprobar featured.html y validar OBS visualmente. |
| `visualize` | Para prototipar los estados de la futura mascota y probar transiciones antes de codificarlas. |
| `imagegen` | Solo cuando se necesite crear bitmap/sprites/expresiones para la mascota. Guardar assets dentro de `Rulo\assets\`. |
| `plugin-management` | Si Hermes necesita descubrir una integracion nueva o evaluar un plugin externo. |

No hace falta usar `imagegen` hasta que el usuario elija una direccion artistica para la mascota. Para el estado actual, HTML/CSS/JS es suficiente.

## Plugins/recomendaciones externas

- Spotify: opcional. La integracion actual ya controla Spotify mediante SSN y la Web API; instalar un plugin solo si Hermes necesita consultar catalogo o acciones de cuenta fuera del flujo existente.
- GitHub: recomendable si el usuario decide versionar/respaldar el codigo propio (`Rulo`, `Control Cortex\integrations`, y cambios controlados de backend).
- Figma: opcional para definir visualmente la mascota antes de implementarla.
- Codex Security: recomendable antes de exponer Cortex fuera de la LAN o compartir el proyecto, porque existen relays HTTP locales y datos de chat.

## Siguiente trabajo recomendado

Prioridad alta:

1. [pendiente de prueba manual] Probar end-to-end el click de comentario de Rulo hacia `featured.html` con ambos abiertos en la misma Session ID. El historial ya muestra "Peers P2P: N" y avisa cuando no hay peers, asi que la prueba dice en el acto si el puente funciona.
2. [hecho] `rulo-chat-relay.js` y `cortex-base-url.js` aparecen en `loader.js` una sola vez; falta el paso manual de recargar la extension en `brave://extensions`.
3. [hecho] Estado de conexion visible en el historial (WS + peers P2P + aviso sin peers + feedback al destacar).

Prioridad media:

1. [hecho] URL base centralizada (`cortex-base-url.js` generado + `/api/cortex-base-url` + respaldo en cada override).
2. [hecho] Historial persistente en `Rulo\rulo-chat-history.json` (200 en disco, 50 al cliente).
3. [hecho] Filtros por texto, plataforma y "solo sin respuesta", con contador visible.
4. [hecho] Limpiar historial con confirmacion en dos pasos y repetir respuesta con aviso en pantalla.

Preparacion de mascota:

1. [hecho] `Rulo\assets\` creado con manifiesto de estados: `idle`, `thinking`, `success`, `warning`, `error`, `speaking` (`assets/states.json`).
2. [hecho] Campo `mood` emitido en `rulo_bot_message`, validado en el backend y consumido por el overlay (color, animacion y asset `/rulo-assets/<estado>.svg`).
3. [hecho] La mascota queda fuera de SSN: assets, CSS y logica siguen siendo de Rulo.
4. [pendiente de decision] Elegir la direccion visual en `rulo-mascota.html` y generar los seis SVG.

## Cambios aplicados el 2026-09-18

Backend (`Control Cortex\backend\server.js`):

- `botName` con fuente unica de verdad en `rulo-config.json`; el payload ya no lo pisa.
- Campo `mood` validado en `/api/rulo-bot-message` y `/api/rulo-repeat-response` (`idle|thinking|success|warning|error|speaking`).
- Historial persistente en `Rulo\rulo-chat-history.json` (200 en disco, 50 servidos, escritura con retardo de 400 ms).
- Nuevo `POST /api/rulo-chat-clear` y evento WS `rulo_chat_cleared`.
- Nuevo `GET /api/cortex-base-url`; deteccion de IP LAN y generacion de `local-overrides/cortex-base-url.js` desde el auto-patcher, con dedupe de la linea en `loader.js`.
- Rutas nuevas: `/rulo-mascota.html` y `/rulo-assets/*`; `showMascot` agregado a la configuracion.

Overrides y panel:

- Los tres overrides resuelven la base con `window.CORTEX_BASE_URL` y respaldo hardcodeado.
- El modulo de Spotify emite `mood` por caso: `idle` en comandos informativos, `warning` en cooldown o pedido mal armado, `error` en fallo real, `success` cuando reproduce.
- `frontend/app.js` pide `/api/cortex-base-url` y re-renderiza la tarjeta de Spotify sin duplicarla.

Interfaz de Rulo:

- Overlay: nombre desde la configuracion, color/animacion por estado, slot de mascota con `/rulo-assets/<estado>.svg` y respaldo a la inicial, `?preview=1&mood=` para probar sin OBS.
- Historial: chips de estado (WS y peers P2P), filtros, contador, limpieza con confirmacion, marcas de hora y fuente, aviso cuando no hay peers.
- Dashboard: check de mascota, selector de estado en la vista previa, enlaces al prototipo y textos sin "Anormalia" fijo.
- Nuevos: `rulo-mascota.html` y `assets/states.json` como contrato de la futura mascota.

Hermes (este entorno):

- MCPs instalados y habilitados: `semgrep` y `figma` (piden autorizacion OAuth la primera vez: `hermes mcp login semgrep` / `hermes mcp login figma`).
- Skills de la guia: `computer-use` y `github` ya vienen builtin; `visualize`, `imagegen` y `plugin-management` no existen con esos nombres en Hermes (el relevamiento de plugins lo cubre la skill `hermes-agent`).

Accion manual pendiente:

- Recargar la extension en `brave://extensions` y las Browser Sources de OBS para tomar los overrides nuevos.
- Probar el destacado P2P contra `featured.html`.
- Autorizar `semgrep` y `figma`.

## Regla de trabajo

No revertir cambios existentes del usuario ni reemplazar archivos de SocialStream Ninja completos. Usar overrides, el auto-patcher y cambios pequenos. Antes de cerrar una tarea, verificar sintaxis, recargar extension si se modifico un override y probar los overlays relevantes.
