# Spotify Auto Music Requests

Esta carpeta contiene la integracion local que permite pedir musica desde el chat con frases naturales.

## Que hace

Extiende la integracion existente de SocialStream Ninja con Spotify para entender mensajes como:

```text
quiero un tema de Damas Gratis
quiero la musica de Amar Azul el tema Yo Tomo Licor
pon Amar Azul Yo Tomo Licor
!playnow Yo Tomo Licor Amar Azul
!tema Damas Gratis
!musica Amar Azul Yo Tomo Licor
!spotifydevices
```

Cuando detecta un pedido valido:

1. busca el tema en Spotify,
2. busca dispositivos Spotify disponibles,
3. elige el dispositivo activo, el dispositivo configurado por nombre, o una app tipo computadora,
4. en pedidos manuales, agrega el tema como siguiente en la cola y avanza con `POST /v1/me/player/next`, conservando la playlist actual,
5. aplica cooldown global de 40 segundos,
6. aplica cooldown por usuario de 120 segundos,
7. deja pasar primero los comandos nativos de SSN.

## Archivos importantes

- Fuente principal:
  `D:\plugins para mi OBS\Control Cortex\integrations\spotify-auto-music\spotify-auto-music.js`
- Copia que carga SocialStream Ninja:
  `D:\plugins para mi OBS\SocialStream Ninja\local-overrides\spotify-auto-music.js`
- Enganche minimo de carga:
  `D:\plugins para mi OBS\SocialStream Ninja\loader.js`
- Auto-parcheador que restaura la copia y la linea del loader:
  `D:\plugins para mi OBS\Control Cortex\backend\server.js`
- Guia tecnica:
  `D:\plugins para mi OBS\guia para crear auto selecion de musica.md`

## Por que hay una copia dentro de SocialStream Ninja

SocialStream Ninja es una extension de tercero y el navegador solo puede cargar scripts que estan dentro de la carpeta de la extension. Por eso Control Cortex mantiene esta fuente principal y copia el archivo a `SocialStream Ninja\local-overrides` cuando arranca.

Si actualizas SocialStream Ninja y se borra el cambio, inicia Control Cortex para reinyectar:

- `SocialStream Ninja\local-overrides\spotify-auto-music.js`
- la linea `./local-overrides/spotify-auto-music.js?v=1` en `SocialStream Ninja\loader.js`
- la `key` fija del `manifest.json`

## Vocabulario editable (entrenamiento)

El parser ya no tiene las listas escritas en el codigo: las recibe de Cortex
(`Rulo/Spotify/spotify-vocabulary.json`) y se editan desde `/rulo-spotify-training.html`. El modulo las
toma por el poll (`vocabulary`) y por WebSocket (`spotify_vocabulary`) y las compila a regex en caliente.
Si Cortex nunca respondio, usa el respaldo `DEFAULT_VOCABULARY` de este archivo.

Con el cerebro activado (`vocabulary.ai.enabled`), los comentarios que las reglas no entienden se
consultan a `POST /api/spotify-ai-interpret` (la clave vive en el `.env` del backend, no en la extension).

## Tolerancia a errores de escritura

Desde la versión 43, las búsquedas de canciones usan páginas de hasta 10 resultados, compatibles con el límite de Spotify Development Mode. El grupo de variedad de 20 o más canciones se obtiene con paginación. Un rechazo HTTP se comunica como error de búsqueda, sin afirmar que el artista no existe. La regresión del pedido «quiero un tema de karina» se comprueba en `Rulo/tests/spotify-module-test.js`, con el catálogo de artista no disponible y el límite de 10 exigido por la API simulada.

El parser acepta saludos, muletillas, "temita/temazo" como sinonimo de "tema" y pedidos sin la palabra
tema ("pasame a ke personajes"). Si la busqueda no encuentra nada, prueba variantes (articulo pegado
"laberiso" -> "la beriso", sin articulo, y confusiones i/y, b/v, s/z, ll/y, qu/k, c/s; hasta 7 intentos)
y guarda la correccion que funciono en `Rulo/Spotify/spotify-aliases.json` para la proxima. Las
correcciones se ven y se cargan a mano desde el dashboard.

## Dashboard (Rulo/Spotify)

Todos los ajustes se controlan desde `http://127.0.0.1:4000/rulo-spotify.html` (ver
`Rulo/Spotify/README.md`): encendido general, modo prueba sin esperas, esperas global y por usuario,
largo mínimo del comentario, solo comandos, respuestas personalizadas, avisos en el overlay,
continuidad automática, salto inicial y dispositivo destino. También permite probar un tema al instante,
simular un comentario real, mover el transporte (pausa/siguiente/anterior) y ver el registro de pedidos.

Este módulo (v26) usa dos caminos para recibir lo que pasa en el dashboard:

1. **WebSocket** `ws://<cortex>/api/spotify-ws`: enlace instantáneo (~10-30 ms). Recibe
   `spotify_settings` cuando guardás un ajuste y `spotify_command` cuando probás algo desde el
   dashboard. Existe porque Brave/Chrome estrangula los timers de las páginas de fondo a 1 vez por
   minuto: con solo el poll, los comandos llegaban cada 60 s.
2. **Respaldo por consulta**: `GET /api/spotify-client-state?alive=1&version=26&token=<0|1>` cada
   `pollSeconds` segundos (1-15, ajustable en el dashboard). Devuelve los ajustes y los comandos
   pendientes **en lote** (se ejecutan en orden). El dashboard usa esta llamada para saber si la
   extensión está conectada.

## Ajustes opcionales

La integración lee estos settings si existen en SSN:

```js
spotifyAutoMusicRequests
spotifyAutoMusicCooldownSeconds
spotifyAutoMusicUserCooldownSeconds
spotifyAutoMusicDeviceName
```

Ojo: si el dashboard de Cortex ya respondió, **sus valores ganan** sobre estos. Los settings de SSN
solo actúan como respaldo mientras el backend no conteste.

Si no existen, usa:

- activado por defecto
- 40 segundos de cooldown global
- 120 segundos de cooldown por usuario
- dispositivo activo de Spotify, o primera computadora disponible

`spotifyAutoMusicDeviceName` permite fijar una PC concreta. No hace falta que sea el nombre exacto: si Spotify muestra `PC OBS Streaming`, alcanza con guardar `OBS` o `Streaming`. También se puede definir desde el panel de Control Cortex, en `Spotify Now Playing`, usando `Dispositivo que debe reproducir`; ese destino se guarda en `backend/spotify-device-target.json` y tiene prioridad sobre el dispositivo activo.

## Prueba rapida

1. Abrir Spotify y dejar un dispositivo activo reproduciendo algo.
2. Recargar la extension SocialStream Ninja en Brave.
3. Enviar en el chat: `quiero la musica de Amar Azul el tema Yo Tomo Licor`.
4. Verificar que Spotify cambie de tema.
5. Enviar otro pedido antes de 40 segundos y verificar que responda con espera.

Para probar sin esperar: abrir el dashboard de Spotify, encender **Modo prueba (sin esperas)** y usar
«Simular un comentario del chat». También se puede bajar la espera a 0 en lugar de usar el modo prueba.

## Diagnostico de dispositivo

Si el bot responde `Reproduciendo...` pero la app de Spotify en la PC del OBS no cambia:

1. Enviar `!spotifydevices` en el chat.
2. Ver el nombre exacto con el que Spotify detecta la PC del OBS.
3. Mantener Spotify abierto en esa PC y reproducir/pausar una cancion una vez.
4. Si hay varias sesiones, configurar `spotifyAutoMusicDeviceName` con parte del nombre de la PC correcta.

## Spotify de escritorio en Windows: conservar la playlist al cambiar el tema

Si un pedido dice que se reprodujo pero Spotify Desktop no cambia de tema, o cambiar con `PUT /me/player/play` reemplaza la playlist/contexto actual, usar el flujo de cola que implementa `startTrackOnDevice` para pedidos manuales:

1. Consultar el estado del reproductor y la cola.
2. Si el pedido ya esta sonando o ya ocupa el primer lugar de la cola, no volver a agregarlo.
3. En caso contrario, agregarlo una sola vez con `POST /me/player/queue?uri=...&device_id=...`.
4. Confirmar con `GET /me/player/queue` que quede primero y despues avanzar con `POST /me/player/next?device_id=...`.
5. Confirmar el tema y el dispositivo con `GET /me/player`.

Este camino evita depender de la reproduccion directa por URI, que puede no aplicarse bien en el cliente de escritorio y puede reemplazar el contexto de la playlist. Los pedidos manuales no deben agregar tambien una recomendacion automatica: la playlist que ya estaba en curso queda detras del tema pedido. La continuidad automatica queda para las pistas de la biblioteca de Rulo.

Si el problema reaparece, comprobar que el indicador del dashboard muestre la version actual de la extension y recargar la pestaña de SocialStream Ninja. Confirmar tambien que solo una instalacion/emisor (por ejemplo, Brave o SSApp) este capturando esa transmision; ver `Control Cortex/MIGRAR-SOCIALSTREAM.md`, que explica que dos emisores pueden duplicar ordenes.

La prueba de regresion del cambio manual, incluyendo que un pedido repetido no se vuelva a encolar si ya esta sonando o primero, esta en `Rulo/tests/spotify-module-test.js` (bloque L). Las tandas de pedidos y esperas se verifican en `Rulo/tests/spotify-request-queue.test.cjs`.

### Salto inicial sin intro audible (v53)

Con `skipEnabled` activo (o un inicio definido para la pista), los pedidos manuales conservan el flujo de cola, pero silencian temporalmente el dispositivo antes de enviar Siguiente. Los botones Siguiente y Anterior del dashboard y del historial de chat aplican el mismo silencio, cambio, salto y confirmacion antes de restaurar el volumen anterior. Esto agrega una pequeña pausa: no promete un empalme sin silencio ni un inicio exacto al fotograma. El cambio audible puede quedar un poco despues del cartel de Rulo por las confirmaciones de Spotify.

El volumen se restaura en `finally`, con un reintento si falla. Si el salto falla, se solicita pausar la pista antes de restaurar el volumen. Si el dispositivo no permite confirmar/controlar su volumen, se informa el error y no se envia Siguiente. Durante la transicion, el polling no debe lanzar un segundo salto. Los cambios naturales de la playlist siguen usando la regla de polling existente; esta proteccion cubre los pedidos controlados por Rulo.

Pruebas simuladas de audio audible, preservacion de playlist, controles anterior/siguiente y recuperacion de errores: `node --test Rulo/tests/spotify-silent-start.test.cjs`. La escucha real en Spotify Desktop requiere confirmar el resultado con el cliente cargando v53 o posterior.
