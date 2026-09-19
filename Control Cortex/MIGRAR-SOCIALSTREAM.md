# Actualizar SocialStream Ninja sin romper nada

SSN es la extensión de terceros que hace de puente con el chat (YouTube, TikTok, Facebook…) y donde
viven los módulos de Control Cortex (Spotify, Rulo, Session ID). Su carpeta `SocialStream Ninja\` es un
**repositorio git propio** (fork en `mati4315/Control-Cortex---SocialStream-Ninja`) que el proyecto
principal referencia; se usa como extensión **desempaquetada** en Brave.

## Qué se pierde cuando SSN se actualiza y qué no

| Cosa | ¿Se pierde? | Cómo vuelve |
| --- | --- | --- |
| `local-overrides\` (módulos de Cortex) | Sí, si se reemplaza la carpeta | El backend los copia en cada arranque |
| Las líneas en `loader.js` que cargan esos módulos | Sí (SSN trae su propio loader) | El backend las vuelve a inyectar |
| La `key` del `manifest.json` (ID de extensión) | Sí, si se reemplaza el manifest | El backend la inyecta (ID protegido = no se pierden ajustes de SSN ni Session ID de OBS) |
| `cortex-base-url.js` (IP LAN + Session ID de Cortex) | Sí | El backend lo regenera |
| **Ajustes, vocabulario, correcciones y registro de Spotify** | **No** | Viven en `Rulo\Spotify\*.json`, fuera de SSN |
| Historial y config de Rulo | No | `Rulo\*.json` |
| Secretos de OBS | No | `Control Cortex\backend\.env` |
| Ajustes de SocialStream Ninja (destinos, tipos de letra, etc.) | No | Los guarda Chrome por ID de extensión: por eso se protege la `key` |

En resumen: **lo que vive dentro de SSN se re-genera solo** (al arrancar el backend), y **lo importante
vive fuera** (en `Rulo\` y `Control Cortex\`). Lo único que no se puede automatizar es que Brave recargue
la extensión.

## Migrar (forma fácil)

Cuatro accesos directos en `Control Cortex\`, sin menús ni comandos que recordar:

| Archivo | Qué hace |
| --- | --- |
| `SSN 1 - Estado.bat` | Dice si falta algo (no toca nada) |
| `SSN 2 - Respaldo.bat` | Guarda `loader.js`, `manifest.json` y `local-overrides\` en `Control Cortex\backups\ssn-<fecha>\` |
| `SSN 3 - Actualizar con git.bat` | `git pull` dentro de la carpeta de SSN: descarta nuestras líneas del `loader.js` (se vuelven a poner solas) y re-aplica todo |
| `SSN 4 - Aplicar version nueva (arrastrar aqui).bat` | Arrastrá sobre él la carpeta descomprimida de la versión nueva: copia los archivos, conserva `local-overrides\` y re-aplica el parcheo |

Todos hacen respaldo antes de tocar nada y verifican al final.

## Migrar (a mano, si querés ver cada paso)

```bash
cd "D:/plugins para mi OBS/Control Cortex"

node tools/migrar-ssn.js estado                        # ¿falta algo? (no modifica nada)
node tools/migrar-ssn.js backup                        # respaldo de lo personalizado
node tools/migrar-ssn.js git                           # traer la versión nueva con git
node tools/migrar-ssn.js desde "D:/Descargas/SSN-Nueva"  # o desde una carpeta/ZIP descomprimido
```

## Después de migrar (siempre los mismos 4 pasos)

1. **Reiniciar el backend**: `Iniciar Control Cortex.bat` (o cerrarlo y abrirlo). En el log vas a ver el
   resumen del parcheo: `[SSN Auto-Patcher] OK manifest / OK overrides / OK base-url / OK loader`.
2. **Recargar la extensión**: `brave://extensions` → **Actualizar** en SocialStream Ninja.
3. **Recargar las Browser Sources de OBS** (overlay, historial, letras).
4. **Verificar**: en el dashboard de entrenamiento, sección *Estado de la instalación* (o
   `http://127.0.0.1:4000/api/cortex-install-status`). Tiene que decir **listo** y mostrar la versión del
   módulo que reporta la extensión.

## Cómo saber si algo quedó a medias

El parcheo ya no puede fallar en silencio: si una versión nueva de SSN mueve o renombra los archivos que
usábamos de anclaje (`./spotify.js`, `./background.js`), las líneas se insertan igual en otro lugar válido
y el log avisa con `AVISO`. Si directamente no encuentra la lista de scripts, **falla fuerte** y lo dice en
vez de reportar éxito (eso pasaba antes: el bot dejaba de andar y el log decía "inyectado").

Señales típicas y qué significan:

| Síntoma | Qué pasa | Solución |
| --- | --- | --- |
| El chip del dashboard dice `sin conexión` | La extensión no cargó los override | Actualizar la extensión en `brave://extensions` |
| El chip muestra una versión vieja (ej. v19 y ya vamos por v26) | Quedó una pestaña de SSN con el código viejo | Recargar la extensión **y** esa pestaña |
| `/api/cortex-install-status` con `ok: false` | Falta re-aplicar el parcheo | `node tools/migrar-ssn.js estado` y después reiniciar el backend |
| El bot no responde en el chat | SSN cambió la forma de cargar scripts | Mirar `backups\` y el log del backend; avisar para ajustar los anclajes |

## Qué es cada anclaje (para cuando haya que ajustar)

`Control Cortex\backend\ssn-patcher.js` es el único lugar donde se define qué se inyecta:

| Entrada | Se carga | Detrás de |
| --- | --- | --- |
| `base-url` | `cortex-base-url.js` | `./spotify.js` |
| `spotify-auto-music` | módulo de pedidos de música | `./spotify.js` |
| `spotify-relay` | relay del overlay de Spotify | `./spotify.js` |
| `rulo-chat-relay` | relay de comentarios al historial | `./spotify.js` |
| `stable-session` | Session ID estable | **antes** de `./background.js` |

El orden importa: `cortex-base-url.js` primero (los demás leen `window.CORTEX_BASE_URL`) y el Session ID
antes de `background.js` (lo consume al arrancar).

Las pruebas de todo esto están en `Rulo\tests\ssn-patcher-test.js` (36 casos, incluida una migración
completa en una carpeta temporal): `cd "Rulo/tests" && npm run test:patcher`.
