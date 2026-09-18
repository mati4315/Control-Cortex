# Rulo / Spotify

Ajustes y herramientas del cambio automático de música (pedidos por chat → Spotify Web API).

## Dashboard

Abrir en el navegador:

```
http://127.0.0.1:4000/rulo-spotify.html
```

También: `http://192.168.4.100:4000/rulo-spotify.html` (misma red, para el celular).
El backend sirve el archivo `spotify-dashboard.html` de esta carpeta.

Desde ahí se controla todo sin tocar código ni reiniciar el backend:

| Control | Qué hace |
| --- | --- |
| Pedidos de música por chat | Interruptor general del módulo |
| Modo prueba (sin esperas) | Ignora la espera global y la por usuario (para probar temas seguidos) |
| Solo comandos | Ignora el lenguaje natural, exige `!playnow` / `!tema` / `!musica` |
| Respuestas personalizadas | Antepone el nombre del que pidió |
| Avisos en el overlay | Manda o no los mensajes al overlay de Rulo |
| Continuidad automática | Encola un tema similar al terminar el pedido |
| Espera global / por usuario | Segundos (0 = sin espera) |
| Largo mínimo | Comentarios más cortos no se analizan |
| Quitar los primeros segundos | Salto inicial + corte del final |
| Dispositivo que debe reproducir | Nombre parcial del dispositivo Spotify |
| Cada cuánto consulta la extensión | 1-15 s: es la demora de la cola de comandos |
| Pruebas | Reproducir un tema ya, **buscar sin reproducir**, simular un comentario, **solo analizar** (sin reproducir) y pausa/siguiente/anterior |
| Registro | Últimos 50 pedidos (chat y pruebas) con resultado |

Los cambios se guardan solos (400 ms después de tocar el control) y la extensión los toma al instante
por WebSocket (o en `pollSeconds` segundos si usa el respaldo). No hace falta recargar nada.

## Qué entiende el bot (tolerancia a errores de escritura)

El parser acepta saludos y muletillas al principio, "temita/temazo/temón" como sinónimo de "tema",
verbos con "a" y pedidos sin la palabra "tema". Ejemplos que funcionan tal cual:

```text
Un tema de laberiso                      -> artista "laberiso" (prueba "la beriso" solo)
Un tema de gladis la bomba tucumana      -> artista
Un tema de la beriso                     -> artista
Hola matias un temita de los palmeras    -> artista "los palmeras"
Pasame a ke personajes                   -> artista
Poneme algun reguetón                    -> género reggaeton
```

Cómo lo logra:

1. **Limpieza**: saca saludos (`hola`, `buenas`, `que tal`…), muletillas (`che`, `por favor`, `dale`…)
   y menciones (`@usuario`).
2. **Sinónimos**: `tema`, `temita`, `temazo`, `temón`, `musica`, `musiquita`, `cancion`, `rola`, `track`.
   El pedido puede estar en cualquier parte del comentario, no solo al principio.
3. **Géneros con variantes**: `reguetón`, `regueton`, `regeton`, `reggaeton`… van todos a reggaeton.
4. **Búsqueda tolerante**: si la primera búsqueda no trae nada, prueba variantes — artículo pegado
   (`laberiso` → `la beriso`), sin artículo (`los palmeras` → `palmeras`) y confusiones típicas
   (i/y, b/v, s/z, ll/y, qu/k, c/s). Máximo 7 intentos por pedido.
5. **Correcciones aprendidas**: cuando una variante funciona, se guarda la equivalencia en
   `Rulo/Spotify/spotify-aliases.json` y la próxima vez busca directo. Se ven y se cargan a mano
   desde el panel **Correcciones aprendidas** del dashboard.

## Por qué las pruebas "encolaban" y cómo se resolvió

El token de Spotify vive **dentro de la extensión** SocialStream Ninja, no en el backend. Por eso el
dashboard no puede hablar con Spotify: deja el pedido en una **cola** en Cortex y la extensión lo
retira. Ahora hay dos caminos:

| Camino | Demora | Cuándo |
| --- | --- | --- |
| WebSocket (`/api/spotify-ws`) | **~10-30 ms** (medido) | Siempre que la extensión esté abierta |
| Consulta periódica (`pollSeconds`) | hasta `pollSeconds` s | Respaldo si el WebSocket no está |

El WebSocket existe porque Brave/Chrome **estrangular los timers de las páginas de fondo a una vez por
minuto**: con solo la consulta periódica, los comandos llegaban cada 60 s aunque el intervalo fuera de
1 s (se veía en el registro: 20:46:44, 20:47:44, 20:48:44). Con el enlace abierto el comando llega al
instante y el poll queda como red de seguridad (por ejemplo si la extensión se recarga).

`pollSeconds` sigue siendo útil si querés menos tráfico o si el WebSocket no puede abrirse. Los
comandos se entregan en lote: si tocás tres botones seguidos, se ejecutan los tres en la misma
entrega. El dashboard muestra el chip "Extensión SSN: conectada vNN · instantánea" cuando el enlace
está activo, y "· por consulta" cuando está usando el respaldo.

Importante: si el chip muestra una versión vieja (por ejemplo v19 cuando el archivo ya es v21),
quedó una pestaña de SocialStream Ninja abierta con el código anterior. Recargá la extensión en
`brave://extensions` → Actualizar y recargá también esa pestaña.

## Archivos de esta carpeta

| Archivo | Contenido |
| --- | --- |
| `spotify-settings.json` | Fuente única de verdad de los ajustes (lo escribe el backend) |
| `spotify-aliases.json` | Correcciones de escritura aprendidas (`laberiso` → `la beriso`) |
| `spotify-request-log.json` | Últimos 50 pedidos con resultado |
| `spotify-devices.json` | Último reporte de dispositivos Spotify de la extensión |
| `spotify-dashboard.html` | La interfaz |

El backend vive en `Control Cortex/backend/server.js` y expone:

```
GET  /api/spotify-status            estado completo para el dashboard
GET  /api/spotify-settings          ajustes actuales
POST /api/spotify-settings          guarda ajustes (parcial o completo)
POST /api/spotify-settings-reset    vuelve a los valores por defecto
GET  /api/spotify-client-state      poll de la extensión (ajustes + comando pendiente)
POST /api/spotify-test-request      encola "reproducir este tema"
POST /api/spotify-simulate-comment  encola un comentario de prueba
POST /api/spotify-transport         pause | resume | next | previous | devices
POST /api/spotify-request-log       la extensión reporta cada pedido
POST /api/spotify-devices-report    la extensión reporta los dispositivos
GET  /api/spotify-aliases           correcciones de escritura guardadas
POST /api/spotify-aliases           guarda una correccion {from, to}
POST /api/spotify-aliases-delete    quita una {from}
POST /api/spotify-aliases-clear     vacia todas
GET  /api/spotify-device-target     compatibilidad (panel viejo de Cortex)
POST /api/spotify-device-target     compatibilidad
GET  /api/spotify-playback-offset   compatibilidad
POST /api/spotify-playback-offset   compatibilidad
```

Los tres endpoints viejos siguen funcionando y escriben sobre el mismo archivo de ajustes
(`Control Cortex/backend/spotify-device-target.json` y `spotify-playback-offset.json` quedan
como espejo de solo lectura para no romper nada).

## Cómo llegan los ajustes a la extensión

El módulo `Control Cortex/integrations/spotify-auto-music/spotify-auto-music.js` (v24) consulta
`/api/spotify-client-state` cada 4 segundos con `?alive=1&version=24&token=<0|1>`. Esa misma
llamada le entrega un comando pendiente del dashboard (probar tema, simular comentario,
transporte) y sirve para que el dashboard muestre "Extensión SSN: conectada".

El backend copia ese archivo a `SocialStream Ninja/local-overrides/` al arrancar. Después de
tocar el módulo hay que reiniciar el backend y recargar la extensión en `brave://extensions`.

## Prueba rápida del flujo completo

1. Abrir el dashboard y verificar "Extensión SSN: conectada" (idealmente "· instantánea").
2. Encender **Modo prueba (sin esperas)**.
3. Con «Solo analizar» (no reproduce nada) probar frases como `Un tema de laberiso` o
   `Hola matias un temita de los palmeras`: el registro dice qué entendió cada una.
4. Con «Buscar sin reproducir» ver qué tema encuentra Spotify para un nombre mal escrito.
5. En «Simular un comentario del chat» escribir `poneme un tema de Amar Azul` y enviar (esto sí reproduce).
6. Mirar el registro: aparece el pedido con el tema elegido.
7. Repetir el mismo comentario enseguida: en modo prueba no debe decir "Espera 40s".
8. Apagar el modo prueba y repetir dos veces seguidas: la segunda tiene que pedir espera.

## Pruebas automáticas

```bash
cd "D:/plugins para mi OBS/Rulo/tests" && npm test
```

`spotify-dashboard-test.js` carga `spotify-dashboard.html` en jsdom, mockea `fetch` y valida
los chips de estado, el guardado de ajustes, el modo prueba, las pruebas manuales y el registro.
