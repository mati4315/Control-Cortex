# Instrucciones para agentes del proyecto

## Reproducción de pedidos de Spotify: regla obligatoria

La implementación vigente está en `Chat Bot Spotify/src/spotify.js`. Chat Bot Spotify debe controlar la reproducción con su propio OAuth y su cola local serializada; no debe depender de SocialStream Ninja ni del consumidor de comandos integrado en SSN.

Para iniciar una pista pedida por una persona, conserva el flujo de Spotify Desktop documentado en `Control Cortex/integrations/spotify-auto-music/README.md` y aplicado al módulo propio:

1. Consulta el reproductor y la cola actuales.
2. Si la pista ya está sonando, no la vuelvas a agregar.
3. Agrega la URI a `/me/player/queue` una sola vez.
4. Confirma que la pista pedida sea la primera de la cola.
5. Solo entonces ejecuta `/me/player/next`.
6. Confirma en `/me/player` que la URI pedida esté sonando en el dispositivo seleccionado antes de anunciar éxito.

**No reemplaces este flujo por `PUT /me/player/play` para pistas pedidas.** Spotify Desktop puede responder HTTP 204 y dejar la pista anterior sonando. Un 204 confirma que la API aceptó la petición, no que el cliente cambió de tema. Nunca anuncies “reproduciendo” sin verificar la URI, el dispositivo y `is_playing`.

Si otra pista aparece antes en la cola, no avances a ciegas: informa cuál es la pista que bloquea el pedido y no alteres el orden saltándola. Evita agregar una copia del mismo pedido si ya aparece en la cola.

Cuando se aplica un offset inicial, silencia y confirma el silencio antes del salto, busca y confirma la posición, reanuda si corresponde y restaura siempre el volumen original en `finally`. Si no se puede confirmar el silencio o restaurar el volumen, informa el fallo; no dejes el dispositivo silenciado.

El modo aislado pausa los pedidos automáticos de Facebook. La reproducción manual de prueba debe seguir usando la ruta explícita de reproducción aislada para no introducir comentarios en el historial ni en la Ruleta.

El panel `Rulo/Spotify/spotify-dashboard.html` se sirve como `/rulo-spotify.html`. Sus acciones de
buscar, reproducir prueba, simular comentario, controlar transporte y consultar dispositivos deben
pasar por el proxy de `Control Cortex/backend/server.js` hacia la API de `Chat Bot Spotify`; el
proxy lee el bearer token localmente desde `Chat Bot Spotify/data/config.json` y no lo envía al
navegador. No vuelvas a mandar esos controles a `queueSpotifyCommand` ni a
`/api/spotify-client-state`: esa cola solo existe para compatibilidad con el consumidor antiguo de
SSN. El interruptor «Pedidos de música por chat» de ese dashboard sincroniza el `spotifyEnabled`
del módulo propio. Las pruebas de reproducción requieren modo aislado, y tanto los comentarios
simulados como las pruebas de tema deben suprimir escrituras al historial, la Ruleta y el registro
normal.

Referencias: `Chat Bot Spotify/README.md`, `CONTEXTO DE TODO PRINCIPAL.md` y la sección **Spotify Desktop en Windows: conservar la playlist al cambiar el tema** del README de Spotify Auto Music.

## Captura Facebook y trazabilidad

Chat Bot Spotify mantiene Facebook como única plataforma propia de captura dentro del alcance actual. Cada comentario recibe un `traceId` aleatorio que se conserva al pasar por Cortex, Rulo y Spotify. La telemetría de `/api/event-traces` solo puede guardar categorías técnicas aprobadas; no agregues texto, nombres, IDs de usuario, URLs de perfil ni tokens. El búfer vive en memoria de Cortex y la vista `/event-traces.html` requiere origen local.

## Evaluación repetible de Rulo

La suite de casos guardados se ejecuta desde Simular Streaming en VIVO con Modo de pruebas aislado confirmado. La suite fuerza Spotify en vista previa y el módulo OBS apagado; no puede reproducir audio, escribir en la conversación de OBS ni cambiar el historial de audiencia o la Ruleta. Cada resultado queda pendiente de revisión humana; no marques casos aprobados ni guardes entrenamiento automáticamente.

El módulo IAFAS requiere `ADMIN_PASSWORD_HASH` bcrypt, `JWT_SECRET` y `CRON_SECRET` seguros. No restaures credenciales predeterminadas ni contraseñas en texto plano. En producción, configura orígenes CORS/WebSocket exactos; no habilites `*`.

## Audiencia SQLite, Ruleta y premios manuales

El archivo permanente de audiencia está en `Rulo/Spotify/spotify-analytics.db`; `audience_comments` y `user` son su base de consultas históricas. `Rulo/rulo-chat-history.json` conserva solo el historial visual reciente y no sustituye SQLite. Las personas se vinculan por identidad estable cuando existe; no fusiones filas solo por el nombre. `facebook_user_id` y `ID_facebook` son campos distintos; no inventes ni completes `ID_facebook` sin la fuente verificada que indique el usuario. Los avatares viven en `Rulo/profile-avatars/` y se sirven por las APIs de Cortex.

La Ruleta de Participantes (`comentarios`, puerto 9742) obtiene participantes únicos desde el historial SQLite de Rulo. Sus premios configurables son definiciones habilitadas o pausadas en el dashboard. **Los giros no asignan premios automáticamente:** solo el operador puede pulsar **Asignar premio** debajo del ganador, elegir una definición disponible y confirmar la lotería y cantidad de tickets. La UI muestra progreso y resultado. El servidor valida un ganador real y confirmado, busca su identidad en `comentarios/runtime-private/prize-identities.json` y llama a Cortex; no filtres ni mandes el ID privado al navegador o a la IA.

No otorgues premios en vistas previas ni con Modo de pruebas aislado activo. Mantén la idempotencia por giro y premio (`spinId` + `prizeId`) para que un reintento no aplique dos veces los tickets. La entrega se hace por la ruta local de Cortex y la función callable de Firebase que reutiliza la lógica existente de tickets extra de Cdelu. No inventes un acceso directo desde la página a Firestore ni copies otra vez la lógica de excepciones. Esta asignación manual real es distinta de la simulación histórica: en `/rulo-hablar.html`, lotería sigue siendo estrictamente solo lectura y ninguna reserva, selección o escritura está permitida.

El historial del dashboard de la Ruleta permite corregir el total de tickets extra de una entrega confirmada. Consulta siempre el valor vigente en Cdelu antes de habilitar el guardado; registra cada corrección en `lottery_roulette_prize_adjustments` y en `rulo_roulette_ticket_adjustments` de SQLite. Mantén la llamada web detrás de Cortex y de la función callable autenticada; no expongas IDs internos. El ajuste fija el cupo extra total (0–200), no elimina números ya seleccionados ni cambia el límite base de la lotería. La SQLite local conserva la auditoría y el historial local refleja la última corrección.

Al cambiar estas reglas, actualiza la documentación general (`README.md`, `CONTEXTO DE TODO PRINCIPAL.md`) y la específica del módulo afectado.

## TriggerStudio y WebSocket de OBS

Si /api/trigger-studio/connection/test dice que no responde 192.168.4.150:4455, distingue la conectividad de red del puerto: si la PC de OBS responde al ping pero TCP 4455 no conecta, comprueba que OBS esté abierto y que Herramientas > Ajustes del servidor WebSocket tenga el servidor habilitado en el puerto 4455; después revisa el Firewall de Windows de la PC con OBS. Un ping exitoso por sí solo no confirma que WebSocket esté escuchando.

En la configuración actual, Cortex usa la IP LAN 192.168.4.100 y la PC con OBS 192.168.4.150. En la PC con OBS se puede volver a crear la regla acotada a Cortex ejecutando como Administrador [Reparar-WebSocket-OBS.bat](activar%20en%20pc%20con%20obs%20Reparar-WebSocket-OBS.bat). La regla permite entrada TCP al puerto 4455 solamente desde 192.168.4.100; si cambia la IP de Cortex, actualiza CORTEX_IP en el BAT. Para Tailscale, permite la IP Tailscale de Cortex en una regla correspondiente.

La regla de Firewall no activa el servidor WebSocket de OBS. Mantén la autenticación habilitada y usa en OBS la misma contraseña que OBS_WS_PASSWORD en Trigger Studio/server/.env. Después verifica desde Cortex; la respuesta esperada es: Conexión WebSocket autenticada con OBS en 192.168.4.150:4455.

## Simulación de vivos históricos de Rulo

Antes de cambiar **Simular Streaming en VIVO** de `/rulo-hablar.html`, lee `Rulo/README-SIMULACION-VIVOS.md`. Su propósito es probar preguntas hipotéticas con el contexto de comentarios archivados y mejorar a Rulo mediante casos de evaluación y correcciones guardadas manualmente en Entrenamiento e IA. Mantén los mensajes en las rutas aisladas, el papel contextual de la persona seleccionada y la lotería habilitada estrictamente en solo lectura. No permitas escrituras, reservas ni selección de números. La simulación no entrena el modelo automáticamente. Identifica como actual la grilla no archivada; solo presenta una captura de un programa como histórica si está marcada y documentada como verificada.

Los pedidos musicales de la simulación deben pasar por Cortex hacia la ruta de comentario de prueba aislada de Chat Bot Spotify, conservando el nombre y el ID archivado del participante. Usa el detector musical compartido de Chat Bot Spotify, no un regex de Cortex. La vista previa debe buscar sin tocar el reproductor ni consumir cooldowns. La reproducción real requiere Modo de pruebas aislado; Cortex debe leer el bearer token local y Chat Bot Spotify debe usar su propio OAuth y el flujo verificado de cola de Spotify; nunca expongas esos tokens al navegador ni al prompt de IA. Mantén encendidos Rulo y los interruptores de captura/pedidos del chat. Reproduce la cola FIFO y los cooldowns global y por persona configurados, en estado temporal aislado por programa; el reloj virtual permite 1× o 10× sin afectar los datos de ritmo de la transmisión real. Los casos de evaluación y sus resultados, y las capturas de lotería, viven en tablas SQLite separadas del historial de audiencia.
