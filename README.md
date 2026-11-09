# Plugins para mi OBS

Guía rápida del workspace de Windows. El proyecto está repartido en servicios Node.js y módulos independientes; no hay una única aplicación ni un único proceso. Las reglas que deben respetarse al cambiar código están en [`AGENTS.md`](AGENTS.md), y el handoff detallado está en [`CONTEXTO DE TODO PRINCIPAL.md`](CONTEXTO%20DE%20TODO%20PRINCIPAL.md).

## Antes de cambiar código

1. Lee [`AGENTS.md`](AGENTS.md) y esta guía.
2. Lee el README del módulo afectado y, si corresponde, la entrada en [`CAMBIOS-PROYECTO.md`](CAMBIOS-PROYECTO.md).
3. Comprueba quién es dueño del comportamiento. SocialStream Ninja es de terceros: la lógica propia debe ir en `local-overrides`, `Control Cortex`, `Rulo`, `Chat Bot Spotify` o el módulo propio correspondiente.
4. No supongas que un servicio está iniciado porque aparezca en `services.json`; comprueba los procesos y el endpoint antes de operar.
5. Mantén secretos, OAuth, tokens, cookies y bases de datos locales fuera de Git, del navegador y de los prompts de IA.

## Mapa de módulos

| Carpeta | Responsabilidad | Puerto configurado | Documentación |
| --- | --- | ---: | --- |
| `Control Cortex` | Backend Express, APIs, WebSocket, dashboard central y proxy local | 4000 | `Control Cortex/CORTEX-INICIO.md` |
| `Chat Bot Spotify` | Extensión propia para capturar Facebook, OAuth PKCE y procesamiento de pedidos Spotify | 9765 | [`Chat Bot Spotify/README.md`](Chat%20Bot%20Spotify/README.md), [`Chat Bot Spotify/AGENTS.md`](Chat%20Bot%20Spotify/AGENTS.md) |
| `comentarios` | Historial visual, dashboard y Ruleta de Participantes para OBS | 9742 | `comentarios/public/dashboard.html`, reglas en este README y `AGENTS.md` |
| `Rulo` | Interfaz conversacional, overlays, historial y entrenamiento | servido por Cortex | [`Rulo/README.md`](Rulo/README.md), [`Rulo/README-SIMULACION-VIVOS.md`](Rulo/README-SIMULACION-VIVOS.md) |
| `Rulo - Cuaderno Vivo` | Perfil, control de tono y memoria revisable por participante, integrada solo a la simulación aislada | servido por Cortex | [`Rulo - Cuaderno Vivo/README.md`](Rulo%20-%20Cuaderno%20Vivo/README.md), [`ARQUITECTURA-Y-MIGRACION.md`](Rulo%20-%20Cuaderno%20Vivo/ARQUITECTURA-Y-MIGRACION.md) |
| `Control Cortex/integrations/spotify-auto-music` | Integración heredada con SocialStream Ninja | — | Su [`README.md`](Control%20Cortex/integrations/spotify-auto-music/README.md) documenta el flujo de Spotify Desktop que también conserva el módulo propio. |
| `Trigger Studio` | Triggers y acciones de OBS | 2188; OBS WebSocket 4455 | `Trigger Studio/README.md`, `Trigger Studio/AGENTS.md` |
| `Modulo de loteria` | Overlay OBS, relanzamiento inverso, cola persistente administrable y lista de compras con búsqueda | 688 | Revisar su `package.json` y scripts antes de operarlo. |
| `Modulo de sorteo scraping` | Dashboard y seguimiento de sorteos | 8872 | Revisar su README o `package.json` local. |
| `Bienvendos y Banner` | Overlay y administración de bienvenida | 9344 | Revisar su `package.json` local. |
| `luces`, `modulo de tiempo y clima` | Overlays y controles independientes | 3758, 3757 | Revisar sus dashboards y `package.json`. |

Los puertos son configuración, no garantía de que cada proceso esté corriendo. `Control Cortex/backend/services.json` es el registro del dashboard central; `pm2 ls` muestra el estado de los procesos administrados por PM2.

Cortex se puede instalar como app web desde Chrome. Para Android fuera de la red local, usa Tailscale Serve para dar HTTPS privado al panel y sigue la guía de [`Control Cortex/CORTEX-INICIO.md`](Control%20Cortex/CORTEX-INICIO.md); no publiques el puerto 4000 con Funnel ni en el router.

Desde el panel también se puede reiniciar Cortex: la acción reinicia el backend de Windows y vuelve a abrirlo minimizado. El reinicio corta brevemente las conexiones del panel y sus WebSockets.

## Flujo de comentarios, Rulo y SQLite

```text
Facebook visible en Brave/Chrome
  → Chat Bot Spotify :9765 (captura DOM propia)
  → Control Cortex :4000
      → Rulo y el historial visual
      → SQLite permanente de audiencia
  → Spotify Web API con el OAuth propio de Chat Bot Spotify
```

El operador importa participantes desde SQLite a Comentarios/Ruleta cuando lo necesita; el capturador no reenvía comentarios a la Ruleta.

Chat Bot Spotify no necesita SocialStream Ninja para leer Facebook. Los comentarios permanentes y los programas archivados se consultan desde `Rulo/Spotify/spotify-analytics.db`, especialmente `audience_comments` y `user`. El historial JSON reciente de Rulo es una vista de retención limitada; no reemplaza SQLite ni es la fuente para consultas históricas. `program_number` identifica el programa asignado. `facebook_user_id` identifica la cuenta cuando está disponible; `ID_facebook` se mantiene `NULL` hasta que exista un origen verificado para completarlo. No unas personas solo porque sus nombres coincidan. La captura propia se mantiene enfocada en Facebook; otros conectores no forman parte del alcance actual.

Las fotos de perfil se conservan como WebP locales en `Rulo/profile-avatars/` y SQLite guarda su ruta. El historial puede limpiarse sin borrar el archivo permanente. Los respaldos SQLite consistentes, su retención y recuperación están documentados en [`Control Cortex/backend/RESPALDOS-RULO.md`](Control%20Cortex/backend/RESPALDOS-RULO.md).

## Spotify

Chat Bot Spotify usa su propio OAuth PKCE, bearer token local y cola serializada. Para un pedido de una persona, primero consulta reproductor y cola, evita duplicados, agrega una vez, verifica que el pedido esté primero, avanza y confirma en el dispositivo que la URI esté reproduciéndose antes de anunciar éxito. Un HTTP 204 no demuestra que Spotify haya cambiado de pista. No cambies ese flujo por `PUT /me/player/play`.

El dashboard `/rulo-spotify.html` pasa por el proxy de Cortex, que obtiene localmente el bearer token. No envíes tokens al navegador o a la IA y no dirijas controles nuevos a la cola heredada de SocialStream Ninja. Con offset, confirma silencio, posición y restauración del volumen incluso si ocurre un error. Las reglas completas están en [`Chat Bot Spotify/AGENTS.md`](Chat%20Bot%20Spotify/AGENTS.md) y en el AGENTS general.

Chat Bot Spotify escucha solo en `127.0.0.1` por defecto; el acceso LAN requiere habilitar `CHAT_BOT_SPOTIFY_HOST` explícitamente y restringir el firewall. Cortex conserva como máximo 50 registros recientes y 90 días de interacciones en SQLite por defecto (`CORTEX_SPOTIFY_LOG_RETENTION_DAYS` ajusta el plazo entre 1 y 3650 días). El botón del dashboard elimina el registro reciente y las interacciones de la base activa, pero conserva `audience_comments` y `user`, que son el archivo permanente de audiencia, además de los respaldos SQLite ya creados.

## Ruleta y entrega de premios

La Ruleta importa personas únicas desde el historial SQLite de Rulo. La configuración de premios vive en `comentarios/config.json`; el dashboard de `:9742` permite crear, habilitar, pausar y eliminar definiciones.

**El giro no entrega premios automáticamente.** Después de un ganador real, el operador pulsa **Asignar premio** en el overlay, selecciona un premio habilitado y confirma la lotería Cdelu y la cantidad de tickets. El overlay muestra el progreso y el resultado. El servidor enlaza la asignación con el ganador y el giro confirmados, resuelve la identidad estable en un archivo privado de `comentarios/runtime-private/` y llama a Cortex desde el servidor. La asignación está bloqueada en vistas previas y en Modo de pruebas aislado. El registro idempotente en Firebase evita aplicar dos veces el mismo premio para el mismo giro.

En `dashboard.html`, el historial de premios también permite corregir una entrega confirmada: al elegir ganador, premio y lotería, consulta en Cdelu el cupo actual de tickets extra y cuántos números ya tiene asignados. El operador fija el nuevo total extra y lo guarda en Firestore; el cambio queda además auditado en la SQLite local `Rulo/Spotify/spotify-analytics.db` y resumido en el historial local. Reducir el cupo extra no borra ni libera números que la persona ya eligió. La consulta y el guardado pasan por Comentarios → Cortex → la función callable de Firebase; la página no recibe identificadores internos de Cdelu ni de Facebook.

No expongas `facebook_user_id` ni las asociaciones privadas al overlay, dashboard o IA. La consulta de lotería de la simulación de vivos es distinta: debe permanecer solo lectura y no puede reservar, escoger ni asignar números. Para la simulación y sus rutas aisladas, consulta [`Rulo/README-SIMULACION-VIVOS.md`](Rulo/README-SIMULACION-VIVOS.md).

## Paneles locales

| Panel | URL local |
| --- | --- |
| Control Cortex | `http://127.0.0.1:4000/` |
| Chat Bot Spotify | `http://127.0.0.1:9765/` |
| Ruleta de Participantes | `http://localhost:9742/dashboard.html` |
| Historial de Rulo | `http://localhost:4000/rulo-chat-historial.html` |
| Hablar con Rulo | `http://localhost:4000/rulo-hablar.html` |
| Cuaderno Vivo | `http://localhost:4000/rulo-cuaderno-vivo.html` |
| Trazas recientes | `http://localhost:4000/event-traces.html` |

Desde otra PC, usa la IP LAN del servidor y comprueba el firewall de Windows. No publiques estos servicios o puertos hacia Internet sin un diseño de autenticación y red específico.

## Comprobaciones locales

Desde la raíz, ejecuta `npm run test:regression` para validar trazas, evaluación aislada, seguridad de IAFAS, premios idempotentes, captura Facebook y reproducción Spotify sin conectar con OBS ni con cuentas reales. En Chat Bot Spotify también está disponible `npm test`.

## Documentos de referencia

- [`AGENTS.md`](AGENTS.md): invariantes técnicos y límites de seguridad para futuras IA.
- [`CONTEXTO DE TODO PRINCIPAL.md`](CONTEXTO%20DE%20TODO%20PRINCIPAL.md): mapa extenso, rutas de trabajo e historia del handoff.
- [`CAMBIOS-PROYECTO.md`](CAMBIOS-PROYECTO.md): registro breve de cambios y reinicios requeridos.
- [`Rulo/README.md`](Rulo/README.md): páginas, API, historial, identidades y avatares.
- [`Rulo/README-SIMULACION-VIVOS.md`](Rulo/README-SIMULACION-VIVOS.md): simulación de preguntas, aislamiento, Spotify y lotería de solo lectura.
- [`Rulo - Cuaderno Vivo/README.md`](Rulo%20-%20Cuaderno%20Vivo/README.md): perfil y migración gradual de personalidad y memoria de Rulo.
- [`Chat Bot Spotify/README.md`](Chat%20Bot%20Spotify/README.md): instalación del capturador y APIs del módulo propio.
- [`Chat Bot Spotify/AGENTS.md`](Chat%20Bot%20Spotify/AGENTS.md): reglas de trabajo específicas de Spotify y la captura Facebook.
