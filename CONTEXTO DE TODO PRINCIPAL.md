# Handoff general del proyecto para Hermes Agent

**Proyecto:** plugins para mi OBS  
**Ruta:** D:\plugins para mi OBS  
**Ultima actualizacion:** 2026-09-18  
**Objetivo:** transferir a Hermes Agent el contexto tecnico, los limites de propiedad y el mapa operativo del proyecto completo.

## Lectura obligatoria

1. Leer este documento completo antes de editar.
2. Leer [Rulo/HERMES-MIGRATION-HANDOFF.md](D:/plugins%20para%20mi%20OBS/Rulo/HERMES-MIGRATION-HANDOFF.md), que contiene el detalle fino de Rulo, su dashboard, overlays e historial.
3. Revisar antes de tocar SocialStream Ninja:
   - [GUIA_SOCIALSTREAM_NINJA.md](D:/plugins%20para%20mi%20OBS/GUIA_SOCIALSTREAM_NINJA.md)
   - [SPOTIFY-SETUP-GUIDE.md](D:/plugins%20para%20mi%20OBS/SPOTIFY-SETUP-GUIDE.md)
   - [README-Spotify-install.md](D:/plugins%20para%20mi%20OBS/README-Spotify-install.md)
   - [guia para crear auto selecion de musica.md](D:/plugins%20para%20mi%20OBS/guia%20para%20crear%20auto%20selecion%20de%20musica.md)
4. Si se modifica el tercero SocialStream Ninja, leer SocialStream Ninja/docs/skills/control-social-stream/SKILL.md y la documentacion de SocialStream Ninja/docs/agents.

## Regla principal de propiedad

SocialStream Ninja es un plugin de terceros. Sus archivos originales no son el lugar para guardar la logica propia. Las personalizaciones deben vivir en:

- SocialStream Ninja/local-overrides/
- Control Cortex/integrations/spotify-auto-music/
- Rulo/
- Control Cortex/backend/ y Control Cortex/frontend/

El backend de Control Cortex vuelve a sincronizar los overrides e inyecta el loader cuando corresponde. No reemplazar todo SocialStream Ninja ni hacer cambios manuales que se pierdan con una actualizacion.

## Mapa del workspace

| Carpeta | Responsabilidad | Propiedad |
|---|---|---|
| Control Cortex | Backend Express, dashboard central, APIs, WebSocket y overlays propios | Propia |
| Control Cortex/integrations/spotify-auto-music | Logica de pedidos, busqueda y reproduccion Spotify | Propia |
| Rulo | Mascota futura, respuestas del bot, dashboard, historial y relay de chat | Propia |
| SocialStream Ninja | Captura de chats, docks, featured y transporte P2P | Tercero; conservar intacto |
| Bienvendos y Banner | Banner/overlay de bienvenida | Propia |
| comentarios | Modulo de comentarios/ruleta | Propia |
| luces | Control y overlay de luces | Propia |
| Modulo de loteria | Loteria con servidor WebSocket | Propia |
| Modulo de sorteo scraping | Sorteos y scraping con dashboard | Propia |
| modulo de tiempo y clima | Tiempo, clima y overlay | Propia |
| Trigger Studio | Aplicacion separada cliente/servidor para triggers | Propia; revisar antes de integrar |

El nombre Bienvendos y Banner esta escrito asi en disco. No renombrarlo sin revisar scripts, accesos directos y rutas.

## Arquitectura actual

    Brave + extension SocialStream Ninja
                     |
                     v
    SocialStream Ninja dock / chat events
                     |
                     +--> local-overrides/spotify-auto-music.js
                     |          |
                     |          +--> Spotify Web API / dispositivo configurado
                     |          +--> Control Cortex /api/spotify-*
                     |          +--> Control Cortex WebSocket
                     |          +--> Rulo /api/rulo-bot-message
                     |
                     +--> local-overrides/rulo-chat-relay.js
                                |
                                +--> Control Cortex /api/rulo-chat-message

    Control Cortex :4000
                     |
                     +--> dashboard central
                     +--> spotify-lyrics-overlay.html
                     +--> rulo-bot-overlay.html
                     +--> rulo-dashboard.html
                     +--> rulo-chat-historial.html

## Control Cortex

Archivos de entrada principales:

- Control Cortex/backend/server.js: servidor Express, WebSocket, rutas, lanzamiento de servicios, sincronizacion SSN y estado persistido.
- Control Cortex/backend/services.json: registro de servicios locales.
- Control Cortex/frontend/app.js: dashboard central.
- Control Cortex/frontend/style.css: estilos del dashboard.
- Control Cortex/frontend/spotify-lyrics-overlay.html: overlay de Spotify y letras.
- Control Cortex/integrations/spotify-auto-music/spotify-auto-music.js: modulo de pedidos Spotify.

Puerto principal: 4000.

APIs propias relevantes:

- GET/POST /api/spotify-device-target
- GET/POST /api/spotify-playback-offset
- GET/POST /api/spotify-overlay
- GET/POST /api/rulo-config
- GET/POST /api/rulo-bot-message
- POST /api/rulo-chat-message
- GET /api/rulo-chat-messages
- POST /api/rulo-repeat-response

Eventos WebSocket relevantes:

- spotify_overlay
- rulo_bot_message
- rulo_chat_item
- rulo_config_updated

Estado persistido importante:

- Control Cortex/backend/spotify-device-target.json: objetivo configurado NOTEBOOK-MATI.
- Control Cortex/backend/spotify-playback-offset.json: salto configurable; actualmente se usa 10 segundos cuando esta habilitado.
- El archivo de configuracion de Rulo debe confirmarse en el backend antes de editarlo.

## Registro de servicios y puertos

Fuente de verdad: Control Cortex/backend/services.json. Los estados guardados pueden estar desactualizados; verificar el proceso real y el endpoint.

| Servicio | Puerto | Dashboard o endpoint |
|---|---:|---|
| Luces | 3758 | http://localhost:3758/dashboard.html |
| Tiempo y clima | 3757 | http://localhost:3757/dashboard.html |
| Bienvendos y Banner | 9344 | http://localhost:9344/admin |
| Loteria | 688 | WebSocket/servidor propio |
| Sorteo scraping | 8872 | http://localhost:8872/dashboard.html |
| Comentarios | 9742 | http://localhost:9742/dashboard.html |
| Control Cortex | 4000 | http://localhost:4000/ |

Antes de agregar un servicio al registro, comprobar su package.json, script de arranque, puerto y ruta de dashboard. No asumir que todos usan Express o que todos tienen dashboard.

## Spotify: comportamiento implementado

El parser acepta pedidos naturales, entre ellos:

- poneme Yo Tomo Licor de Amar Azul
- quiero el tema de Estrelar - Marcos Valle
- tema Los Dias Que No Estas - Barbi Recanati
- quiero escuchar Ke Personajes
- pone un tema del Polaco y pone un tema de El Polaco
- pone un tema Los del Fuego y pone un tema de Los del Fuego
- pone algo de cumbia, pone un tema de rock y pone algun tema romantico

Reglas actuales:

- espera global aproximada de 40 segundos entre pedidos;
- cooldown por usuario aproximado de 120 segundos;
- seleccion de dispositivo desde el backend;
- busqueda por pista/artista, artista, album y genero;
- reproduccion automatica de otra cancion si termina una pista y la cola queda vacia;
- evita repeticiones recientes cuando puede;
- offset configurable para comenzar adelantado y finalizar antes;
- si el comando de offset llega tarde y la pista ya avanzo mas alla del margen, se ignora;
- el offset debe afectar pedidos, cambios manuales y continuaciones cuando esta habilitado;
- respuesta de exito: Listo <Nombre>, ya se esta reproduciendo: ...;
- respuesta de cooldown: <Nombre>, ya pediste un tema hace poco. Espera ...;
- el nombre operativo del bot continua siendo Anormalia en ciertos mensajes heredados.

La aplicacion Spotify de Microsoft Store fue poco confiable en pruebas; Spotify Web funciono mejor. No asumir que cambiar el navegador arregla un problema de la app nativa.

## URLs de trabajo

Sesion SSN estable habitual: XJ9hQ2JDHH. Si se crea una sesion nueva, actualizar los links de OBS y no mezclar sesiones.

- Control Cortex: [http://localhost:4000/](http://localhost:4000/)
- Lyrics overlay: http://192.168.4.100:4000/spotify-lyrics-overlay.html?session=XJ9hQ2JDHH&ln=es&showqueue&lyrics&cortexrelay&style=comic&accent=%239fd50b
- Rulo overlay: http://192.168.4.100:4000/rulo-bot-overlay.html?session=XJ9hQ2JDHH
- Rulo dashboard: http://192.168.4.100:4000/rulo-dashboard.html?session=XJ9hQ2JDHH
- Rulo historial: http://192.168.4.100:4000/rulo-chat-historial.html?session=XJ9hQ2JDHH
- Dock SSN: https://socialstream.ninja/dock.html?session=XJ9hQ2JDHH&ln=es&v=3.50.13
- Featured SSN: https://socialstream.ninja/featured.html?session=XJ9hQ2JDHH&ln=es&v=3.50.13

192.168.4.100 esta hardcodeado en varios archivos. Si cambia la IP LAN, buscar y actualizar todas las referencias, incluyendo URLs de OBS Browser Source.

## Rulo

Rulo es el modulo propio para evolucionar hacia una mascota animada. Sus detalles estan en [Rulo/HERMES-MIGRATION-HANDOFF.md](D:/plugins%20para%20mi%20OBS/Rulo/HERMES-MIGRATION-HANDOFF.md).

Archivos principales:

- Rulo/rulo-bot-overlay.html: muestra solamente respuestas del bot para OBS.
- Rulo/rulo-dashboard.html: modifica nombre, color, avatar, duracion, opacidad, ancho, fuente y animacion; tambien genera links copiables.
- Rulo/rulo-chat-historial.html: comentarios de personas a la izquierda y respuestas del bot a la derecha; conserva foto de perfil cuando llega en el evento.
- Rulo/rulo-chat-relay.js: relay de comentarios desde SSN hacia Control Cortex.
- Rulo/rulo-config.json: configuracion del modulo.

Compatibilidad: rulo-chat-dock.html debe seguir redirigiendo al historial actual si existe codigo externo que usa el nombre anterior.

Problema conocido: el dashboard puede guardar botName: Rulo, pero algunos eventos de Spotify llevan botName: Anormalia y el overlay prioriza el nombre recibido. Al cambiar el nombre, revisar la precedencia entre configuracion persistida y datos del evento.

Otro limite conocido: el historial de chat vive en memoria y se limita a los ultimos 50 elementos; se pierde al reiniciar el backend salvo que se implemente persistencia.

## Limite de SocialStream Ninja

No editar el core para agregar funciones propias. El flujo esperado es:

1. Editar la fuente propia en Control Cortex/integrations/spotify-auto-music o Rulo.
2. Reiniciar Control Cortex o ejecutar su sincronizacion.
3. Confirmar que los archivos aparecen en SocialStream Ninja/local-overrides.
4. Confirmar que loader.js contiene una sola referencia por override y que la version de cache cambia.
5. Recargar la extension o la pestaña de SSN y probar un evento real.

Overrides actuales esperados:

- stable-ssn-session-id.js
- spotify-auto-music.js
- spotify-cortex-overlay-relay.js
- rulo-chat-relay.js

El navegador puede mostrar errores externos de auth-styles.css, Cloudflare, WebRTC o favicon.ico. Separar esos errores del funcionamiento propio: revisar primero si llegan eventos de chat, si Spotify responde y si el WebSocket de Control Cortex esta conectado.

## Como ejecutar y verificar

Desde PowerShell:

    Set-Location 'D:\plugins para mi OBS\Control Cortex\backend'
    node server.js

Comprobaciones minimas:

    Invoke-WebRequest http://localhost:4000/ -UseBasicParsing
    Invoke-WebRequest http://localhost:4000/api/rulo-config -UseBasicParsing
    Invoke-WebRequest http://localhost:4000/api/spotify-device-target -UseBasicParsing
    Invoke-WebRequest http://localhost:4000/api/spotify-playback-offset -UseBasicParsing

Para una prueba completa:

1. Abrir Control Cortex y comprobar que los servicios visibles corresponden al registro.
2. Abrir Spotify Web en el equipo que realmente reproduce.
3. Confirmar el dispositivo configurado.
4. Enviar un pedido corto desde SSN.
5. Verificar respuesta del bot, cambio de pista, offset, lyrics overlay y Rulo overlay.
6. Probar un comentario normal en rulo-chat-historial.html.
7. Probar click sobre comentario y respuesta, observando featured o repeticion respectivamente.

No poner contrasenas, tokens ni cookies en este documento. El backend historicamente contiene configuracion sensible de OBS; la proxima mejora debe moverla a variables de entorno o un archivo local ignorado por Git.

## Estado del repositorio

El worktree esta deliberadamente sucio: contiene cambios del usuario, cambios de integracion y archivos propios. Antes de editar:

    git status --short
    git diff --stat

No ejecutar git reset --hard, git checkout --, borrados masivos ni comandos que descarten cambios. No asumir que un archivo modificado fue creado por el agente actual. Si se necesita versionar la migracion, crear una rama o commit solo despues de revisar el diff completo.

## Sub-agents recomendados para Hermes

Usar un agente por area, con limites de archivos claros. No permitir que dos agentes editen simultaneamente Control Cortex/backend/server.js o SocialStream Ninja/loader.js.

1. workspace-cartographer: inventario read-only, puertos, package.json, rutas y documentacion; no edita.
2. cortex-backend: APIs, WebSocket, registro de servicios, persistencia y arranque de Control Cortex.
3. ssn-integrator: solo overrides, loader, extension y compatibilidad con actualizaciones del tercero.
4. spotify-flow: parser, busqueda, dispositivo, cooldown, offset, cola y mensajes.
5. rulo-ui: dashboard, overlay, historial, animaciones y configuracion visual.
6. obs-e2e: pruebas manuales en Brave, Spotify Web, OBS Browser Source y featured/dock.
7. module-maintainer: mantenimiento de un modulo independiente por vez, con su propio package.json y docs.
8. security-auditor: secretos, CORS, WebSocket, LAN exposure, validacion de inputs y dependencias.
9. release-coordinator: checklist final, backup, diff, smoke tests y documentacion de cambios.

Formato recomendado de cada handoff entre agentes: archivos tocados, comportamiento cambiado, pruebas ejecutadas, problemas restantes y siguiente accion exacta.

## Skills y plugins recomendados

- computer-use: necesario para probar Brave, OBS, Spotify Web, extension SSN y docks.
- Skill local SocialStream Ninja/docs/skills/control-social-stream/SKILL.md: usarla al tocar integraciones de SSN.
- plugin-creator y skill-creator: solo si Hermes necesitara empaquetar esta metodologia.
- plugin-management: para inspeccionar plugins externos y dependencias.
- imagegen: mas adelante para avatar, expresiones y assets bitmap de Rulo.
- visualize: opcional para prototipos de estados, animaciones o flujo de eventos.
- openai-docs: solo si se usan productos o APIs de OpenAI en una futura mascota inteligente.

Plugins externos opcionales, no obligatorios:

- Spotify: podria ayudar a inspeccionar la cuenta, pero el flujo actual ya usa su integracion local.
- GitHub: recomendable solo si se decide versionar el proyecto en un repositorio privado.
- Figma: util para diseñar la mascota antes de implementarla.
- Codex Security: recomendable antes de exponer el servidor a una red mas amplia.

No instalar plugins por defecto: primero confirmar que aportan una capacidad que el codigo local no cubre.

## Plan de migracion para Hermes

1. Leer este handoff y el handoff especifico de Rulo.
2. Hacer inventario y capturar git status --short sin borrar nada.
3. Levantar Control Cortex y verificar sus APIs basicas.
4. Verificar que los overrides de SSN se regeneran desde sus fuentes propias.
5. Probar Spotify Web, pedidos naturales, cooldown, offset y continuacion.
6. Probar los tres elementos de Rulo: overlay, dashboard e historial.
7. Probar cada servicio independiente usando su documentacion local.
8. Separar secretos y valores de entorno antes de exponer el servidor fuera de la LAN.
9. Ejecutar una prueba de actualizacion de SocialStream Ninja sobre una copia o rama, comprobando que los overrides sobreviven.
10. Crear un snapshot/versionado solo despues de revisar los cambios del usuario y los del agente.

## Pendientes conocidos

- Probar de extremo a extremo el click de comentario hacia featured.html.
- Resolver la precedencia Rulo versus Anormalia en el nombre visible del bot.
- Persistir el historial de Rulo si se necesita conservarlo tras reinicios.
- Reemplazar la IP LAN hardcodeada por una configuracion unica.
- Mover credenciales de OBS y otros secretos fuera del codigo.
- Añadir pruebas automatizadas para parser de pedidos y offset tardio.
- Revisar Trigger Studio antes de incorporarlo al registro central.
- Mantener actualizados los docs cuando cambien puertos, sesiones SSN o rutas.

## No hacer

- No editar ni reemplazar el core de SocialStream Ninja para resolver una necesidad propia.
- No confiar en una sesion SSN nueva sin actualizar todos los Browser Sources de OBS.
- No aplicar un offset tarde cuando la pista ya paso el margen configurado.
- No guardar secretos en Markdown, frontend, URLs publicas o commits.
- No borrar cambios existentes del usuario para dejar el workspace limpio.
- No declarar una prueba exitosa solo porque una pagina carga: verificar el evento real y el resultado visible.

