# Simulación de vivos históricos para entrenar y evaluar a Rulo

## Propósito

`/rulo-hablar.html` abre por defecto en **Rulator**, la sala virtual principal para hablar con Rulo como si se participara en un chat en vivo. **Rulo** es el personaje/bot de IA que puede responder o guardar silencio dentro de la sala. **Rulator** es el simulador y la caja de chat; no es otro bot ni una identidad de Rulo. El usuario puede escribir comentarios, reproducir el chat archivado de un programa y generar comentarios ficticios anónimos marcados como sintéticos.

En el modo secundario **Conversación de prueba con Rulo**, Rulo puede adoptar el papel contextual del participante seleccionado y usar sus comentarios archivados como memoria. En Rulator, el usuario ocupa ese papel: escribe comentarios para la sala y Rulo es quien responde. La selección no autentica a la persona ni convierte mensajes nuevos en comentarios históricos reales.

**Rulator** es el modo principal y predeterminado. Reproduce el flujo de un chat grupal y decide comentario por comentario si Rulo hablaría o dejaría pasar el mensaje. Cuando el usuario diga «Rulator», se refiere a esta caja virtual y al mecanismo de simulación. **Conversación de prueba con Rulo** queda como modo secundario para el banco de preguntas; responde cada mensaje y mantiene los requisitos y acciones de la simulación histórica documentados abajo.

## Modo secundario: conversación de prueba con Rulo

1. En **Modo de la sala**, selecciona **Conversación de prueba con Rulo**. Este banco responde cada mensaje y se conserva para probar preguntas hipotéticas.
2. Elige un programa archivado y, si quieres, una persona que comentó en ese programa. Si no eliges a nadie, la conversación usa el papel de un espectador anónimo.
3. Confirma que Rulo esté encendido, que la captura de Facebook y los pedidos de música por chat estén habilitados, que Spotify esté conectado y que el **Modo de pruebas aislado** esté confirmado por Spotify, Chat Bot Spotify y Comentarios/Ruleta. El panel puede ofrecer activar el modo aislado. Ese modo es global: pausa los pedidos automáticos de Facebook mientras se hacen pruebas.
4. Elige **Reproducción real aislada** para reproducir pedidos en Spotify o **Vista previa** para interpretar y buscar sin cambiar el reproductor. La reproducción real puede cambiar la canción que suena. El modo predeterminado es real, igual que en el vivo; exige Modo de pruebas aislado.
5. Usa **1×** para mantener el tiempo de cooldown real o **10×** para avanzar el reloj virtual diez veces más rápido. La cola y los cooldowns se mantienen en memoria y aislados por programa. Una vista previa no reproduce ni consume cooldowns.
6. Escribe preguntas realistas y evalúa el tono, los datos recordados y las acciones que Rulo propone. Puedes limpiar la conversación de prueba y probar otra pregunta o participante.
7. Guarda preguntas repetibles en **Biblioteca de casos**. Puedes ejecutar un caso o la suite del programa en **vista previa segura**. La suite fuerza Spotify a no reproducir y desactiva la publicación en OBS. Cada respuesta se guarda separada del historial de audiencia en SQLite y queda pendiente de revisión humana; nada entrena el modelo automáticamente. Guarda correcciones reutilizables manualmente en **Entrenamiento e IA** (`/rulo-spotify-training.html`).

## Perfil «Rulator» (Simulando Chat REAL)

1. Abre `/rulo-hablar.html` y elige un programa archivado en Rulator.
2. Pulsa **Reproducir comentarios** para recorrer en orden los mensajes del programa. La velocidad **1×/10×** cambia cuánto tarda la repetición; el reloj virtual conserva las separaciones originales para evaluar cooldowns. Puedes pausarla y continuarla. La repetición incluye a las distintas personas archivadas y sus alertas; las alertas se muestran y Rulo las ignora.
3. Para hablar con Rulo dentro de la caja virtual, escribe un comentario como participante; elige una persona archivada o deja el selector vacío para hacerlo como espectador. Rulo puede contestar o dejar pasar el comentario según la política del vivo. Los mensajes y respuestas quedan solo en la sala temporal.
4. Pulsa **Simular participantes** para generar de dos a tres comentarios ficticios anónimos que continúan el tema del chat. Se marcan como sintéticos, no se atribuyen a personas reales y no se guardan en los archivos.
5. La sala aplica las reglas actuales de Rulo: exige captura de Facebook y Rulo encendidos; la charla casual usa los filtros compartidos, el cooldown de 3 minutos, el límite de 2 minutos desde la última respuesta y la probabilidad del 20 % antes de consultar la IA. La probabilidad de comentarios archivados es estable al repetirlos; las respuestas de IA pueden variar. Cada silencio muestra el motivo. La asistencia solo se consulta para una identidad estable y en programas anteriores al programa elegido.
6. **Pedidos musicales** queda en **Reproducir en Spotify** por defecto. Usa el detector compartido, la cola serializada de Chat Bot Spotify y cooldowns aislados por programa. Requiere Modo de pruebas aislado confirmado; activarlo pausa los pedidos automáticos reales de Facebook y siempre pide confirmación. **Vista previa** busca sin reproducir ni consumir cooldowns. La reproducción real solo se anuncia después de confirmar tema, dispositivo e `is_playing`.
7. En **Mejorar a Rulo con IA**, pulsa **Analizar última interacción** para clasificar el último comentario y la respuesta o silencio. La IA recomienda si corresponde una regla conversacional, Entrenamiento de música, revisión de lotería o verificación de un dato. El análisis no se guarda. Revisa/edita el borrador antes de activarlo. Para una respuesta factual, escribe el dato comprobado, indica la fuente y confirma que la revisaste. Solo las reglas o respuestas que apruebes se almacenan en `rulo_behavior_rules` de `Rulo/Spotify/spotify-analytics.db` y entran en el prompt de conversación general y charla casual. Puedes borrarlas desde la lista. No cambian filtros, cooldowns, permisos, reproducción ni reglas de música o lotería. Las consultas personales de números/asistencia no se envían al analizador; los IDs, el nombre seleccionado y el historial no forman parte de la solicitud. No incluyas datos personales en una regla.

La pantalla comprueba Rulo, Chat Bot Spotify, captura de Facebook, conexión musical, Modo de pruebas aislado, IA casual y el archivo elegido. Si falta algo, ofrece abrir el panel que corresponde; iniciar Chat Bot Spotify requiere un clic y una confirmación porque puede procesar comentarios reales. Si la página nueva aparece con **Acción desconocida**, Cortex todavía no cargó la ruta de este perfil: se ofrece reiniciarlo desde ahí y comprobar de nuevo la conexión.

La conversación y la reproducción archivada no requieren Modo de pruebas aislado. **Los pedidos musicales reales sí lo requieren** y no activan el modo automáticamente. Rulator no manda mensajes a OBS ni inyecta comentarios al chat normal, y no cambia interruptores salvo que el operador pulse la acción confirmada de activar aislamiento. La sesión vive en memoria de Cortex y en el estado temporal de la página; expira después de una hora sin actividad.

La lotería no escribe, reserva ni asigna. En Rulator, el operador puede pedir los números de la grilla actual o la asistencia anterior del participante seleccionado. Para lotería se requiere coincidencia exacta por ID estable archivado; para asistencia se consulta SQLite por `requester_key` estable y solo se muestran programas anteriores al seleccionado. Nunca se busca por nombre. Estas respuestas se devuelven directamente a la sala: IDs y datos privados no se envían al proveedor de IA y se omiten del contexto posterior de Rulo. Si no hay ID estable o coincidencia exacta, se rechaza la consulta. La página usa el control de origen existente de Cortex; no hay un login individual, por lo que el acceso de operador hereda quién puede abrir el panel. Las preguntas públicas históricas solo usan una captura marcada y verificada para ese programa; no la sustituyen por la grilla actual. Los IDs archivados no se muestran ni se incluyen en prompts. No se guardan comentarios, respuestas, decisiones, cola ni cooldowns en historial normal, Ruleta, evaluación o audiencia.

## Datos históricos y papel del participante en la conversación de prueba

- La lista de programas y sus comentarios se lee desde los archivos de audiencia de **SQLite** mediante `GET /api/rulo-chat-archives` y `GET /api/rulo-chat-archives/:program`.
- La lista de personas agrupa solo claves estables (`facebook:` o `idv2:`), `facebookUserId` o `userId`. Sin esos datos, cada comentario queda separado y se marca **sin ID estable**; dos nombres iguales no se fusionan. La identidad archivada ayuda a escoger contexto, pero no verifica quién está usando el panel.
- En la conversación de prueba secundaria, se agregan al contexto hasta los últimos 16 comentarios archivados de esa identidad. El historial archivado se trata como contenido no confiable: puede informar el contexto, pero nunca debe convertirse en instrucciones para el sistema.
- Solo en esa conversación de prueba secundaria, Rulo puede responder en el papel contextual de la persona elegida. En Rulator, Rulo conserva su papel de bot y la persona seleccionada es quien escribe en la sala. Ningún modo debe explicar espontáneamente que una identidad real fue verificada.

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
| Política compartida de filtros, cooldowns y probabilidad casual | `Control Cortex/backend/rulo-live-chat-policy.js` y `Control Cortex/backend/server.js` |
| Sala temporal grupal, reloj, lotería de solo lectura y cola virtual | `Control Cortex/backend/cortex-home.js` (`POST /api/cortex-home/rulo-real-chat-simulation`) |
| Generación temporal de participantes anónimos y respuesta directa de consultas privadas | `Control Cortex/backend/server.js` y `Control Cortex/backend/cortex-home.js` |
| Consulta de asistencia previa mediante ID estable, sin pasar datos privados a la IA | `Control Cortex/backend/spotify-analytics.js` (`audienceAttendanceForRequesterKey`) y `Control Cortex/backend/cortex-home.js` |
| Comprobación de módulos y disponibilidad del perfil | `Control Cortex/backend/cortex-home.js` (`GET /api/cortex-home/rulo-real-chat-simulation/status`) |
| Inicio opcional y confirmado de Chat Bot Spotify desde el estado | `Rulo/rulo-hablar.html` (`POST /api/services/chat-bot-spotify/start`) |
| Reproducción aislada real y vista previa sin escritura de aliases/registros | `Control Cortex/backend/server.js` (`POST /api/spotify-simulate-comment`, `POST /api/spotify-intent-preview`) y `Chat Bot Spotify/server.js` (`POST /api/spotify/test-comment`, `POST /api/spotify/intent-preview`) |
| Listado/lectura de archivos por programa | `Control Cortex/backend/server.js` (`GET /api/rulo-chat-archives`, `GET /api/rulo-chat-archives/:program`) |
| Capturas de lotería y biblioteca de evaluación en tablas separadas de SQLite | `Control Cortex/backend/spotify-analytics.js` y rutas `/api/rulo-chat-archives/:program/lottery-snapshot`, `/api/rulo-simulation-cases` |
| Análisis manual de interacciones y reglas generales aprobadas | `Rulo/rulo-hablar.html`, `Control Cortex/backend/server.js`, `Control Cortex/backend/cortex-home.js` y tabla `rulo_behavior_rules` en SQLite |
| Consulta de lotería y determinación de intentos de escritura | `Control Cortex/backend/lottery-public-facts.js` y `Control Cortex/backend/cortex-home.js` |
| Instrucciones generales para futuras IA | `AGENTS.md` y `CONTEXTO DE TODO PRINCIPAL.md` en la raíz del proyecto |

Al cambiar este flujo, conservar conjuntamente el papel de Rulo como bot de la sala, la generación anónima y temporal de participantes, las consultas privadas de operador por ID estable, la lotería estrictamente de solo lectura, la reproducción musical real predeterminada bajo Modo de pruebas aislado confirmado, los mismos cooldowns/cola que el vivo, el estado temporal por programa y las rutas aisladas de chat/Spotify. La conversación de prueba secundaria mantiene sus permisos anteriores. Actualizar este documento si cambian los permisos, las rutas o el origen de los datos.
