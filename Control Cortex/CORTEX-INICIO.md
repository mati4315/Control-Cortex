# Cortex Inicio

Abre **http://localhost:4000/** o el acceso `ABRIR CORTEX.url` de la carpeta principal. Si el servidor está apagado, usa `Iniciar Control Cortex.bat`. El lanzador reutiliza Cortex si ya responde; no mata procesos del puerto 4000. Si otro proceso ocupa ese puerto, muestra un error para evitar cerrarlo por accidente. Para reiniciarlo desde el panel, pulsa **Reiniciar Cortex** en la barra superior y confirma; el backend vuelve a iniciar y el panel se recarga automáticamente. Esta acción está disponible desde el origen del panel, incluido su enlace HTTPS privado de Tailscale; mantén el acceso a tu tailnet limitado a tus dispositivos. Desde otra computadora, usa la IP del equipo Cortex y el puerto 4000.

## Instalar Cortex en Android con Chrome

Cortex incluye un manifiesto PWA. Para que Chrome permita instalarlo desde fuera de la red local, usa HTTPS privado con Tailscale Serve. En la PC de Cortex, con Tailscale conectado y el backend funcionando, abre PowerShell como Administrador y ejecuta `tailscale serve --bg 4000`. Tailscale mostrará una dirección HTTPS privada con el nombre MagicDNS de esa PC, por ejemplo `https://nombre-equipo.nombre-red.ts.net`. Si solicita habilitar HTTPS para la tailnet, sigue el enlace que entrega el comando y vuelve a ejecutarlo. No uses Tailscale Funnel ni abras el puerto 4000 en el router.

En Android, confirma que Tailscale esté conectado y abre esa dirección HTTPS en Chrome. En el menú ⋮ elige **Instalar app** (o **Añadir a pantalla de inicio** y luego **Instalar**). La PC debe permanecer encendida, Cortex iniciado y Tailscale conectado para usar la aplicación. Para retirar el acceso HTTPS privado, ejecuta `tailscale serve off` en la PC.

El PWA muestra abajo los accesos para copiar la dirección y volver atrás. Los dashboards integrados de Cortex y los paneles de módulos registrados cargan la misma barra rápida. Los módulos en otros puertos siguen necesitando que ese servicio y el puerto 4000 de Cortex sean accesibles desde el dispositivo; los overlays de OBS no incluyen estos controles.

## Organización

Inicio reúne los dashboards de Rulo y los servicios registrados en Cortex. Busca por función, filtra por categoría y marca estrellas para encontrar tus favoritos primero. «Añadir acceso» incorpora otros dashboards mediante su URL. Cada perfil conserva sus favoritos y enlaces. Para añadir un proceso que Cortex pueda arrancar o detener, usa **Control de servicios**, disponible en `/index.html`.

Los enlaces a localhost de los servicios se adaptan al equipo que sirve Cortex. La navegación entre dashboards ya no agrega el parámetro legado `?session=...`; el Session ID se mantiene solo en las URLs de overlays que lo necesitan para identificar la sala de SocialStream Ninja. No se mueven las carpetas ni se cambian las URLs de OBS.

## Perfiles

«Por defecto» y «Pruebas» se crean con una copia de los ajustes actuales al abrir Inicio por primera vez. **Crear perfil** copia los ajustes en uso y la organización actual; activarlo es un paso separado. Puedes renombrar, exportar y eliminar perfiles que no estén activos. «Por defecto» se conserva siempre.

Al activar otro perfil:

1. Se capturan los ajustes actuales del perfil que dejas.
2. Se escribe un respaldo de recuperación en `backend/cortex-home.json.recovery.json`.
3. Se aplican los ajustes del perfil elegido mediante las APIs existentes, incluyendo sus notificaciones a overlays y al cliente de Spotify.
4. Si falla una API, se intenta restaurar lo anterior y se informa del resultado.

**Pruebas usa la misma sesión en vivo.** Cambiar de perfil afecta a Spotify y los overlays actuales. Evita editar otros dashboards mientras se aplica el cambio. Son perfiles de configuración compartidos en el servidor, no cuentas con contraseña ni entornos aislados. La transición entre módulos es secuencial; no es una transacción instantánea para OBS.

Incluye apariencia de Rulo, overlay unificado, ajustes de Spotify y vocabulario/respuestas del bot, configuración visual de Luces, Clima y Tiempo, Ruleta de Comentarios y Bienvenidas/Banner, además de favoritos y accesos. Los servicios detenidos también se respaldan desde sus archivos locales y reciben el perfil antes de iniciarse. Credenciales, conexión de IA, participantes e historial de ganadores, alias aprendidos, historial de chat, servicios PM2 y ajustes de conexión OBS se mantienen globales y protegidos.

«Guardar ajustes actuales» crea un punto guardado del perfil en uso. La exportación del perfil activo captura sus ajustes actuales; la de otro perfil usa su última copia guardada. Cambiar de perfil también guarda automáticamente el que dejas. Los ajustes que edites en los dashboards siguen guardándose allí, como antes.

**Importar** acepta JSON Cortex versión 1 o 2 y crea otro perfil, sin activarlo ni sobrescribir uno existente. Los respaldos versión 1 se completan con los ajustes actuales de los overlays añadidos. No importa claves ni endpoints de IA. Tamaño máximo de importación: 1 MB. Los respaldos contienen ajustes de overlays, no una copia completa del proyecto. Los enlaces personalizados pueden contener información escrita por el usuario: revísalos antes de compartir un respaldo.

Los perfiles se guardan en `backend/cortex-home.json`, excluido de Git. No lo borres para reiniciar el servidor. Si hay un error de lectura se informa y no se reemplaza silenciosamente. Tras una interrupción durante la activación, el archivo `.recovery.json` contiene los ajustes previos por módulo; un técnico puede reaplicarlos mediante sus respectivas APIs. No hay recuperación automática después de un cierre forzado.

## Asistente IA

La pestaña **Asistente IA** deja elegir entre la IA que ya usa Rulo, Google Gemini y OpenAI, y guardar su proveedor/modelo sin alterar los ajustes de Spotify. Incluye Gemini 3.6 Flash (`gemini-3.6-flash`) y GPT-5.4 nano (`gpt-5.4-nano`), una opción de bajo costo de OpenAI. Puedes elegirlos de la lista o escribir otro ID compatible.

Cada proveedor necesita su propia clave en `Control Cortex/backend/.env`: Rulo usa `SPOTIFY_AI_API_KEY`, Gemini usa `GEMINI_API_KEY` y OpenAI usa `OPENAI_API_KEY`. Son claves diferentes; la interfaz solo confirma si encontró la del proveedor elegido y nunca revela valores. Añade la clave correspondiente y reinicia Cortex. La URL del proveedor y la activación de la conexión de Rulo se administran desde **Entrenamiento e IA** (`/rulo-spotify-training.html`).

Admite endpoints compatibles con `/chat/completions` y `/responses`. El índice local de contexto reúne los documentos Markdown y un mapa de rutas HTTP, eventos de socket y esquemas de configuración extraídos del código. Se guarda en `backend/cortex-project-context.json` (excluido de Git). **Actualizar contexto** vuelve a recorrer el proyecto; cada consulta selecciona la documentación y las rutas más relacionadas. No almacena el código fuente, `.env`, bases de datos, registros ni carpetas de dependencias. Trata los documentos y nombres del código como contenido, no como instrucciones. El asistente recibe además la configuración visual actual de los overlays disponibles.

El asistente puede proponer cambios para Rulo, overlay unificado, luces, clima, ruleta y bienvenida/banner. Presenta los valores actuales y propuestos; los cambios solo se guardan después de pulsar **Aplicar cambios revisados**. Cada aplicación se guarda en `backend/cortex-assistant-history.json`; el panel **Cambios aplicados** permite deshacerla si los valores siguen intactos. Las actualizaciones notifican a los dashboards y overlays en vivo. Las APIs añadidas para luces, clima, ruleta y bienvenida/banner aceptan solo solicitudes locales originadas en Cortex y rechazan rutas desconocidas, tipos incompatibles y campos protegidos. No comparte claves, credenciales OBS, conexión de SocialStream Ninja, participantes, ganadores ni valores meteorológicos calculados.

Inicio muestra el estado actual de Chat Bot Spotify, los servicios PM2 y la conexión de OBS. Las tarjetas de plugins ofrecen **Iniciar** o **Reiniciar** según su estado. Después de recargar, el dashboard puede mostrar durante la consulta el último estado guardado para ese perfil, con hora visible; la copia local dura hasta 12 horas y los controles de servicios quedan deshabilitados hasta confirmar el estado actual. El resumen consulta en segundo plano sin duplicar llamadas cada 20 segundos. El indicador OBS confirma que el puerto WebSocket responde; el preflight valida además la autenticación y puede leer la escena activa. **Trazas de eventos** abre una vista local del recorrido técnico más reciente de comentarios Facebook por captura, Cortex/Rulo y Spotify. El `traceId` se ve en el feed de Chat Bot Spotify; las trazas son temporales y no guardan texto ni identidad de audiencia.

En **Preparar directo**, elige uno de los perfiles **Radio habitual**, **Sorteo** o **Pruebas**. Puedes ajustar módulos y opciones y guardar la selección en el navegador. Radio y Sorteo requieren **Activar Pruebas** apagado; Pruebas lo requiere encendido y Cortex confirma el aislamiento efectivo en Spotify, Chat Bot Spotify y Comentarios / Ruleta. Cambiar de perfil no activa ese interruptor automáticamente. Cortex inicia los módulos elegidos y comprueba Chat Bot Spotify, OAuth de Spotify, el enlace con Cortex, captura de Facebook y pedidos de música. También valida que haya llegado un comentario nuevo de Facebook capturado por Chat Bot Spotify desde el inicio del chequeo; otros mensajes no cuentan. Para Rulo, verifica que la mascota esté activa y que haya un overlay conectado; confirma manualmente que se vea en OBS. Para OBS, elige una escena esperada y, opcionalmente, escribe fuentes requeridas separadas por coma; el panel compara la escena activa y verifica que esas fuentes estén habilitadas. También pide confirmar visualmente los medidores de micrófono y audio. La transmisión, la visibilidad de Rulo y el audio requieren revisión humana; WebSocket no puede comprobarlos por sí solo. El panel muestra **LISTO PARA EMITIR** solo cuando todos los chequeos del perfil están listos; si algo falla, destaca el primer pendiente y permite ir a su control o reintento. El estado de transmisión OBS aparece separado y se actualiza cada 8 segundos con **EN VIVO**, **NO EN VIVO** o **RECONECTANDO**, tiempo, FPS y cuadros perdidos. Cada módulo tiene controles individuales para encender, apagar o reiniciar. El historial guarda los últimos 50 preflight en `backend/cortex-preflight-history.json`. **Terminar directo** permite marcar qué módulos apagar y cierra el túnel de estado de Cortex si está activo. Si marcas ngrok, Cortex publica páginas de solo lectura en `127.0.0.1:4001`: `/` muestra estados de servicios y `/history` muestra los últimos 100 comentarios sin controles. El panel completo y las APIs de control permanecen en el puerto local 4000. El acceso directo `Iniciar tunel ngrok.bat` inicia este túnel y copia una URL terminada en `/history`. El chequeo de ngrok anterior que apuntaba al 4000 se cierra cuando se inicia el nuevo túnel. TriggerStudio está registrado como servicio administrable en el puerto 2188.

Los servidores de los overlays deben estar iniciados para leer o aplicar sus ajustes. Si uno está apagado, el asistente todavía puede responder sobre el proyecto, pero no podrá preparar cambios para ese overlay hasta que esté disponible. Los campos que implican credenciales, conexión OBS o datos privados quedan fuera de las propuestas.

## Captura Facebook, pruebas y recuperación

Chat Bot Spotify reporta cada cinco segundos una ficha por pestaña de Facebook: cuenta etiquetada desde el popup, URL/transmisión, estado del DOM, comentarios visibles, detectados y enviados, conexión con Cortex y último error. Para dos cuentas simultáneas usa perfiles distintos de Brave/Chrome y etiquetas diferentes. Los comentarios conservan el contrato compatible con SSN y añaden metadatos de captura; Cortex deduplica entradas repetidas en el archivo permanente. Los participantes de la Ruleta se importan manualmente desde SQLite.

**Activar Pruebas** mantiene los eventos de prueba fuera del historial normal, SQLite, avatares persistentes y participantes de la ruleta. Cortex y Comentarios/Ruleta solo reciben pruebas después de anunciar compatibilidad con aislamiento; si un servicio no está actualizado, el módulo muestra el reinicio requerido y bloquea ese reenvío. Las pruebas temporales viven en memoria y desaparecen al reiniciar.

El archivo permanente de audiencia se puede exportar desde `/api/rulo-audience-comments.csv?dias=30`. Cortex guarda copias consistentes al iniciar y cada 24 horas, conserva las siete últimas y permite crear una manual desde `rulo-chat-historial.html`. Cada copia incluye SQLite, el historial visual de hasta 200 mensajes y los avatares. Consulta `backend/RESPALDOS-RULO.md` para recuperar una copia con Cortex detenido. Los tokens locales quedan fuera de los respaldos.

Las APIs locales de control aplican validación de origen y las páginas del proyecto solo reciben CORS desde la red local o SocialStream Ninja, necesario para mantener la integración heredada. Los tokens se envían en encabezados y se guardan en archivos ignorados por Git.

## Desarrollo y comprobación

La integración está en `backend/cortex-home.js`; la UI, en `frontend/home.html`, `home.css` y `home.js`. `ADAPTERS` enumera las APIs compatibles y `BUILTINS` los accesos fijos. Los servicios de `services.json` se incorporan automáticamente. Los endpoints de ajustes de overlays usan las reglas de `cortex-overlay-config.js`.

Ejecuta `node --test Rulo/tests/cortex-home-test.js` desde la raíz. Las pruebas usan directorios temporales y APIs simuladas: cubren cambios, persistencia, importación/exportación, restauración ante fallos, validación, IA y la interfaz. No modifican la configuración del directo. El test anterior del panel técnico apunta ahora a `/index.html`.
