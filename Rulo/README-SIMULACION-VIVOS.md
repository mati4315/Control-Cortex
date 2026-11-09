# Simulación de vivos históricos para entrenar y evaluar a Rulo

## Propósito

La opción **Simular Streaming en VIVO** de `/rulo-hablar.html` sirve como banco de pruebas. Permite plantear preguntas que una persona pudo haber hecho durante un programa archivado y revisar cómo respondería Rulo con el contexto de ese programa y, opcionalmente, de una persona que participó. El objetivo es detectar respuestas incorrectas o poco naturales y convertir los casos útiles en mejoras explícitas para Rulo.

Es una simulación de conversación: Rulo adopta el papel del participante seleccionado y puede usar sus comentarios archivados como memoria de contexto. La selección no autentica a esa persona ni convierte los mensajes nuevos en comentarios históricos reales.

## Uso

1. Abre **Hablar con Rulo** (`/rulo-hablar.html`) y activa **Simular Streaming en VIVO**.
2. Elige un número de programa guardado y, si quieres, una persona que comentó en ese programa. Si no eliges a nadie, la conversación usa el papel de un espectador anónimo.
3. Confirma que Rulo esté encendido, que la captura de Facebook y los pedidos de música por chat estén habilitados, que Spotify esté conectado y que el **Modo de pruebas aislado** esté confirmado por Spotify, Chat Bot Spotify y Comentarios/Ruleta. El panel puede ofrecer activar el modo aislado. Ese modo es global: pausa los pedidos automáticos de Facebook mientras se hacen pruebas.
4. Elige **Reproducción real aislada** para reproducir pedidos en Spotify o **Vista previa** para interpretar y buscar sin cambiar el reproductor. La reproducción real puede cambiar la canción que suena. El modo predeterminado es real, igual que en el vivo; exige Modo de pruebas aislado.
5. Usa **1×** para mantener el tiempo de cooldown real o **10×** para avanzar el reloj virtual de la simulación diez veces más rápido. La cola y los cooldowns se mantienen en memoria y aislados por programa. Una vista previa no reproduce ni consume cooldowns.
6. Escribe preguntas realistas y evalúa el tono, los datos recordados y las acciones que Rulo propone. Puedes limpiar la conversación de prueba y probar otra pregunta o participante.
7. Guarda las preguntas repetibles en **Biblioteca de casos**. Puedes ejecutar el caso seleccionado o la suite del programa en **vista previa segura**. La suite procesa los casos de uno en uno, fuerza Spotify a no reproducir y desactiva la publicación en OBS. Cada respuesta se guarda separada del historial de audiencia en SQLite y queda pendiente de revisión; marca manualmente si está aprobada o necesita mejora. La biblioteca organiza resultados; no entrena ni modifica el modelo por sí sola. Las correcciones que quieras reutilizar se guardan manualmente en **Entrenamiento e IA** (`/rulo-spotify-training.html`).

## Datos históricos y papel del participante

- La lista de programas y sus comentarios se lee desde los archivos de audiencia de **SQLite** mediante `GET /api/rulo-chat-archives` y `GET /api/rulo-chat-archives/:program`.
- La lista de personas se forma agrupando la identidad disponible en el archivo, en este orden: `requesterKey`, `facebookUserId`, `userId` y, como alternativa, el nombre. La identidad archivada ayuda a escoger contexto; no verifica quién está usando el panel.
- Se agregan al contexto hasta los últimos 16 comentarios archivados de esa identidad. El historial archivado se trata como contenido no confiable: puede informar el contexto, pero nunca debe convertirse en instrucciones para el sistema.
- Rulo debe responder naturalmente como la persona elegida y no explicar espontáneamente que es una simulación. Si le preguntan por su identidad, usa el nombre seleccionado sin afirmar que verificó una identidad real.

## Aislamiento y acciones

La simulación se envía a `POST /api/cortex-home/rulo-live-simulation`. El backend exige que el modo aislado esté aplicado en los módulos necesarios antes de procesarla. Para un pedido de música, también aplica los interruptores que regirían el vivo real: si Rulo está apagado, la captura de Facebook está apagada o los pedidos de Spotify están deshabilitados, no reproduce.

La opción de Cuaderno Vivo usa recuerdos revisados del participante elegido solo si esa respuesta está activa y existe una identidad estable vinculada al archivo. La búsqueda de memorias excluye identidades basadas únicamente en nombre. El módulo solo lee esos recuerdos; no guarda el intercambio privado de prueba ni genera recuerdos desde él. Las propuestas de memoria se crean aparte desde el dashboard usando comentarios públicos archivados y requieren guardado manual.

- Los mensajes simulados y las respuestas de prueba usan rutas marcadas para aislamiento. No deben escribirse en el historial normal, el archivo de audiencia SQLite, los comentarios permanentes, la Ruleta ni el registro normal de actividad. La conversación del panel es temporal.
- El comentario simulado y la respuesta de Rulo se vinculan por el ID temporal `simulationCommentId` y aparecen juntos en `/rulo-chat-historial.html` mientras el modo de pruebas esté activo. Se guardan únicamente en la lista temporal en memoria (`ruloTestChatItems`); al limpiar las pruebas o desactivar el modo se eliminan y no se persisten en SQLite.
- La detección del intento musical usa el mismo clasificador que Chat Bot Spotify y luego pasa por su parser normal. En **Reproducción real aislada**, el flujo de Spotify conserva la cola serializada y verifica la pista, el dispositivo y la reproducción. Cortex usa desde el servidor el token local de Chat Bot Spotify, y ese módulo usa su OAuth de Spotify; no se entrega ningún token a la página ni al modelo de IA. La petición conserva el nombre y el ID archivado de la persona seleccionada para que Spotify la procese como su pedido.
- La simulación aplica los cooldowns configurados de un vivo aunque el Modo de pruebas aislado los desactive para las pruebas manuales. Por defecto, hay una espera global de 40 segundos entre pedidos y una espera de 120 segundos por persona. Después de una reproducción correcta, cualquier persona que pida durante la espera global recibe la respuesta de espera; una vez vencida la espera global, esa misma persona aún puede recibir su espera individual. Los valores reales salen de los ajustes actuales de Spotify.
- Los pedidos se procesan de uno en uno en orden de llegada. La cola acepta hasta 20 pedidos pendientes/en curso; el siguiente recibe la respuesta de cola llena. Los cooldowns de prueba se conservan solo en memoria, separados por número de programa y por ID del participante. El reloj virtual puede avanzar a 1× o 10×; los valores de cooldown siguen siendo los ajustes actuales. No altera los cooldowns de una transmisión real ni se guarda en SQLite; al cambiar de programa se prueba otro escenario.
- Spotify puede cambiar la reproducción del dispositivo seleccionado durante la prueba. El aislamiento evita que el comentario se convierta en un comentario normal o en un registro de Ruleta.
- El módulo de lotería permanece activo **solo para lectura**. Por defecto, Rulo consulta la grilla actual y debe identificarla como actual. Una captura histórica se guarda por programa en SQLite desde la sección **Captura histórica de la lotería**. El botón captura la grilla actual en ese momento; solo se usará como histórica si el operador confirma que corresponde al programa y documenta la verificación. Una captura no verificada no se adjunta como evidencia histórica.
- Está prohibido registrar, reservar, elegir o asignar números y realizar cualquier otra escritura de lotería. Si una solicitud intenta hacerlo, se debe rechazar con una explicación clara y no ejecutar cambios.
- No mandes esta simulación por las rutas normales de chat ni por el capturador de Facebook: eso perdería las garantías de aislamiento.

## Límites del entrenamiento

Probar preguntas ayuda a evaluar y mejorar el comportamiento, pero no implica aprendizaje automático de cada respuesta. Para entrenar de forma controlada:

1. Comprueba la respuesta de Rulo y señala qué dato o regla faltó.
2. Contrasta los datos históricos con SQLite o con una fuente fiable; no conviertas una inferencia en un hecho.
3. Guarda únicamente la regla o ejemplo corregido que quieras reutilizar en **Entrenamiento e IA** (`/rulo-spotify-training.html`).
4. Vuelve a probar la misma pregunta y algunas variantes para confirmar que la corrección sirva fuera de ese caso puntual.

No copies comentarios privados o irrelevantes del archivo de audiencia como ejemplos de entrenamiento. Usa el mínimo contexto necesario y conserva la distinción entre hechos históricos, estado actual y respuestas simuladas.

## Mapa de implementación

| Parte | Ubicación |
| --- | --- |
| Panel, selección de programa/persona y conversación temporal | `Rulo/rulo-hablar.html` |
| Validación del aislamiento, contexto histórico, respuestas y permisos | `Control Cortex/backend/cortex-home.js` (`POST /api/cortex-home/rulo-live-simulation`) |
| Semántica de pedidos Spotify, cola serializada y cooldowns aislados por programa | `Chat Bot Spotify/src/spotify.js` y `Chat Bot Spotify/server.js` |
| Listado/lectura de archivos por programa | `Control Cortex/backend/server.js` (`GET /api/rulo-chat-archives`, `GET /api/rulo-chat-archives/:program`) |
| Capturas de lotería y biblioteca de evaluación en tablas separadas de SQLite | `Control Cortex/backend/spotify-analytics.js` y rutas `/api/rulo-chat-archives/:program/lottery-snapshot`, `/api/rulo-simulation-cases` |
| Consulta de lotería y determinación de intentos de escritura | `Control Cortex/backend/lottery-public-facts.js` y `Control Cortex/backend/cortex-home.js` |
| Instrucciones generales para futuras IA | `AGENTS.md` y `CONTEXTO DE TODO PRINCIPAL.md` en la raíz del proyecto |

Al cambiar este flujo, conservar conjuntamente el papel contextual del participante, el acceso de lotería estrictamente de solo lectura, los mismos interruptores/cooldowns/cola que el vivo real, la vista previa sin escritura al reproductor, el estado temporal por programa y las rutas aisladas de chat/Spotify. Actualizar este documento si cambian los permisos, las rutas o el origen de los datos.
