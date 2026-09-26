# Cortex Inicio

Abre **http://localhost:4000/** o el acceso `ABRIR CORTEX.url` de la carpeta principal. Si el servidor está apagado, usa `Iniciar Control Cortex.bat`. Desde otra computadora, usa la IP del equipo Cortex y el puerto 4000.

## Organización

Inicio reúne los dashboards de Rulo y los servicios registrados en Cortex. Busca por función, filtra por categoría y marca estrellas para encontrar tus favoritos primero. «Añadir acceso» incorpora otros dashboards mediante su URL. Cada perfil conserva sus favoritos y enlaces. Para añadir un proceso que Cortex pueda arrancar o detener, usa **Control de servicios**, disponible en `/index.html`.

Los enlaces a localhost de los servicios se adaptan al equipo que sirve Cortex. Los dashboards de Rulo reciben el Session ID existente. No se mueven las carpetas ni se cambian las URLs de OBS.

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

Inicio muestra el estado de servicios PM2, cliente Spotify y alcance de red de OBS WebSocket. Las tarjetas de plugins ofrecen **Iniciar** o **Reiniciar** según su estado. El indicador OBS confirma que el puerto WebSocket responde; la autenticación de OBS no se prueba desde esta vista.

Los servidores de los overlays deben estar iniciados para leer o aplicar sus ajustes. Si uno está apagado, el asistente todavía puede responder sobre el proyecto, pero no podrá preparar cambios para ese overlay hasta que esté disponible. Los campos que implican credenciales, conexión OBS o datos privados quedan fuera de las propuestas.

## Desarrollo y comprobación

La integración está en `backend/cortex-home.js`; la UI, en `frontend/home.html`, `home.css` y `home.js`. `ADAPTERS` enumera las APIs compatibles y `BUILTINS` los accesos fijos. Los servicios de `services.json` se incorporan automáticamente. Los endpoints de ajustes de overlays usan las reglas de `cortex-overlay-config.js`.

Ejecuta `node --test Rulo/tests/cortex-home-test.js` desde la raíz. Las pruebas usan directorios temporales y APIs simuladas: cubren cambios, persistencia, importación/exportación, restauración ante fallos, validación, IA y la interfaz. No modifican la configuración del directo. El test anterior del panel técnico apunta ahora a `/index.html`.
