# Instrucciones para Chat Bot Spotify

Estas reglas aplican a todo este módulo y complementan [`../AGENTS.md`](../AGENTS.md). Antes de cambios con efectos en Spotify, Facebook, Rulo o la Ruleta, lee también [`README.md`](README.md) y las referencias indicadas abajo.

## Propiedad y arquitectura

- El servidor propio vive en `server.js`; el procesamiento de pedidos, reproducción y cola vive en `src/spotify.js`.
- La extensión MV3 captura solo lo que Facebook renderiza en el DOM. No depende de SocialStream Ninja para Facebook ni debe apropiarse de sus sesiones, WebSocket o relay P2P.
- Los eventos conservan el contrato de chat usado por Cortex y Comentarios/Ruleta. Mantén identidad, cuenta, pestaña y transmisión de origen cuando estén disponibles.
- La fuente permanente del archivo de audiencia es SQLite en Cortex (`Rulo/Spotify/spotify-analytics.db`), no un export JSON. Este módulo no debe implementar consultas históricas por su cuenta ni guardar copias divergentes.
- Los avatares locales y el historial reciente pertenecen a Cortex/Rulo. Respeta sus rutas y APIs.

## Reproducción de Spotify: regla obligatoria

Los pedidos usan el OAuth propio de Chat Bot Spotify y la cola local serializada. No uses SocialStream Ninja ni su consumidor de comandos para pedidos actuales.

Para reproducir un tema pedido por una persona:

1. Consulta el reproductor y la cola actuales.
2. Si la pista ya suena, no la agregues otra vez.
3. Agrega su URI una sola vez a `/me/player/queue`.
4. Confirma que el pedido esté primero en la cola. Si otra pista lo bloquea, informa cuál es y no saltes el orden.
5. Ejecuta `/me/player/next` solo después de confirmar la cola.
6. Confirma en `/me/player` la URI, el dispositivo seleccionado y `is_playing` antes de anunciar éxito.

**No reemplaces este flujo por `PUT /me/player/play` para un pedido.** Un HTTP 204 solo confirma que Spotify aceptó la solicitud; el cliente de escritorio puede seguir reproduciendo la pista anterior. Nunca anuncies éxito sin la verificación final.

Si se aplica un offset, silencia y confirma el silencio, busca y confirma la posición, reanuda si corresponde y restaura siempre el volumen original en `finally`. Si no se confirma el silencio o no se restaura el volumen, comunica el fallo y no dejes el dispositivo silenciado.

## Panel `/rulo-spotify.html`

- El dashboard está en `Rulo/Spotify/spotify-dashboard.html` y se sirve desde Cortex como `/rulo-spotify.html`.
- Búsqueda, reproducción de prueba, comentario simulado, controles y dispositivos pasan por el proxy de `Control Cortex/backend/server.js`. El proxy lee el bearer token localmente de `Chat Bot Spotify/data/config.json`; no lo envíes al navegador, a URL, logs o prompts.
- No conectes acciones nuevas a `queueSpotifyCommand` ni a `/api/spotify-client-state`. Son compatibilidad con el consumidor antiguo de SSN, no el transporte de los pedidos actuales.
- El interruptor **Pedidos de música por chat** sincroniza `spotifyEnabled` del módulo propio.
- Las pruebas de reproducción y los comentarios musicales simulados requieren Modo de pruebas aislado. Deben suprimir escrituras al historial normal, SQLite de audiencia, Ruleta y registro normal. La vista previa busca sin tocar el reproductor ni consumir cooldowns.

## Simulación histórica de Rulo

Antes de tocar la simulación **Streaming en VIVO** en `/rulo-hablar.html`, lee [`../Rulo/README-SIMULACION-VIVOS.md`](../Rulo/README-SIMULACION-VIVOS.md). Conserva el participante como contexto, el detector compartido de música, la cola FIFO y los cooldowns en memoria separados por programa. El bearer token y el OAuth nunca entran en la página o el prompt.

La simulación puede usar Spotify solo por la ruta explícita de reproducción aislada. Sus comentarios y respuestas son temporales; no los escribas en el historial de audiencia, SQLite, Ruleta ni registro normal. La lotería queda estrictamente en solo lectura: rechaza reservas, selección de números y cualquier escritura. Las correcciones guardadas en Entrenamiento e IA son manuales; la simulación no entrena por sí sola.

**Rulator** es la caja virtual y el mecanismo principal de simulación de `/rulo-hablar.html`; **Rulo** es el bot/personaje de IA que conversa dentro de esa sala. Los pedidos musicales reproducen en Spotify por defecto mediante `POST /api/spotify-simulate-comment` y el flujo de cola serializada; requieren Modo de pruebas aislado global confirmado y preservan el nombre/ID archivado solo dentro del servidor. No escriben historial, registros ni aprenden aliases/selección. **Vista previa** usa `POST /api/spotify/intent-preview`, busca sin reproducir ni consumir cooldowns. Mantén OAuth y bearer token dentro del servidor y nunca anuncies reproducción sin confirmar tema, dispositivo e `is_playing`.

## Premios de la Ruleta

La entrega de tickets extra es responsabilidad de `comentarios` y del proxy/callable de Cortex/Cdelu, no del parser o la cola de Chat Bot Spotify. Un giro no debe iniciar una entrega de premio. El operador selecciona y confirma el premio desde **Asignar premio** en el overlay de la Ruleta; las vistas previas y el Modo de pruebas aislado no pueden otorgar tickets.

## Referencias

- [`README.md`](README.md): arranque, APIs, extensión, persistencia e integración actual.
- [`../README.md`](../README.md): arquitectura y mapa del proyecto completo.
- [`../CONTEXTO DE TODO PRINCIPAL.md`](../CONTEXTO%20DE%20TODO%20PRINCIPAL.md): handoff y estado global.
- [`../Control Cortex/integrations/spotify-auto-music/README.md`](../Control%20Cortex/integrations/spotify-auto-music/README.md): comportamiento Spotify Desktop conservado.

Después de cambiar el módulo, identifica qué procesos y páginas necesitan reinicio o recarga. No mezcles cambios de archivos locales ajenos ni publiques credenciales.
