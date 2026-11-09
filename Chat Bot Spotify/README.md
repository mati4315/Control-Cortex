# Chat Bot Spotify

## Live Producer: estadísticas y comentarios (1.5.1)

En el popup de la extensión pega el enlace del video o de Live Producer y pulsa **Abrir estadísticas y comentarios**.
El botón abre `/live/producer/v2/ID/insights` y `/live/producer/dashboard/ID/COMMENTS/` en pestañas separadas
del mismo perfil de navegador. También acepta un enlace `/live/producer/dashboard/ID/STREAM_STATS/`; al pegarlo,
usa esa ruta como fuente de métricas alternativa y abre igualmente la pestaña de comentarios. La vista de comentarios
se procesa como otra fuente DOM. Necesitas una sesión con acceso a ese directo y mantener las pestañas abiertas.
El servidor local no inicia sesión ni obtiene estadísticas privadas por su cuenta.

La lectura se realiza cada 5 segundos sobre las etiquetas visibles. Facebook puede actualizar los
indicadores con retraso, especialmente si suspende la pestaña. Un valor ausente se muestra como —;
cero es una lectura válida. Las instantáneas en memoria caducan tras 90 segundos sin lectura.

El lector acepta tanto Insights como `STREAM_STATS`. En esta última vista reconoce espectadores, comentario(s),
reacciones, veces compartido y clips incluso cuando Facebook coloca el número antes de la etiqueta. El panel del
módulo muestra actuales, máximo, reacciones, comentarios, compartidos, clips, reproducciones de 3/15/60 segundos,
estrellas y remitentes. El endpoint autenticado /api/facebook-insights expone los datos
por ID de transmisión. Insights tiene prioridad sobre el contador del video mientras esté vigente.
Una transmisión abierta en varias pestañas se cuenta una sola vez. Directos diferentes se suman;
el total no representa personas únicas entre cuentas.

Cortex conserva los indicadores existentes con la primera transmisión activa y recibe por separado la suma
de espectadores y comentarios de todas las transmisiones Facebook activas. Rulo muestra esa suma junto a los
indicadores originales. Estas estadísticas no crean comentarios ni participantes de Ruleta y no se guardan
en la base de datos. Los datos combinados vencen tras 90 segundos sin lecturas nuevas.
Para usar dos cuentas, abre Estadísticas en cada perfil que tenga acceso a su directo.
Después de actualizar desde una versión anterior, recarga la extensión y las pestañas de Facebook.

Captura local de comentarios de Facebook mediante una extensión de navegador propia. No usa SocialStream Ninja, su WebSocket, su extensión, sus sesiones ni el relay P2P de featured.

## Qué conecta

```text
Facebook Live/video en Brave o Chrome
  -> extension/content.js lee los comentarios renderizados en el DOM
  -> POST local a Chat Bot Spotify :9765
       -> Control Cortex :4000 /api/rulo-chat-message
       -> Spotify Web API (OAuth PKCE, si se habilita)
       -> SSE local para el dashboard y el overlay destacado
```

Comentarios/Ruleta importa participantes manualmente desde el archivo SQLite de Rulo; no recibe copias automáticas del capturador.

Los eventos conservan el formato compatible con SocialStream: `id`, `mid`, `type`, `platform`, `chatname`, `chatmessage`, `chatimg`, `contentimg`, `chatbadges`, `userid`, `timestamp`, `textonly` y `meta`. En Facebook `type` y `platform` valen `facebook`. El servidor asigna a cada comentario un `traceId` aleatorio, visible en el feed del capturador y consultable en `/event-traces.html` de Cortex. La traza guarda etapas y estados técnicos, sin texto del comentario ni identidad de la persona. Si Facebook muestra un contador de espectadores en el DOM, el módulo también intenta actualizar el conteo de Cortex.

## Arranque

Requiere Node.js 20 o superior. No hay dependencias npm externas.

1. Abre `iniciar-Chat-Bot-Spotify.bat` o ejecuta `npm start` en esta carpeta. De fábrica, el servicio escucha solo en `127.0.0.1`.
2. Abre `http://127.0.0.1:9765/` en la misma PC para configurar el módulo. También puedes usar la IP LAN de esa PC desde su propio navegador; el panel identifica que la conexión vuelve a una interfaz de esta misma máquina. Desde otra PC, el panel no entrega el token local.
3. Instala la extensión local siguiendo el panel. Activa el modo desarrollador en `brave://extensions` o `chrome://extensions` y carga la carpeta `extension`.
4. Copia el token del dashboard al popup de la extensión. Escribe una etiqueta para la cuenta (por ejemplo, `Facebook personal 1`) y enciende **Módulo activo**, **Leer comentarios del navegador** y los dos interruptores del popup.
5. Navega a un video o transmisión en vivo de Facebook. La extensión establece una línea base al activarse y luego envía nuevos comentarios detectados.

Para usar tus dos cuentas a la vez, abre cada una en un perfil distinto de Brave/Chrome, instala la extensión en ambos perfiles y asigna una etiqueta diferente. El dashboard lista cada pestaña con su estado, URL de la transmisión, filas del DOM, comentarios detectados/enviados, último envío a Cortex y errores.

Las fotos de perfil se leen desde el DOM, se reducen a miniaturas WebP y Control Cortex las conserva en `Rulo/profile-avatars/`; así el historial no depende de enlaces temporales de Facebook. La extensión también puede completar la foto de un comentario ya visible sin volver a enviar el comentario ni ejecutar un pedido de Spotify.

Para que la ruleta agregue participantes, el servidor Comentarios debe estar ejecutándose en la misma PC. Para que se guarden en el historial de Rulo, Control Cortex también debe estar ejecutándose. Las direcciones se editan en el dashboard del módulo.

**Modo de pruebas aislado** mantiene los comentarios visibles en el panel del capturador, pero los separa de los datos reales. Cortex los conserva solo en memoria temporal; no los añade al historial normal de Rulo, al archivo permanente de audiencia ni a los avatares guardados. Chat Bot Spotify no envía comentarios a la Ruleta: sus participantes se importan manualmente desde SQLite. Los pedidos automáticos de Spotify se pausan; el botón **Probar reproducción aislada** puede reproducir una sola pista mediante una acción manual, sin crear un comentario, guardar un pedido o enviar algo a la Ruleta. Las pruebas temporales se borran al reiniciar cada servicio.

En Inicio de Control Cortex, el interruptor **Activar Pruebas** sincroniza este ajuste con el modo de pruebas de Spotify. Si Cortex o Comentarios/Ruleta aún no tienen aislamiento compatible, Chat Bot Spotify bloquea el reenvío de prueba e informa que ese servicio debe reiniciarse. Así una versión vieja no guarda eventos de prueba en sus datos permanentes.

## Identidad y duplicados

Los mensajes siguen enviándose con el formato compatible de SocialStream Ninja. El bloque `meta` añade `captureId`, `tabId`, `accountLabel`, `streamId`, `videoId`, URL de página y `captureMethod: "dom"`; los eventos guardan también la cuenta y transmisión que los originaron. El ID del comentario mantiene prioridad como identificador estable. La base permanente de Cortex aplica deduplicación idempotente entre capturadores Facebook aunque la hora de recepción difiera.

## Persistencia y copias

- El panel del capturador conserva en memoria los últimos 120 eventos.
- El historial visual normal de Rulo conserva hasta 200 elementos en `Rulo/rulo-chat-history.json`.
- El archivo permanente de audiencia vive en `Rulo/Spotify/spotify-analytics.db`; la exportación CSV está disponible en `/api/rulo-audience-comments.csv?dias=30`.
- Cortex crea una copia consistente al iniciar y cada 24 horas. El botón **Crear respaldo** en el historial de Rulo crea una copia manual. Se guardan las 7 copias más recientes en `Control Cortex/backend/backups/rulo-data/`, con SQLite, historial visual y avatares WebP. La carpeta está excluida de Git.
- Para recuperar una copia, detén Cortex y sigue [`Control Cortex/backend/RESPALDOS-RULO.md`](../Control%20Cortex/backend/RESPALDOS-RULO.md). No copies SQLite mientras Cortex está abierto.

## Spotify

1. En el dashboard pega el Client ID de tu aplicación de Spotify.
2. Agrega esta URI exacta en los Redirect URIs de la aplicación (el flujo del módulo usa PKCE y requiere que coincida exactamente):

   `http://127.0.0.1:9765/spotify/callback`

3. Guarda y pulsa **Conectar Spotify** desde la PC que ejecuta el módulo. Usa `http://127.0.0.1:9765/spotify/callback` tal cual (sin `localhost` ni la IP LAN). El servicio utiliza Authorization Code con PKCE, por lo que no necesita Client Secret; guarda el access/refresh token bajo `data/spotify-token.json`. El estado PKCE dura diez minutos y se conserva en `data/spotify-oauth-session.json` para que el retorno funcione aunque el servicio se reinicie durante el consentimiento.
4. Enciende **Procesar pedidos del chat**. Al recibir un comentario que coincida con el vocabulario de pedidos, este módulo busca el tema y lo agrega como siguiente en la cola actual de Spotify. Comprueba que quedó primero, salta a esa pista y confirma que suene en el dispositivo seleccionado. Así conserva la playlist y no interpreta el HTTP 204 de Spotify como prueba de reproducción. La cola local serializa pedidos de varias cuentas. Si hay offset configurado, silencia el cambio, aplica el salto inicial y restaura el volumen.

El módulo consulta en Cortex los ajustes, vocabulario, alias y dispositivo de Spotify si esas APIs están disponibles. Si Cortex no responde, puede seguir conectando con Spotify, capturando comentarios y mostrando el overlay destacado; los pedidos del chat no heredan automáticamente esos datos.

El estado de reproducción se consulta automáticamente con el OAuth de este módulo, usando el intervalo `pollSeconds` de Cortex (4 segundos por defecto). Así el overlay unificado también se actualiza cuando cambias de canción desde otro dispositivo conectado a la misma cuenta de Spotify.

La API de reproducción de Spotify requiere una cuenta Premium para controlar el dispositivo. Consulta también las [condiciones de reproducción de Spotify Web API](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback).

## OBS

Agrega una fuente **Navegador** con la URL del overlay destacado. En la máquina que ejecuta el servidor:

`http://127.0.0.1:9765/featured.html`

Si OBS está en otra PC, usa la dirección LAN de la PC del servidor, por ejemplo `http://192.168.4.100:9765/featured.html`. El puerto `9765` debe estar permitido en el firewall de Windows para esa red privada. También puedes abrir el dashboard en `http://IP-LAN:9765/` desde la PC del servidor; el token de extensión solo se entrega cuando la conexión vuelve a una interfaz de esa misma PC.

El historial de Rulo ahora destaca directamente mediante `POST /api/featured` y el overlay de este módulo. No hace falta abrir `featured.html` de SocialStream ni usar una Session ID.

## APIs propias

- `GET /api/status`: estado del proceso y conexiones.
- `GET /api/events`: feed Server-Sent Events para dashboard/overlay.
- `POST /api/chat-event`: recibe el evento normalizado de Facebook; requiere bearer token.
- `POST /api/capture-status`: registra el latido y las métricas DOM por pestaña; requiere bearer token.
- `POST /api/featured`: activa el comentario destacado.
- `GET /api/featured`: devuelve el destacado actual.
- `POST /api/featured/clear`: limpia el destacado.
- `GET/POST /api/config`: preferencias; requiere bearer token.
- `POST /api/spotify/test`: búsqueda de diagnóstico; no reproduce audio.
- `POST /api/spotify/intent-preview`: vista previa de pedidos en **Rulator**. Usa el detector y parser compartidos; no reproduce, encola, consume cooldowns, aprende aliases ni escribe historial.
- `POST /api/spotify/test-comment`: Rulator lo usa a través del proxy de Cortex para reproducir pedidos reales dentro del Modo de pruebas aislado. Conserva nombre e ID archivados solo en el servidor, usa la cola/cooldowns por programa y suprime historial, registros, aprendizaje de aliases y selección. El bearer token local no llega al navegador.
- `POST /api/spotify/test-playback`: reproduce una pista bajo demanda; requiere bearer token, OAuth activo y Modo de pruebas aislado. No genera ni archiva un comentario y no modifica la Ruleta.
- `POST /api/spotify/test-comment`: analiza un comentario sin reproducir si `parseOnly: true`; de lo contrario requiere Modo de pruebas aislado y reproduce el pedido detectado sin archivarlo. Para la simulación de un vivo histórico (`liveSimulation: true`), además exige los interruptores de Rulo/captura/pedidos del chat, conserva la identidad archivada y aplica la cola serializada y cooldowns de un pedido real en memoria separada por programa.
- `GET /api/spotify/devices`: devuelve la lista de dispositivos Spotify del OAuth propio; requiere bearer token.
- Los pedidos reales de Facebook se procesan y serializan en Chat Bot Spotify. La reproducción usa la cola actual de Spotify y confirma el cambio antes de responder. Control Cortex puede aportar ajustes y recibir respuestas e historial; no consume la cola de reproducción.
- `POST /api/spotify/transport`: ejecuta controles manuales (`next`, `previous`, `pause`, `resume`); requiere bearer token.
- `GET /api/setup`: entrega la clave solo a conexiones de loopback.
- Control Cortex expone el estado global de pruebas en `GET/POST /api/test-mode` para sincronizar los módulos.

Los archivos locales con claves y tokens viven en `data/`, excluida del control de versiones por `.gitignore`.

Las rutas mutables requieren el bearer token de la extensión o un origen local validado. CORS solo permite extensiones del navegador y orígenes locales; nunca pongas el token en URLs, comentarios ni registros.

El dashboard `http://127.0.0.1:4000/rulo-spotify.html` llama a los botones de búsqueda,
reproducción de prueba, comentario simulado, transporte y dispositivos a través de un proxy de
Control Cortex. El proxy toma el bearer token desde `data/config.json` en el servidor y nunca lo
expone al navegador. Esos controles no usan la cola de comandos de SocialStream Ninja; deja esa
cola solo como compatibilidad antigua.

## Escucha de red y retención

El servidor escucha en `127.0.0.1` por defecto. Establece `CHAT_BOT_SPOTIFY_HOST=0.0.0.0` solo si necesitas que OBS u otro cliente de la red local se conecte; restringe entonces el puerto `9765` en Firewall de Windows a los equipos necesarios. La extensión está pensada para ejecutarse en esta misma PC.

El registro visible guarda los últimos 50 pedidos y la tabla SQLite activa de interacciones conserva 90 días por defecto (`CORTEX_SPOTIFY_LOG_RETENTION_DAYS`, configurable entre 1 y 3650 en Cortex). **Vaciar historial activo** elimina el JSON reciente y las interacciones Spotify de la base activa, incluidos comentarios y nombres de solicitantes; no elimina el archivo permanente de audiencia (`audience_comments` / `user`) ni modifica respaldos SQLite ya creados.

Si OBS está en otra PC, habilita el acceso LAN explícitamente al iniciar el servicio, por ejemplo en PowerShell: `$env:CHAT_BOT_SPOTIFY_HOST='0.0.0.0'; npm start`. Luego usa la dirección LAN de la PC del servidor y limita la regla del firewall a los equipos de confianza.

## Límites de captura DOM

La extensión procesa los comentarios que Facebook expone y representa en la página abierta. Los cambios de diseño, los comentarios ocultos/colapsados, el contenido que no llegó al navegador o un cambio de estructura de Facebook pueden requerir actualizar `extension/content.js`. Mantén la pestaña conectada a la transmisión y confirma en el feed del dashboard que aparecen nuevos eventos.

El observador ignora mutaciones de la página que no tocan filas de comentarios y hace una reconciliación completa cada cinco segundos. Esto reduce el trabajo en páginas de Facebook con actualizaciones frecuentes de elementos ajenos al chat, manteniendo un respaldo para cambios que el observador no detecte.

Las rutas aisladas de prueba de búsqueda, reproducción y comentario suprimen la escritura del registro de pedidos y del historial de plantillas de respuesta. La vista previa y las simulaciones no deben contaminar las interacciones normales.

## Integración actual con Rulo y la Ruleta

El historial permanente de Rulo se consulta desde SQLite en `Rulo/Spotify/spotify-analytics.db`; el JSON de historial reciente es solo una vista limitada. La Ruleta de Participantes importa de ese archivo las personas únicas de un programa. Los registros de evaluación de simulaciones y las capturas históricas de lotería se guardan en tablas separadas del historial de audiencia.

Los premios de la Ruleta se gestionan desde su dashboard en `http://localhost:9742/dashboard.html`. Un giro **no entrega el premio**: luego de un ganador real, el operador elige **Asignar premio**, selecciona un premio habilitado, la lotería Cdelu y la cantidad de tickets, y confirma. La llamada de entrega pertenece al servidor de Comentarios, pasa por Cortex y reutiliza la función del backend de Cdelu para aplicar tickets extra. La operación es idempotente por giro y premio, y está bloqueada en vistas previas y en Modo de pruebas aislado. Chat Bot Spotify no debe otorgar premios ni exponer la identidad privada de Facebook.

Para la simulación de preguntas históricas, consulta [`../Rulo/README-SIMULACION-VIVOS.md`](../Rulo/README-SIMULACION-VIVOS.md). Los pedidos musicales de esa simulación usan el parser y la ruta aislada de este módulo; no se guardan en el historial normal ni en la Ruleta. La lotería de esa simulación es de solo lectura.

La guía de arquitectura del workspace está en [`../README.md`](../README.md); las reglas específicas de cambios están en [`AGENTS.md`](AGENTS.md), además de las instrucciones generales en [`../AGENTS.md`](../AGENTS.md).
