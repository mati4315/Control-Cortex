# Rulo

Espacio independiente para las funciones y overlays propios del bot. Todo lo nuevo de Rulo vive acá; SocialStream Ninja solo consume copias vía `local-overrides`.

## Páginas (servidas por Control Cortex en el puerto 4000)

| Página | URL | Uso |
| --- | --- | --- |
| Overlay de respuestas | `http://192.168.4.100:4000/rulo-bot-overlay.html` | Fuente Navegador de OBS. Solo respuestas del bot. |
| Dashboard | `http://192.168.4.100:4000/rulo-dashboard.html` | Configuración visual, URLs para OBS y vista previa por estado. |
| Historial | `http://192.168.4.100:4000/rulo-chat-historial.html` | Comentarios de audiencia + respuestas, con filtros y limpieza. |
| Animaciones y control de Rulo | `http://192.168.4.100:4000/rulo-mascota.html` | Panel: WebM para OBS o control del ejecutable Rulo 3D en la LAN. Desde otra PC, usa la IP de la PC donde corre Cortex. |
| Dashboard de Spotify | `http://192.168.4.100:4000/rulo-spotify.html` | Ajustes del cambio automático de música: esperas, modo prueba sin esperas, dispositivo, pruebas y registro. |
| Cuaderno Vivo | `http://192.168.4.100:4000/rulo-cuaderno-vivo.html` | Control inicial del tono Automático/Manual y personalidad para probar desde la simulación aislada. |
| Entrenamiento del bot | `http://192.168.4.100:4000/rulo-spotify-training.html` | Vocabulario (palabras clave, verbos, géneros, correcciones) con analizador en vivo y el cerebro (IA) opcional. |
| Redirección legada | `http://192.168.4.100:4000/rulo-chat-dock.html` | 302 a `rulo-chat-historial.html` para no romper enlaces viejos. |

Los enlaces de navegación entre paneles no llevan `?session=...`. El Session ID se conserva en las URLs de overlays que se conectan a una sala SSN, como el overlay de chat y el overlay unificado.

La conversación de prueba y simulación histórica de participantes está documentada en [README-SIMULACION-VIVOS.md](README-SIMULACION-VIVOS.md). Resume el propósito de evaluación, el contexto SQLite, el aislamiento de mensajes, los pedidos de Spotify con el nombre e ID histórico del participante y credenciales solo en el servidor, la lotería en solo lectura y el flujo de mejoras manuales en Entrenamiento e IA. El simulador puede activar como opción la vista previa de Cuaderno Vivo; el generador del chat público sigue sin migrarse.

La URL base ya no está escrita a mano en varios archivos: el backend la detecta (`GET /api/cortex-base-url`) y genera `SocialStream Ninja/local-overrides/cortex-base-url.js` en cada arranque. Si cambia la IP LAN, se actualiza sola (los overrides la consumen con respaldo).

## Control del ejecutable Rulo 3D

El primer card de `/rulo-mascota.html` incluye el selector **Método activo para este panel**. **Clips WebM en OBS** conserva el método anterior; **Ejecutable Rulo 3D** conecta el navegador directamente a `RULO.exe` por WebSocket/TCP 4101. Esta conexión no requiere cambiar el servidor de Control Cortex.

1. Ejecuta `D:\Codot Model Rulo\FORMATO WINDOWS\RULO.exe` en la PC que renderiza el modelo (junto a `RULO.pck`).
2. Abre este panel y selecciona **Ejecutable Rulo 3D**. Debe aparecer **RULO.exe conectado**.
3. El interruptor de Rulo enciende/apaga el modelo. Al encenderlo se reproduce `Start_Apareciendo_01`; por ahora **Iniciar** y **Aparecer** usan esa misma animación, **Ocultar** esconde el personaje.
4. Desde otra PC abre `http://192.168.4.100:4000/rulo-mascota.html` (reemplaza la IP cuando cambie la PC de Cortex). Permite entrada TCP 4101 a `RULO.exe` en el perfil de red privada de Windows Firewall.

El modo 3D no llama al control histórico de energía de Cortex: los pedidos de música y el bot siguen bajo Cortex. Cambiar de método no apaga el otro motor; el panel exige apagar Rulo 3D antes de volver a WebM. Hablar, normal, dormir, presentación, segundo objeto y tomar mate con animación todavía requieren animaciones y acciones 3D. La opción **Interacción con mate 3D** solo activa detección por proximidad y emite un evento; no mueve el personaje ni agarra el mate.

El WebSocket de RULO.exe exige la clave compartida `RULO_CONTROL_TOKEN` que configura el lanzador protegido. El panel pide esa clave para autenticar la conexión. Mantén además la regla de Firewall limitada a una red privada confiable y no publiques el puerto 4101 hacia Internet.

## Nombre visible: una sola fuente de verdad

`Rulo/rulo-config.json` manda. El payload del módulo de Spotify ya **no** puede pisar el nombre del overlay: el backend fuerza `botName` con el valor de la configuración (`POST /api/rulo-config` desde el dashboard).

- El nombre del overlay, del historial y del dashboard sale de `rulo-config.json`.
- El dock propio de SocialStream Ninja sigue usando `spotifyBotName = "Anormalia"` dentro de la extensión: es otra superficie y se cambia desde los ajustes de SSN, no desde Rulo.
- El texto fijo `Anormalia 22` del overlay de letras es el nombre del programa elegido por el usuario; no lo toca nada.

## Estados (mood) de la mascota

### Animaciones WebM en OBS

El panel `/rulo-mascota.html` controla la fuente `/rulo-animaciones.html` y permite disparar o reemplazar entrada, habla, estado normal y sueño.
- **Estado Normal / Esperando** (`animaciones/Estado Normal - Esperando.webm`): es la animación por defecto en bucle continuo mientras Rulo está visible. Al finalizar la «Entrada» o tras cada respuesta de «Habla», Rulo vuelve y continúa automáticamente en este estado en bucle esperando la siguiente animación.
- **Entrada** (`animaciones/aparece de abajo.webm`): reproduce la aparición una vez y pasa de inmediato a estado normal en bucle.
- **Habla** (`animaciones/hablando.webm`): reproduce el habla una vez con cada respuesta real y al terminar continúa en estado normal en bucle.
- **Sueño** (`animaciones/Rulo Durmiendo.webm`): reproduce 0–28 segundos una vez y luego repite 9–28. Rulo entra en sueño tras 4–6 minutos de inactividad mientras está visible. Cualquier actividad o acción pendiente completa el video y pasa a estado normal o a la acción correspondiente.

La lógica se comprueba con `node --test Rulo/tests/rulo-animation-sleep.test.cjs`.

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
| POST | `/api/rulo-chat-clear` | Vacía solo el historial reciente visible; el archivo permanente de audiencia se conserva. Emite `rulo_chat_cleared`. |
| POST | `/api/rulo-repeat-response` | Repite una respuesta en el overlay (mood `speaking`). |
| POST | `/api/rulo-animation-trigger` | Disparador manual: `aparecer`, `hablar` u `ocultar`. |
| POST | `/api/rulo-animation-upload/aparecer` o `/hablar` | Reemplaza el clip WebM correspondiente (máximo 100 MB). |
| GET | `/api/cortex-base-url` | URL base LAN detectada + Session ID. |

Eventos WebSocket: `rulo_bot_message`, `rulo_chat_item`, `rulo_chat_cleared`, `rulo_config_updated`.

## Historial persistente

- Se guardan hasta 200 comentarios en `Rulo/rulo-chat-history.json` (se escriben con retardo de 400 ms para no golpear el disco).
- Al arrancar el backend se restauran; el WS y el GET entregan los últimos 50.
- Todos los comentarios recibidos también se agregan a `Rulo/Spotify/spotify-analytics.db`, tabla `audience_comments`, sin límite de retención ni eliminación automática. Se guardan fecha local del programa, plataforma, nombre/ID del usuario cuando está disponible, comentario, evento y respuesta asociada de Rulo.
- En Inicio de Cortex → Asistente IA hay una sección separada para consultar el archivo de audiencia en modo de solo lectura: ranking por cantidad de comentarios, participación en más fechas, total del archivo, fechas de actividad por nombre y palabras frecuentes. Las consultas usan SQLite con operaciones fijas; no ejecutan SQL escrito por usuarios ni aplican cambios a overlays. El proveedor de IA recibe la pregunta y solo el agregado necesario, nunca el texto completo de los comentarios.
- Rulo saluda una vez por fecha a cada participante que vuelve y que ya aparece en otra fecha archivada. Para no pisar una respuesta reciente, espera si Rulo habló en los últimos 2 minutos y limita los saludos globales a uno cada 3 minutos. Este saludo requiere que Rulo esté encendido y que la identidad coincida; si cambia de nombre y no hay ID estable, puede no reconocerlo.
- En esa misma sección, **Resumen del último programa** resume la fecha más reciente archivada: comentarios, participantes, respuestas de Rulo, reacciones, palabras repetidas y tramos de cinco minutos con más actividad. El archivo agrupa por fecha local de Argentina, por eso dos emisiones en el mismo día aparecen juntas. Los momentos son picos de actividad, no una transcripción ni una valoración automática de cada comentario.
- Las consultas admiten preguntas abiertas y perfiles básicos, por ejemplo “¿Qué suele pedir Ana?”. Para resumir intereses se cuentan palabras repetidas de sus comentarios. La IA recibe nombres y estadísticas agregadas, nunca el texto completo de comentarios, imágenes ni IDs; cuando no hay evidencia suficiente debe indicarlo.
- Para Facebook, la identidad prioriza el ID numérico de cuenta cuando Social Stream puede leerlo del enlace de perfil o del hovercard del comentario; se guarda en `facebook_user_id`. Para las demás plataformas se usa `userid`, separado por plataforma. Si no llega un ID verificable, se usa una clave aproximada basada en nombre. Facebook no expone ese ID en todos los comentarios; en esos casos queda vacío y se conserva el nombre como alternativa.
- La tabla SQLite `user` conserva solo identidades con al menos un comentario cuyo `program_number` está asignado; `audience_comments.audience_user_id` la vincula con sus comentarios. Los comentarios sin número no crean usuarios nuevos hasta que se les asigne un programa. Incluye `facebook_user_id` y `ID_facebook`, únicos cuando tienen valor; `ID_facebook` queda `NULL` hasta que se indique cómo obtenerlo. La limpieza dejó 18 identidades de programas numerados: 8 tienen `facebook_user_id` y 10 son históricas sin ese dato. No se inventan IDs ni se fusionan usuarios solo por el nombre.
- Las fotos de perfil recibidas como WebP se guardan localmente en `Rulo/profile-avatars/` con nombre basado en el hash del archivo. SQLite conserva la ruta local en `audience_comments.avatar_path`, y `/api/rulo-chat-archives/:program` la devuelve como `avatarUrl` para que la Ruleta pueda importarla. Si una persona vuelve a comentar, se completan sus registros antiguos cuando coincide el ID estable; el cruce por nombre se limita a casos sin otra identidad con ese mismo nombre y plataforma.
- Recuperación inicial: pude asociar siete fotos ya existentes al programa 9 porque sus horas de archivo coinciden de forma única, con diferencia de milisegundos, con `received_at` de comentarios. No encontré una relación confiable para el programa 8; las fotos sin coincidencia quedan sin asignar.
- En esa sección también se muestra el porcentaje de comentarios que llegaron con ID estable. Los registros históricos importados no lo incluían; el porcentaje debe crecer con los nuevos comentarios si la plataforma entrega el campo.
- Al arrancar el backend, el archivo SQLite importa el historial JSON existente y los comentarios de pedidos musicales ya registrados en `interactions`; la clave de contenido evita volver a insertar el mismo mensaje.
- Social Stream conserva temporalmente en IndexedDB del navegador los comentarios que Cortex no pudo confirmar y los reenvía al reconectarse. Si IndexedDB no está disponible, el respaldo temporal queda en memoria hasta que se recargue la página.
- El botón **Limpiar historial** pide confirmación y limpia únicamente la vista reciente (memoria + JSON). El archivo permanente SQLite no se borra con ese botón.

## Archivos

| Archivo | Uso |
| --- | --- |
| `rulo-bot-overlay.html` | Fuente Navegador de OBS. Acepta `?preview=1&mood=<estado>` y `?theme=light\|dark` (el parametro gana sobre la config) para probar sin OBS. |
| `rulo-dashboard.html` | Configuración visual, URLs para OBS y vista previa por estado. |
| `rulo-chat-historial.html` | Docks de chat: estado P2P (con aviso persistente y marca roja en "Mas Opciones" cuando no hay peers), destacar comentarios y, en el panel inferior "Mas Opciones", los filtros (texto, plataforma, "solo sin respuesta", contador) y "Limpiar historial". La respuesta sin contenido no se muestra (la celda queda invisible y aparece cuando llega). En el centro del encabezado: lupa - / Restablecer / lupa + para el tamano de letra (80%-180%, recordado entre sesiones). El estado (Conectado / Peers P2P) y el link Dashboard viven adentro de "Mas Opciones". El encabezado arranca siempre colapsado (titulo y boton ocultos; queda la barra de letra) y el scroll no lo cambia: la unica forma de mostrarlo es la flecha de la punta izquierda. Esa barra tiene lupa -, Restablecer y lupa +; en la punta derecha el boton sol/luna que cambia entre tema oscuro (por defecto) y claro. El tema se recuerda entre sesiones y afecta solo a esta pagina. Filas alternadas: en dos columnas por fila (comentario+respuesta juntos) y, apilado en movil, por celda para que nunca queden dos del mismo color pegados. Header mas claro que el resto. En movil (<=620px) los controles de letra quedan como barra justo arriba del chat. |
| `rulo-mascota.html` | Panel de animaciones, disparadores y carga de videos para OBS. |
| `rulo-animaciones.html` | Fuente de navegador transparente para OBS; entrada manual y animación automática al llegar respuestas reales. |
| `rulo-animaciones-dashboard.html` | URL antigua; redirige al panel unificado de `rulo-mascota.html`. |
| `rulo-chat-relay.js` | Override SSN que replica mensajes no-bot hacia Cortex. |
| `rulo-config.json` | Configuración persistente de Rulo. |
| `rulo-chat-history.json` | Historial reciente persistente (máximo 200); el archivo completo vive en la tabla `audience_comments` de SQLite. |
| `profile-avatars/` | Fotos WebP locales, identificadas por hash y vinculadas a cada comentario en SQLite. |
| `assets/` | `states.json` + `README.md` de la mascota (sin arte todavía). |
| `Spotify/` | `spotify-dashboard.html` (ajustes), `spotify-training.html` (entrenamiento del bot), `spotify-settings.json` + `spotify-vocabulary.json` + `spotify-aliases.json` (datos editables) y los generados (`spotify-request-log.json`, `spotify-devices.json`) + su `README.md`. |

## Ajustes de música (Spotify)

La fuente única de verdad de los pedidos de música es `Rulo/Spotify/spotify-settings.json`, controlada
desde `/rulo-spotify.html`. Chat Bot Spotify consulta esos ajustes y procesa los comentarios con su
OAuth propio. El dashboard envía búsquedas, pruebas aisladas, simulaciones, transporte y dispositivos
por un proxy del backend de Cortex, que conserva el bearer token en el servidor. La cola de
`GET /api/spotify-client-state` y `spotify-auto-music.js` siguen disponibles solo para instalaciones
viejas de SSN; los pedidos actuales no los usan. Detalle completo en `Rulo/Spotify/README.md`.

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

- La ruta actual de destacado usa el overlay propio de Chat Bot Spotify mediante `POST /api/featured`; el puente P2P de VDO/SSN queda como referencia heredada. Falta conservar una comprobación de extremo a extremo después de cambios en el historial, el proxy de Cortex o el overlay.
- No hay arte de mascota todavía (ver `rulo-mascota.html` para elegir dirección).
