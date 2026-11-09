# Cambios del proyecto

Registro por módulo. Cada entrada indica qué se modificó y qué debe recargarse para que la versión nueva entre en uso.

## 2026-11-09 — Preferencias compartidas y paneles espejo

- Inicio de Cortex guarda en su archivo de estado compartido el tema y los perfiles de transmisión; migra la preferencia del navegador una vez y distribuye cambios entre paneles abiertos. Los cachés de estado siguen siendo locales.
- Se corrigió la carga de Inicio cuando el estado cacheado de servicios estaba activo: el botón de TriggerStudio ya no se consulta fuera del bloque que lo crea.
- Lotería guarda su configuración operativa en un archivo local excluido de Git. Los dashboards leen y actualizan la copia del servidor; el token y el endpoint específico de cada cliente quedan fuera de esa copia.
- Tailscale HTTPS ahora envía el WebSocket de Lotería por el mismo origen y Cortex lo retransmite al servidor local del módulo con límite de tamaño, búfer y comprobación de origen. OBS y las páginas HTTP mantienen su conexión local.
- Los módulos que ya persisten su configuración en sus servicios locales mantienen esa única fuente de verdad. Las claves y tokens continúan en archivos protegidos o en el navegador del operador.
- Recarga Inicio y los dashboards con Ctrl+F5. La primera dirección que abra Inicio migra el tema y perfil anteriores de ese navegador; después el servidor comparte esa preferencia entre las direcciones.

## 2026-11-08 — Cuaderno Vivo: memoria revisable por participante

- Añadida memoria SQLite local asociada por HMAC a identidades estables ya vinculadas en el archivo de audiencia; la base nueva no guarda IDs de participantes.
- El dashboard permite buscar, agregar, corregir y borrar recuerdos. También puede solicitar propuestas a partir de hasta 120 comentarios y respuestas públicas archivadas; cada propuesta requiere revisión y guardado manual.
- La memoria se incluye como contexto únicamente en respuestas de Cuaderno Vivo dentro de Simular Streaming en VIVO y solo con identidad estable. Los recuerdos marcados «Solo administración» quedan fuera del prompt.
- Los mensajes privados del simulador no se persisten ni se usan para propuestas. El historial público permanece en SQLite de audiencia y no se copia al módulo nuevo.
- Los respaldos de Cortex ahora incluyen la base de memoria y su clave HMAC juntas. Se documentó el procedimiento de restauración en pareja.
- El aprendizaje automático de administradores reales sigue pendiente hasta disponer de una fuente verificable de rol e identidad; el perfil administrativo del simulador no se considera autenticación.
- Reinicia Control Cortex y recarga `/rulo-cuaderno-vivo.html` y `/rulo-hablar.html` para cargar las rutas nuevas.

## 2026-11-08 — Rulo · Cuaderno Vivo (primera etapa)

- Creado el módulo lógico `Rulo - Cuaderno Vivo` con perfil entrerriano/argentino, cuatro tonos, puntaje acotado y modos Automático/Manual; la elección Manual persiste hasta volver explícitamente a Automático.
- Añadido el dashboard `/rulo-cuaderno-vivo.html` y sus rutas locales de estado, control y vista previa en Control Cortex.
- El simulador `/rulo-hablar.html` puede usar Cuaderno Vivo de forma opcional y aislada. El chat público conserva el generador actual y las acciones Spotify continúan en sus rutas existentes.
- Guardados snapshots de la instrucción de estilo anterior, los 22 contextos de respuesta y la política de contexto reciente. No se copiaron mensajes de audiencia ni datos de identidad; los archivos de origen siguen siendo los activos.
- Las señales reales de carga, editor de catálogo y migración del generador público quedan para etapas posteriores; la memoria por participante se añadió en la etapa siguiente.
- Reinicia Control Cortex y recarga el simulador para habilitar las rutas y el dashboard nuevos.

## 2026-11-06 — Trazabilidad, evaluación, arranque y estado de Cortex

- Se agregó trazabilidad técnica temporal por evento entre Chat Bot Spotify y Cortex, con un `traceId` aleatorio y sin comentario, nombre ni ID de usuario. Cortex ofrece `/event-traces.html` para consultar las últimas etapas.
- La biblioteca de casos de Rulo puede ejecutar en lote los casos del programa actual en vista previa aislada. Cada respuesta queda pendiente de revisión humana en SQLite; la suite no publica comentarios en OBS ni reproduce Spotify.
- `npm run test:regression` cubre el contrato de trazas, la suite de Rulo, seguridad IAFAS, idempotencia de premios y los flujos críticos de captura y reproducción Spotify.
- Validación final: 42 pruebas pasaron y `npm run check` de IAFAS terminó correctamente.
- `Iniciar Control Cortex.bat` reutiliza una instancia sana, no mata procesos que ocupen el puerto por accidente y hace el sondeo de arranque en un solo proceso de PowerShell.
- Inicio de Cortex muestra el resumen cacheado del perfil seleccionado durante la verificación, identifica que es un dato guardado y bloquea controles de servicios hasta recibir estado actual. Se eliminó el sondeo duplicado cada 20 segundos y el chequeo de OBS ya no retrasa el primer resumen.
- El módulo IAFAS dejó de incluir credenciales admin de ejemplo y contraseñas de cron por defecto. El login requiere hash bcrypt, el cron exige una clave segura en encabezado y los comodines CORS/WebSocket se ignoran en producción.
- Se sincronizaron los pendientes históricos y se corrigieron descripciones de seguridad y del destacado que ya no coincidían con la implementación.
- Chat Bot Spotify mantiene Facebook como única plataforma de captura dentro del alcance acordado.
- Antes de volver a iniciar IAFAS en producción, completa sus secretos y orígenes permitidos en `.env`; después reinicia ese servicio.

## 2026-11-05 — Corrección manual del cupo de tickets extra

- Se añadió al historial de premios del dashboard un selector de entregas confirmadas, una consulta del cupo extra actual en Cdelu y un campo para guardar el nuevo total.
- La corrección reutiliza la lógica de tickets extra de Cdelu mediante la función callable autenticada. Firestore guarda el cambio y su idempotencia; SQLite local (`rulo_roulette_ticket_adjustments`) y el historial de Comentarios guardan la auditoría/resumen.
- Se muestra por separado el límite base y la cantidad de números ya asignados. Reducir el cupo extra no elimina ni libera números existentes.
- Se compiló la función Firebase y se verificó la sintaxis de los servidores y del script del dashboard. No se modificó ningún premio real durante la implementación.

## 2026-11-05 — Premios manuales de la Ruleta

- La Ruleta ya no entrega automáticamente todos los premios habilitados al terminar un giro. El operador pulsa **Asignar premio** debajo del ganador y confirma un premio, la lotería Cdelu y la cantidad de tickets.
- El overlay muestra progreso y el resultado; la entrega está bloqueada en vistas previas y con Modo de pruebas aislado activo.
- El servidor valida el ganador del giro actual, conserva la identidad necesaria fuera del navegador y evita duplicar la misma pareja giro/premio. Cortex pasa la operación a la función de Firebase que reutiliza la lógica existente de tickets extra.
- Se reinició `comentarios` para aplicar el overlay y la ruta local. Se validaron sintaxis y respuestas HTTP de dashboard/API; no se ejecutó una entrega real de tickets.

## 2026-10-31 — Spotify Desktop y Chat Bot Spotify

- Chat Bot Spotify conserva la cola de reproducción local y adopta la solución guardada para clientes de escritorio: encolar el pedido como siguiente, verificar la cola, saltar y confirmar la pista activa antes de anunciar éxito.
- Si hay offset de inicio, el módulo silencia el cambio, aplica el salto y restaura el volumen; ante un fallo evita anunciar una reproducción que Spotify no confirmó.
- Este flujo usa el OAuth PKCE del módulo propio, sin depender del consumidor de comandos de SocialStream Ninja.
- Recarga el panel con Ctrl+F5. Chat Bot Spotify fue reiniciado para cargar el cambio; la extensión de Facebook debe reconectarse.

## 2026-10-29 — Estabilidad de pedidos Spotify

- Los pedidos de Facebook capturados por Chat Bot Spotify ahora entran autenticados en la cola serializada de Control Cortex, que usa su ruta de reproducción con espera y confirmación.
- Chat Bot Spotify dejó de competir por los comandos de Cortex y dejó de consultar el reproductor cada cinco segundos.
- Las llamadas Spotify que aún usa el panel tienen límite de 12 segundos y pausa ante errores 429 para liberar el flujo si Spotify no responde.
- Control Cortex deduplica reintentos de un mismo comentario y conserva usuario, cuenta y transmisión de origen en el comando.

## 2026-10-29 — Chat Bot Spotify 1.2.1

- El flujo PKCE conserva su verificador temporal durante reinicios y elimina la sesión al completar, cancelar o vencer la autorización.
- El dashboard bloquea la prueba de búsqueda antes de conectar Spotify e indica que esa prueba no reproduce audio.
- Añadida una prueba de reproducción de una sola pista que exige aislamiento activo y conexión OAuth; no crea eventos de chat, pedidos permanentes ni participantes.
- La captura nueva recibe comentarios de Facebook sin necesitar SocialStream Ninja; los pedidos musicales pasan por la cola de reproducción de Control Cortex y el flujo de chat conserva los destinos de Cortex y Comentarios/Ruleta.

## 2026-10-29 — Chat Bot Spotify 1.2.0

- Añadidos latidos y métricas por pestaña/cuenta/transmisión en el dashboard. El popup permite etiquetar cada perfil de navegador.
- Añadidos metadatos de origen al contrato de chat y deduplicación estable de Facebook en la base permanente.
- El modo de pruebas mantiene eventos temporales en memoria y bloquea el reenvío a receptores que no declaren soporte de aislamiento.
- El control global sincroniza los tres módulos y consulta su capacidad antes de permitir pruebas; los comentarios del relay de SocialStream se enrutan a temporal y no se guardan en su cola durable durante una prueba.
- El dashboard carga sus ajustes también si se abre por la IP LAN de esta misma PC; si falla la sincronización de pruebas, guarda los demás cambios y deja visible el aviso sin fingir que cambió el modo global.
- Restringido CORS a extensiones y orígenes locales; las llamadas de configuración y captura siguen usando bearer token.
- El servidor informa de forma breve cuando el puerto 9765 ya está ocupado.

## 2026-10-29 — Control Cortex / Rulo

- Los comentarios de prueba autorizados se separan del historial normal, SQLite y almacenamiento de avatares.
- El historial normal se guarda mediante reemplazo atómico. El CSV de audiencia exporta los metadatos de cuenta y transmisión y neutraliza valores que Excel pueda interpretar como fórmulas.
- Añadidos respaldos SQLite consistentes al iniciar, cada 24 horas y a demanda; retención de siete copias con historial y avatares.
- Añadida validación de origen para el modo global de pruebas y operaciones locales de historial; CORS se limita a orígenes locales y SocialStream Ninja.

## 2026-10-29 — Comentarios / Ruleta

- Los participantes de prueba van a una lista temporal que no modifica la ruleta real ni `config.json`.
- El dashboard separa y permite limpiar la lista temporal de pruebas.
- Los participantes reales guardan la cuenta y transmisión de origen para consulta posterior.

## Aplicación de los cambios

Estos cambios son locales y no crean commits automáticos. Para la entrada del 2026-11-06, configura IAFAS como se indica arriba y reinicia el servicio; reinicia Control Cortex y Comentarios; reinicia Chat Bot Spotify y recarga su extensión desde la página de extensiones del navegador. Conserva el estado actual del repositorio: ya contenía cambios de usuario fuera de esta entrega.
