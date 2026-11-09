# Rulo · Cuaderno Vivo

## Estado

Esta carpeta contiene el módulo lógico de Rulo: perfil de personalidad, motor inicial de cuatro tonos y puntaje de carga, dashboard de control, memoria local por participante y una vista previa conectada al simulador existente. El servidor y las rutas se alojan en Control Cortex; Cuaderno Vivo no crea otro proceso.

La integración todavía es de **vista previa aislada**. El simulador puede elegir el motor nuevo y consultar recuerdos aprobados para la persona seleccionada; las respuestas del chat público continúan usando el generador actual. La memoria se administra en el dashboard, pero no se generan ni guardan recuerdos automáticamente.

La idea surgió al conversar sobre cómo Rulo podría responder a preguntas del chat teniendo en cuenta el programa, interacciones anteriores y aportes de los administradores. La intención es que **simule una personalidad reconocible**, sin afirmar que tiene conciencia ni permitir que la IA cambie sola sus reglas.

## Idea central

Mantener un módulo lógico separado de Spotify que reúna:

- una personalidad y unas instrucciones de estilo estables;
- información verificada sobre el programa y cada emisión;
- recuerdos útiles y controlados sobre participantes;
- contexto breve de la conversación actual;
- propuestas de recuerdos que un administrador pueda revisar.

El módulo sería mixto: Rulo puede resumir interacciones para mantener memoria y usar conversaciones administrativas verificadas como fuente, mientras la personalidad base y las reglas siguen bajo control de los administradores. **Recordar no significa reentrenar el modelo:** la IA no cambia por sí sola la personalidad ni las reglas del sistema.

El módulo separa perfil, puntuación y su dashboard en esta carpeta, e integra rutas internas de Control Cortex. El estado de control no almacena comentarios, nombres, IDs de audiencia ni credenciales. No se copia el historial de audiencia.

## Preferencias confirmadas para el diseño

- Rulo debe sonar más **entrerriano y argentino**, informal, curioso y pícaro. Puede usar humor negro ocasional, con criterio para no dirigirlo contra personas vulnerables ni usarlo en situaciones sensibles.
- Debe mantener recuerdos por participante y resúmenes de conversaciones anteriores para intentar conservar continuidad y contexto.
- Al principio, esos recuerdos no vencen. Se debe dejar prevista una función futura para configurar expiración o retención; marcarlo como mejora pendiente desde el diseño inicial.
- Rulo puede obtener memoria operativa de mensajes del chat real enviados por administradores cuya identidad y rol estén verificados por el sistema. Solo se consideran hechos o instrucciones duraderos y relevantes; la charla casual o ambigua no se convierte automáticamente en memoria. El chat privado de pruebas/simulación queda aislado salvo una solicitud explícita de mejora.
- En **Simular Streaming en VIVO**, Rulo debe contestar a la persona seleccionada dentro de esa conversación de prueba. Para el vivo real habrá una opción independiente de intervenciones espontáneas, limitada y configurable; no se asume que responderá a todas las preguntas públicas.

El perfil implementado recoge estas preferencias. Las reglas de seguridad y los hechos del sistema prevalecen sobre cualquier tono; los cuatro niveles solo modulan la redacción.

## Contexto existente de Rulo

Rulo ya tiene varias superficies y fuentes de información. Este módulo debe complementar esas piezas sin reemplazarlas ni duplicarlas.

### Rulo general

- Control Cortex recibe comentarios, mantiene un historial visual reciente y publica las respuestas en el overlay y el historial de Rulo.
- `Rulo/rulo-chat-history.json` sirve como historial visual reciente, con un límite de 200 elementos.
- `Rulo/Spotify/spotify-analytics.db` mantiene el archivo de audiencia, entre otras cosas en `audience_comments` y `user`.
- La identidad debe vincularse por un identificador estable cuando exista. No se deben fusionar personas solo porque tengan el mismo nombre. `facebook_user_id` y `ID_facebook` son campos diferentes; no se inventan valores.
- El análisis de preguntas sobre el archivo de audiencia es independiente: usa consultas y estadísticas agregadas. No debe confundirse con la generación de respuestas del chat.

### Rulo Spotify

- La captura propia actual de comentarios es Facebook mediante Chat Bot Spotify; la reproducción usa el OAuth propio de ese módulo y su cola serializada. No se debe redirigir el flujo vigente a SocialStream Ninja.
- `Chat Bot Spotify/src/spotify.js` interpreta pedidos y decide el resultado que Spotify confirma. Rulo no debe afirmar que un tema se está reproduciendo hasta verificar canción, dispositivo e `is_playing`.
- El vocabulario contiene respuestas locales por contexto (aceptado, no encontrado, espera, error, entre otros). Se rellenan con datos reales y se pueden elegir al azar, evitando repetir las últimas variantes.
- La IA puede interpretar pedidos musicales y, por separado, redactar una respuesta más natural a partir de un resultado ya conocido. La IA redactora no decide si Spotify reprodujo la canción.
- La pestaña **Bot / Rulo** permite editar variantes y pedir a la IA nuevas frases para guardar. Generar variantes es distinto de emitir una respuesta durante el vivo.
- Ya existe una respuesta casual opcional de Rulo con filtros y límites de frecuencia. El nuevo módulo debería reutilizar o coordinar esa función, no crear un segundo respondedor que duplique mensajes.

### Instrucciones de estilo actuales

El estilo configurable actual de Rulo Spotify estaba en `Rulo/Spotify/spotify-vocabulary.json`. Ya se preservó una copia con su procedencia en `imports/legacy-style-instruction.json`; también se importaron las variantes por contexto a `imports/spotify-response-catalog.json`. Son snapshots de migración, no editores ni fuentes activas: el generador público y el dashboard de Spotify conservan su dueño hasta que se construya y revise una ruta de compatibilidad.

La vista previa de Cuaderno Vivo usa el perfil estructurado de `profile.json` y no concatena la instrucción antigua; así prueba la nueva voz sin duplicar indicaciones que podrían contradecirse. Las respuestas públicas siguen con el motor anterior. La instrucción de estilo nunca tiene prioridad sobre las reglas del sistema ni sobre los hechos verificados.

`imports/context-policy.json` registra cómo se limita hoy el contexto reciente y qué mensajes del simulador quedan temporales. No se copiaron comentarios ni identidades a Cuaderno Vivo. El archivo de audiencia existente sigue siendo la fuente; el módulo consulta solo los recuerdos guardados y el fragmento público necesario, sin duplicar el historial.

## Memoria por participante (etapa actual)

- El dashboard local permite buscar participantes vinculados a una identidad estable del archivo, agregar recuerdos, corregirlos o borrarlos. No une cuentas por nombre.
- Los recuerdos viven en `data/memory.sqlite`. La clave de identidad HMAC se guarda en `data/identity-hmac.key`; la base contiene su hash protegido en lugar del ID de audiencia. Las rutas entregan al navegador una referencia temporal, no la identidad interna.
- Las propuestas opcionales analizan hasta 120 comentarios y respuestas públicas recientes con el proveedor de IA ya configurado para Rulo. La IA devuelve propuestas, nunca las guarda. El operador revisa cada una y decide si incorporarla; no se entrena ni modifica el modelo.
- El contexto solo usa recuerdos con visibilidad **Contexto de Rulo**, y solo cuando Cuaderno Vivo está activado para una respuesta de Simular Streaming en VIVO con identidad estable. Los recuerdos **Solo administración** nunca se envían al modelo.
- Los mensajes privados escritos dentro de la simulación no se guardan ni se usan para crear recuerdos. La opción **Analizar historial y proponer** usa el archivo público, no la conversación privada del panel.
- Los recuerdos no vencen inicialmente. `expires_at` ya permite agregar una política de vencimiento más adelante; la interfaz todavía no configura vencimientos.
- La memoria por participante funciona para el archivo, pero el aprendizaje automático de conversaciones de administradores reales sigue pendiente: la captura actual no aporta a esta ruta un rol de administrador verificado. El perfil “Admin” del simulador no sirve como verificación de una cuenta real y no se usa para ingesta.

Si falta la clave HMAC mientras ya existe `memory.sqlite`, el módulo se mantiene no disponible en lugar de generar otra clave y ocultar silenciosamente los recuerdos existentes. Los respaldos incluyen la base y su clave en pareja.

## Propuesta de memoria y personalidad

### 1. Perfil estable de Rulo

Preferencias mantenidas por administradores, por ejemplo:

- tono y variedad regional del español;
- nivel de formalidad, humor, curiosidad y extensión;
- expresiones preferidas y expresiones que debe evitar;
- límites de respeto, veracidad y temas delicados;
- frecuencia con la que puede iniciar una intervención espontánea.

Conviene que estos campos sean breves, explícitos y versionados. Se pueden añadir ejemplos de respuestas aprobadas y rechazadas para mostrar el estilo deseado.

### 2. Cuaderno del programa

Hechos confirmados y compartidos, como el nombre y formato del programa, secciones recurrentes, agenda, tema de la emisión, bromas internas aprobadas y explicaciones de referencias frecuentes. Cada dato debería señalar quién lo añadió, cuándo se confirmó y si vence al terminar el programa.

### 3. Memoria de participantes

Recuerdos y resúmenes de bajo riesgo que ayuden a dar continuidad: preferencias expresadas, intereses que Rulo pueda inferir con cautela, temas que la persona pidió retomar y contexto de conversaciones anteriores. Las preferencias o intereses inferidos deben quedar marcados como inferencias con su nivel de confianza; Rulo no debe presentarlos como hechos confirmados ni inferir información sensible. Si no hay identidad estable, el recuerdo no se debe asociar automáticamente solo por el nombre.

La preferencia actual es conservar estos recuerdos y resúmenes sin vencimiento inicialmente. Desde la primera versión conviene diseñar el campo de expiración como opcional y dejar documentada su futura incorporación como ajuste de retención. Cada recuerdo debería tener, como mínimo, alcance, contenido, origen, fecha, nivel de confianza, estado, visibilidad y referencia a la identidad estable. El panel debería permitir corregir y borrar recuerdos.

La continuidad debe cubrir resúmenes de charlas anteriores en la medida útil, no cargando todo el archivo crudo en cada prompt. Se conservan los resúmenes y recuerdos necesarios en el almacenamiento propio, y se recuperan solo los fragmentos relacionados con la pregunta actual.

### 4. Nota de cada emisión

Un administrador puede preparar antes del programa un resumen corto: qué sucede hoy, qué temas están confirmados y qué conviene evitar o retomar. Al cerrar la emisión, Rulo puede guardar resúmenes de la conversación para mantener continuidad. Los datos dudosos, sensibles o que cambien reglas generales quedan para revisión.

### 5. Sistema de tono de Rulo: cuatro niveles

Rulo tendrá un selector de tono con cuatro niveles. El nivel indica cómo interpreta su personaje para responder; no significa que la IA sienta una emoción real ni cambia las reglas, permisos o acciones de otros módulos.

| Nivel | Estado | Tono esperado |
| --- | --- | --- |
| 1 | Contento | Más amable, cálido, entusiasta y paciente. |
| 2 | Normal | Tono habitual y equilibrado. Es el valor predeterminado al iniciar. |
| 3 | Enojado | Más seco, firme y con menos paciencia, sin atacar a quien participa. |
| 4 | Muy enojado | Enojo de personaje claramente marcado y respuestas contundentes, manteniendo siempre el respeto básico. |

Todo se controlará desde el dashboard. El modo **Automático** será el funcionamiento normal: al iniciar, Rulo empieza en **Normal (2)** y un puntaje de carga puede llevarlo gradualmente a los niveles de enojo. Como segunda opción, el operador podrá cambiar a **Manual** y seleccionar cualquiera de los cuatro niveles. La selección manual se mantiene sin límite de tiempo hasta que el operador vuelva explícitamente a Automático. En Manual, el puntaje puede seguir visible, pero no cambia el estado elegido. La simulación podrá probar cada modo sin tocar el chat real.

El enojo modula la forma de hablar, no habilita insultos dirigidos, humillación, amenazas, discriminación, represalias ni cambios de permisos o decisiones. El puntaje debe representar la carga general de trabajo, no quién hizo los pedidos: una persona o una provocación no pueden subirlo por sí solas. Los tonos enojados se evitan en respuestas a situaciones sensibles.

Para que sea fácil de mantener, conviene que cada estado ajuste unos pocos rasgos del estilo base —por ejemplo, calidez, paciencia, energía y contundencia— en vez de mantener cuatro personalidades o prompts duplicados. Los números son etiquetas de la interfaz, no una escala matemática: internamente cada estado debería tener un nombre estable (`contento`, `normal`, `enojado`, `muy_enojado`), porque Contento (1) no es simplemente “menos enojado” que Normal (2).

El dashboard debe mostrar el modo, nivel activo, puntaje, motivos y señales que aportaron al puntaje, y ofrecer un regreso inmediato a Automático/Normal. Los cambios se aplican a respuestas nuevas. El puntaje debe basarse en carga medible: pedidos aceptados y pendientes, cuánto llevan esperando, ritmo de llegada frente a resolución y errores o atascos operativos repetidos. Solo cuentan solicitudes que realmente crean trabajo; la charla común no suma por sí sola. Se mide el volumen agregado en ventanas de tiempo, no se castiga a una persona por pedir algo. Cada evento se cuenta una sola vez; refrescar el panel no suma puntos.

Como punto de partida para probar, se propone una escala acotada de **0 a 40**: **0–9 = Nivel 1**, **10–19 = Nivel 2**, **20–29 = Nivel 3** y **30–40 = Nivel 4**. Al iniciar, puntaje **10** y Nivel 2: Normal. Un pedido nuevo puede sumar carga; una espera excesiva o un atasco aporta puntos adicionales una sola vez; resolver pedidos reduce carga. Si no quedan pedidos en curso ni pendientes, el puntaje baja de a poco —por ejemplo, un punto por intervalo de descanso— hasta llegar a cero. El ritmo, los pesos y el límite son valores iniciales para calibrar, no definitivos.

Al llegar a cero, Rulo queda en el nivel Contento. La animación de sueño ya existe en el módulo de la mascota y se activa con su temporizador de inactividad actual; Cuaderno Vivo debe reutilizar ese mecanismo y no crear un segundo reloj. El puntaje puede seguir bajando mientras la animación duerme. El modelo puede explicar o sugerir un estado, pero el cálculo final depende de reglas y señales auditables. La simulación sirve para calibrar los valores antes de activarlos en el vivo.

Mientras el operador lo mantenga en Manual, el dashboard puede seguir mostrando qué nivel elegiría Automático con el puntaje actual, para que volver al modo automático no produzca una sorpresa. También conviene guardar un registro breve de cada transición: hora, modo, nivel anterior/nuevo y motivo técnico o acción manual; evitar guardar mensajes del chat como explicación.

## Flujo futuro de una respuesta

```text
Comentario nuevo
  → clasificar intención y aplicar reglas del módulo correspondiente
  → recuperar solo perfil, hechos y recuerdos pertinentes según su fuente, alcance y estado
  → redactar una respuesta con la IA
  → validar nombre, datos, límites, extensión y frecuencia
  → publicar en el overlay/historial o usar una respuesta local de respaldo
  → guardar o proponer un resumen de memoria según su tipo y política
```

La memoria recuperada se aporta como contexto, no como instrucciones con mayor prioridad. El comentario del chat y los textos archivados son contenido no confiable: no pueden modificar permisos, pedir secretos ni cambiar las reglas del sistema.

La IA solo redacta. Las acciones de Spotify, OBS, la Ruleta u otros módulos continúan en sus rutas existentes, con sus validaciones y confirmaciones. El modelo no recibe tokens ni credenciales.

## Aportes de administradores

La preferencia expresada es que Rulo pueda aprender de conversaciones administrativas operativas, no solo de notas escritas en el panel. Para eso la identidad y el rol administrativo deben venir verificados por el sistema o la cuenta, asociados a una identidad estable; nunca alcanzan el texto “soy administrador” ni el nombre visible. En el chat real, solo hechos o instrucciones duraderos y relevantes pueden convertirse en memoria operativa con fuente, fecha y ámbito. La charla casual o ambigua no se guarda como conocimiento estable. Esa memoria no reentrena el modelo ni modifica por sí sola el perfil estable.

El perfil y los datos oficiales también deberían poder editarse desde una interfaz autenticada. Los mensajes administrativos verificados del chat real son una fuente acotada de memoria, aunque no cada frase casual se convierte en conocimiento estable. Rulo debe separar instrucciones de personalidad, hechos del programa, notas temporales y charla informal. Las conversaciones privadas no se muestran al chat público; solo se exponen datos cuyo ámbito esté marcado para compartir. Los cambios al perfil base siguen requiriendo una acción explícita del administrador y el flujo de revisión correspondiente.

Conviene distinguir entre:

- **hecho del programa** que Rulo puede compartir;
- **instrucción de estilo** sobre cómo expresarse;
- **nota interna** solo para administradores;
- **propuesta de memoria** extraída de una interacción.

Las notas internas no se incluyen en respuestas públicas. Solo los datos aprobados y destinados al chat pueden aparecer como contexto de generación.

### Simulaciones privadas de Rulo

`Rulo/README-SIMULACION-VIVOS.md` describe **Simular Streaming en VIVO**, donde el administrador conversa con Rulo, selecciona un participante histórico y prueba distintos escenarios. Esa conversación es temporal y aislada: no se agrega a la memoria del participante seleccionado ni se usa como memoria privada del administrador. Tampoco escribe al historial real, la Ruleta o el entrenamiento.

La recomendación es mantener ese simulador y su ruta actual (`/rulo-hablar.html`), sin crear una segunda conversación de prueba. Durante la migración puede conectarse gradualmente a Cuaderno Vivo para generar respuestas y probar tonos/puntajes en aislamiento, conservando el archivo y los resguardos actuales. Los controles de prueba no modifican el estado del chat real.

Si el administrador pide explícitamente que Rulo mejore una respuesta o regla **desde ese chat de simulación**, Rulo empieza a trabajar ahí mismo y devuelve una versión mejorada para ese caso, sin pedir una segunda confirmación para iniciar. Si la mejora sirve para el módulo, queda como propuesta para el flujo manual de revisión en Entrenamiento e IA. La simulación no cambia por sí sola el perfil persistente ni entrena el modelo; el chat general en vivo tampoco activa este flujo.

## Revisión, aprendizaje y evaluación

El aprendizaje de continuidad debe ser memoria recuperable, no entrenamiento automático del modelo. Las conversaciones administrativas verificadas son una fuente de memoria solicitada; también se deben guardar resúmenes de conversaciones con participantes. Un ciclo sugerido:

1. Rulo responde y la interacción queda registrada por los sistemas existentes.
2. Rulo genera resúmenes con fuente, fecha e identidad estable, y conserva los recuerdos permitidos sin vencimiento en esta primera etapa. Del chat real, solo toma mensajes administrativos verificados que expresen hechos o instrucciones duraderos y relevantes. Los mensajes de la simulación privada quedan fuera, salvo el trabajo de mejora pedido explícitamente allí, que produce una propuesta aislada.
3. Las memorias de baja confianza, los datos ambiguos y cualquier cambio a personalidad o reglas quedan pendientes para que un administrador los revise.
4. Las pruebas repetibles comprueban las respuestas sin mezclar sus mensajes con el historial real ni con la Ruleta.
5. Los casos evaluados permanecen pendientes de revisión humana. Las correcciones de entrenamiento se incorporan manualmente.

No se debe marcar automáticamente un caso de evaluación como aprobado ni entrenar el modelo por el solo hecho de que la IA generó una respuesta.

## Privacidad y límites heredados

- Minimizar el contexto enviado al proveedor de IA: no pasar el historial completo si bastan el comentario actual y unos pocos hechos aprobados.
- Identificar la fuente y fecha de un recuerdo; no presentar una inferencia como si la persona la hubiera confirmado.
- Los recuerdos no vencen inicialmente por decisión del usuario; dejar prevista una opción futura de expiración/retención y un procedimiento de borrado.
- No revelar públicamente preferencias o notas privadas de una persona sin una razón clara y configuración apropiada.
- Mantener identificadores privados en el servidor y fuera de prompts y páginas de navegador cuando no sean necesarios.
- Respetar el aislamiento de pruebas y la lotería estrictamente de solo lectura en simulaciones históricas.
- No tratar los mensajes privados de **Simular Streaming en VIVO** como memoria; una solicitud explícita de mejora hace que Rulo trabaje en una versión revisada dentro de la prueba y puede dejar una propuesta para revisión manual. Los mensajes del chat general en vivo nunca actualizan personalidad ni entrenamiento. Solo los mensajes administrativos del vivo real verificados y clasificados como hechos o instrucciones duraderos pueden alimentar la memoria operativa.
- No guardar API keys, bearer tokens, contraseñas ni IDs privados en el nuevo directorio o en el prompt.
- Conservar la autenticación, orígenes locales exactos y límites actuales de Control Cortex; nunca abrir CORS con `*`.

## Alcance y estado por etapas

1. **Perfil y cuatro tonos — implementado:** perfil estructurado, Normal (2) inicial, modos Automático/Manual persistentes y puntaje 0–40. Los umbrales y el descenso por descanso son valores iniciales para calibrar.
2. **Simulación aislada — implementada:** `/rulo-hablar.html` puede probar el perfil desde una opción desactivada por defecto. No cambia el generador público ni guarda mensajes privados.
3. **Migración de la base actual — iniciada:** se guardaron la instrucción antigua, ajustes y variantes de 22 contextos, además de la política de contexto reciente. Son snapshots; falta revisar placeholders y mover la edición detrás de una API compatible. El origen sigue siendo el activo.
4. **Cuaderno del programa y memoria por participante — siguiente etapa:** recuperar hechos aprobados y recuerdos/resúmenes pertinentes desde fuentes actuales; identidad estable, procedencia, confianza, visibilidad, corrección y borrado. No vencen al principio; dejar contemplada la expiración futura. No copiar el archivo crudo entero.
5. **Aprendizaje administrativo:** usar solo mensajes del chat real con rol/identidad verificados y contenido duradero. Las conversaciones del simulador no se guardan; una solicitud explícita de mejora inicia el trabajo en esa conversación y cualquier cambio persistente queda para revisión manual.
6. **Intervenciones espontáneas:** interruptor independiente para el chat real y límites de frecuencia/enfriamiento; no convertirlas en respuesta automática a cada mensaje.
7. **Integración pública:** comparar en modo aislado, conservar fallback y migrar un solo consumidor por vez. Spotify mantiene parser, OAuth, cola y decisiones de reproducción.

## Decisiones técnicas pendientes

- Identificar la fuente de rol administrativo verificable disponible en el chat real y usar identidad estable para memoria; nunca unir participantes solo por nombre.
- Revisar los rangos 0–9, 10–19, 20–29 y 30–40, los pesos de cada señal y el descenso por descanso con casos de simulación antes de conectarlos al tráfico real.
- Definir límites iniciales de frecuencia y enfriamiento para las intervenciones espontáneas.
- Cerrar el esquema y los permisos de la memoria local antes de importar resúmenes históricos. El diseño acordado permite corregir y borrar recuerdos, los conserva sin vencimiento inicialmente y no almacena el chat privado de simulación.
- Comparar las variantes importadas y confirmar sus placeholders/contexts antes de activar el editor de Cuaderno Vivo.

El módulo usa por ahora la configuración de IA que ya tiene Rulo. Las reglas de seguridad, las acciones y los hechos verificados siguen bajo sus módulos actuales; la memoria no reentrena el modelo ni cambia el perfil sin revisión.

## Referencias del proyecto

- [Instrucciones generales del proyecto](../AGENTS.md)
- [README de Rulo](../Rulo/README.md)
- [README de Rulo Spotify](../Rulo/Spotify/README.md)
- [Simulación de vivos históricos y revisión manual](../Rulo/README-SIMULACION-VIVOS.md)
- [Entrenamiento del bot y estilo musical](../Rulo/Spotify/spotify-training.html)
- [Configuración del vocabulario y respuestas](../Rulo/Spotify/spotify-vocabulary.json)
- [Procesamiento de pedidos y respuestas Spotify](../Chat%20Bot%20Spotify/src/spotify.js)
- [Backend de respuestas y conversación de Rulo](../Control%20Cortex/backend/server.js)
