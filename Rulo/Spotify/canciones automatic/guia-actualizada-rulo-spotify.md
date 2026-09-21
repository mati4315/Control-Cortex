# Guía maestra actualizada — Rulo + Spotify + biblioteca offline + letras + análisis automático

**Fecha de actualización:** 19 de septiembre de 2026  
**Proyecto:** Rulo / Control Cortex / SocialStream Ninja / Spotify  
**Objetivo:** consolidar la arquitectura existente y actualizarla con los resultados reales de la investigación sobre las letras locales de Spotify en Windows.

---

## 1. Contexto real del proyecto

El proyecto corre en **Windows 11** y utiliza **OBS + SocialStream Ninja (SSN) + Control Cortex + Spotify**.

La raíz compartida del workspace es:

```text
D:\plugins para mi OBS
```

Componentes principales:

```text
Control Cortex\
Rulo\
SocialStream Ninja\
```

### Backend central

```text
Control Cortex\backend\server.js
```

Responsabilidades actuales:

- Express
- WebSocket
- APIs de Cortex/Rulo
- configuración
- auto-patcher de SocialStream Ninja
- generación de la base URL LAN
- persistencia actual de Rulo

### Integración Spotify

```text
Control Cortex\integrations\spotify-auto-music\spotify-auto-music.js
```

Responsabilidades actuales:

- interpretar pedidos naturales del chat
- buscar canciones
- controlar Spotify
- seleccionar dispositivo
- cooldown
- offset
- cola de continuación
- respuestas del bot
- relay hacia Rulo

### Overlay Spotify / letras

```text
Control Cortex\frontend\spotify-lyrics-overlay.html
```

Responsabilidades:

- now playing
- progreso
- letras
- sincronización
- integración con Cortex/SSN

### Rulo

```text
Rulo\
```

Es el espacio propio de las funcionalidades nuevas. No se debe convertir SocialStream Ninja en la fuente principal de estas funciones.

---

## 2. Regla fundamental para seguir desarrollando

NO reemplazar ni romper el sistema existente.

Las nuevas funciones de música deben integrarse de manera incremental y respetar:

```text
Rulo = funcionalidades propias
Control Cortex = backend central
SocialStream Ninja = transporte/integración
Spotify = reproductor/catálogo
```

Cuando haya que modificar un override de SSN:

1. cambiar la fuente propia;
2. reiniciar Cortex para ejecutar el auto-patcher;
3. actualizar la extensión en `brave://extensions`;
4. recargar los Browser Sources de OBS correspondientes;
5. ejecutar pruebas reales.

No editar directamente archivos generados dentro de:

```text
SocialStream Ninja\local-overrides\
```

cuando exista una fuente equivalente dentro de `Rulo\` o `Control Cortex\`.

---

## 3. Estado actual de Spotify

El sistema actual ya funciona con Spotify Web de forma más confiable que con el cliente Microsoft Store para control remoto.

Supuesto actual:

```text
Spotify Web
    ↑
Control / SSN
    ↑
spotify-auto-music.js
```

Dispositivo actualmente usado:

```text
NOTEBOOK-MATI
```

Características existentes:

- pedidos naturales desde chat;
- cooldown global de 40 s por defecto;
- cooldown individual de 120 s;
- `!spotifydevices`;
- `!spotifyoffset`;
- offset configurable;
- protección contra seek tardío;
- cola de continuación;
- respuestas del bot;
- relay hacia Rulo.

No cambiar este funcionamiento sin una prueba real del dispositivo de emisión.

---

## 4. Nuevo objetivo general

Queremos evolucionar el sistema para tener una biblioteca musical local/offline gestionada por el propio proyecto.

Objetivos:

```text
1. Detectar canciones locales nuevas.
2. Asociarlas a un Spotify Track ID.
3. Mantener metadata persistente.
4. Analizar automáticamente inicio y final de las canciones.
5. Guardar start_at y end_at sin modificar los archivos originales.
6. Priorizar canciones locales/offline en reproducción automática.
7. Permitir fallback a Spotify online cuando una canción no esté disponible localmente.
8. Evitar repetir canciones automáticas durante el mismo día.
9. Mantener letras sincronizadas.
10. Utilizar las letras locales de Spotify si están disponibles, pero sin depender de ellas.
11. Usar LRCLIB como fuente primaria estable de letras externas.
12. Mantener las letras fuera de la RAM salvo cache temporal.
```

---

## 5. Hallazgo nuevo: letras locales de Spotify

La investigación realizada sobre una instalación real de:

```text
Windows 11
Spotify Microsoft Store 1.300.277.0 x64
```

encontró que Spotify guarda letras en la caché local del cliente.

Resultado principal:

> Spotify puede tener letras completas y sincronizadas almacenadas localmente en el disco y otro proceso puede leerlas, incluso con Spotify cerrado.

Esto fue comprobado con **12 letras reales**.

El informe técnico completo está en:

```text
investigacion-letras-spotify.md
```

---

## 6. Ubicación encontrada en Windows

En la instalación Microsoft Store investigada, los datos relevantes están bajo:

```text
%LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0\
```

La estructura investigada incluye:

```text
LocalState\Spotify\
LocalCache\Spotify\Browser\
```

La caché de navegador relevante está en:

```text
LocalCache\Spotify\Browser\Cache\Cache_Data\
```

Específicamente:

```text
data_1
data_2
data_3
f_*
```

La investigación encontró:

```text
data_1
    → contiene claves/URLs de las entradas

data_2 / data_3
    → contienen cuerpos de respuestas
```

Las letras aparecieron como **JSON comprimido con gzip**, no como archivos `.lrc`, `.json` o `.txt` independientes.

---

## 7. Formato de las letras encontradas

El formato real observado contiene:

```json
{
  "lyrics": {
    "syncType": "LINE_SYNCED",
    "lines": [
      {
        "startTimeMs": "280",
        "words": "Perdóname, mi amor",
        "syllables": [],
        "endTimeMs": "0"
      }
    ],
    "provider": "Musixmatch",
    "providerLyricsId": "143717275",
    "providerDisplayName": "Musixmatch",
    "language": "es"
  }
}
```

Datos importantes:

- sincronización por línea;
- `startTimeMs`;
- texto de cada línea;
- proveedor Musixmatch;
- idioma;
- metadata adicional;
- no se encontraron tiempos por sílaba útiles para karaoke detallado.

---

## 8. Cómo se relacionan las letras con Spotify Track ID

El cuerpo JSON de la letra no contiene el Track ID.

La URL de la entrada de caché sí lo contiene.

Ejemplo observado:

```text
https://spclient.wg.spotify.com/color-lyrics/v2/track/<TRACK_ID>/...
```

Por lo tanto, conceptualmente:

```text
Track ID
    ↓
clave de caché Chromium
    ↓
entrada correspondiente
    ↓
cuerpo JSON gzip
    ↓
lyrics
```

El problema es que la clave y el cuerpo están en distintos archivos de la caché.

Hay que parsear el índice de la caché de Chromium para hacer la relación correctamente.

---

## 9. Confirmaciones importantes

Está comprobado que las letras encontradas:

- existen físicamente en disco;
- son legibles por otro proceso;
- no requieren permisos de administrador;
- pueden leerse con Spotify cerrado;
- están sincronizadas por línea;
- están asociadas al Track ID mediante la URL de caché;
- no están dentro de los blobs de audio offline investigados.

---

## 10. Lo que NO está confirmado

No asumir lo siguiente:

- que todas las canciones descargadas tengan automáticamente una letra cacheada;
- que la letra sobreviva indefinidamente;
- que sobreviva a las actualizaciones de Spotify;
- que el mismo formato funcione igual en todas las versiones;
- que el instalador clásico de Spotify use exactamente la misma ruta;
- que exista un almacén durable separado específicamente para "offline lyrics";
- que el formato de caché permanezca estable.

Estas incertidumbres deben mantenerse documentadas.

---

## 11. Decisión arquitectónica sobre las letras

NO usar la caché local de Spotify como fuente primaria.

La arquitectura recomendada es:

```text
                    ┌──────────────────────┐
                    │   SQLite / lyrics    │
                    │   fuente de verdad   │
                    └──────────┬───────────┘
                               │
                         ¿hay letra?
                         /         \
                       sí           no
                       │             │
                    usarla       LRCLIB
                                  │
                                  ↓
                            guardar en SQLite

Spotify local cache
        ↓
   BONUS opcional
        ↓
si existe una letra útil
        ↓
puede poblar/cubrir antes del fallback externo
```

Fuentes:

```text
SQLite        = fuente de verdad
LRCLIB        = fuente externa principal
spotify_local = bonus opcional
manual        = fallback final
```

La razón es que la caché de Spotify tiene:

- cobertura parcial;
- riesgo de evicción;
- riesgo de borrado;
- formato interno cambiante;
- dependencia de una implementación concreta de Spotify.

---

## 12. Orden recomendado de resolución de letras

Implementar conceptualmente:

```text
resolveLyrics(track)
        │
        ├── 1. SQLite
        │      └── si existe → devolver
        │
        ├── 2. Spotify local cache
        │      └── si se habilita y encuentra → normalizar + guardar
        │
        ├── 3. LRCLIB
        │      └── si encuentra → normalizar + guardar
        │
        └── 4. manual / sin letra
```

La caché local de Spotify no es obligatoria.

Si falla el parser:

```text
Spotify local cache error
        ↓
continuar normalmente
        ↓
LRCLIB
```

Nunca permitir que una falla de lectura de la caché bloquee la reproducción.

---

## 13. Base de datos: una sola SQLite

No crear una base independiente para Spotify, letras, historial y análisis.

Usar una sola base:

```text
music.db
```

La ubicación final debe quedar dentro del área persistente de Rulo/Control Cortex según la estructura definitiva.

Arquitectura:

```text
music.db
│
├── tracks
├── lyrics
├── play_history
└── analysis_jobs
```

SQLite sigue siendo adecuada para aproximadamente 3.000 canciones y un único equipo principal.

---

## 14. Tabla `tracks`

Modelo recomendado:

```text
tracks
    id
    spotify_track_id UNIQUE NOT NULL
    title
    artist
    album
    duration
    offline
    enabled
    local_path
    start_at
    end_at
    skip_seconds
    analysis_status
    created_at
    updated_at
```

### Observación importante

`skip_seconds` puede mantenerse por compatibilidad con el sistema actual, pero la lógica nueva debe preferir:

```text
start_at
end_at
```

porque representan mejor el inicio y fin lógicos.

---

## 15. Tabla `lyrics`

La tabla debe soportar letras sincronizadas.

Modelo conceptual:

```text
lyrics
    track_id
    source
    is_synced
    lyrics
    updated_at
```

Para la arquitectura nueva conviene almacenar una representación normalizada que permita:

```text
start_ms
end_ms
text
```

por línea.

Fuentes:

```text
lrclib
spotify_local
manual
```

El overlay no debe depender de un formato específico de una fuente.

---

## 16. Tabla `play_history`

```text
play_history
    id
    track_id
    played_date
    played_at
    play_mode
```

`play_mode`:

```text
auto
manual
```

Crear un índice/constraint que impida registrar dos veces la misma canción automática para el mismo día si esa es la regla del sistema.

Ejemplo conceptual:

```text
(track_id, played_date)
```

---

## 17. Tabla `analysis_jobs`

Para el scanner:

```text
analysis_jobs
    id
    track_id
    status
    attempts
    error_message
    started_at
    finished_at
```

Estados posibles:

```text
pending
processing
completed
failed
manual_review
manual
```

Cuando el usuario define manualmente un `start_at` o `end_at`, registrar:

```text
analysis_status = manual
```

para evitar que el scanner lo sobrescriba.

---

## 18. RAM: qué mantener y qué no

Principio:

```text
SQLite = fuente de verdad
RAM = cache de ejecución
```

Con ~3.000 canciones, cargar en RAM solamente metadata pequeña:

```text
spotify_track_id
title
artist
offline
start_at
end_at
skip_seconds
duration
enabled
```

Además:

```text
offline_track_ids
played_today_ids
```

como `Set`.

No cargar las 3.000 letras completas en RAM.

---

## 19. Cache temporal de letras

Las letras se deben leer bajo demanda.

Ejemplo:

```text
pedido de canción
      ↓
resolver lyrics
      ↓
SQLite
      ↓
cache temporal
```

Puede existir un pequeño cache LRU de:

```text
3–20 canciones
```

o una cantidad configurable.

Cuando una canción deja de ser relevante, su letra puede salir de RAM.

---

## 20. LRCLIB

La investigación confirmó que LRCLIB:

- funciona sin cuenta;
- no necesita clave API;
- devuelve sincronización;
- permite obtener texto plano;
- permite obtener información sincronizada;
- puede responder sin letra existente usando el flag correspondiente.

Se debe comprobar:

```text
error
```

y no depender exclusivamente del:

```text
HTTP status
```

El formato sincronizado debe normalizarse a:

```text
start_ms
end_ms
text
```

---

## 21. Reproducción: biblioteca local/offline

La lógica de reproducción debe separar:

```text
solicitud manual
```

de:

```text
selección automática
```

### Solicitud manual

```text
Usuario pide canción
        ↓
resolver Track ID
        ↓
¿hay versión local?
     /         \
   sí           no
   │             │
local            Spotify online
   │
start_at/end_at
```

Una solicitud manual puede repetir una canción aunque ya haya sido reproducida ese día.

---

## 22. Selección automática

Para modo automático:

```text
offline = true
AND
enabled = true
AND
played_today = false
```

Seleccionar aleatoriamente.

Cuando se reproduce:

```text
play_history
```

se registra con:

```text
play_mode = auto
```

También mantener:

```text
played_today_ids
```

en RAM para evitar consultas repetidas.

---

## 23. Cuando se terminan las canciones del día

Si:

```text
candidates = 0
```

el sistema debe iniciar un nuevo ciclo y volver a permitir canciones.

Ejemplo:

```text
no quedan canciones sin reproducir
        ↓
reset del ciclo automático
        ↓
volver a seleccionar
```

No bloquear el bot por haberse agotado el catálogo.

---

## 24. Scanner de biblioteca local

El scanner debe detectar:

```text
archivos nuevos
```

y comparar con SQLite.

Flujo:

```text
scan
  ↓
detectar archivo
  ↓
leer metadata
  ↓
obtener Spotify Track ID
  ↓
buscar en SQLite
     ├── existe → actualizar si corresponde
     └── nuevo → insertar
  ↓
analizar canción
```

Comandos sugeridos:

```text
!scan
!scan --new
!reanalyze <song>
!reanalyze-all
```

---

## 25. Importante: las letras NO forman parte del scanner de audio

El scanner de canciones no debe asumir:

```text
archivo de audio
    ↓
lyrics
```

Las letras de Spotify aparecen en la caché HTTP del cliente, no dentro de los blobs de audio offline investigados.

Por lo tanto:

```text
scanner de audio
       ↓
archivo + metadata + duración + análisis
```

y:

```text
lyrics resolver
       ↓
SQLite / Spotify cache / LRCLIB / manual
```

son subsistemas separados.

---

## 26. Análisis automático del inicio

Para cada canción nueva:

```text
analizar primeros 15 segundos
```

Objetivo:

```text
start_at
```

Buscar:

- silencio;
- volumen muy bajo;
- ruido irrelevante;
- instrumental innecesario;
- comienzo real de voz/contenido;
- transición.

Ejemplo:

```text
0.0 s → silencio
3.4 s → instrumental
8.2 s → comienza contenido
```

Guardar:

```text
start_at = 8.2
```

---

## 27. Análisis automático del final

Analizar:

```text
últimos 15 segundos
```

Objetivo:

```text
end_at
```

Ejemplo:

```text
duration = 242.0
end_at = 237.5
```

No recortar físicamente el archivo.

---

## 28. IA para análisis

No utilizar IA para las 3.000 canciones sin necesidad.

Flujo:

```text
audio analysis
      ↓
¿resultado claro?
   /       \
 sí         no
 │           │
guardar      IA
```

La IA sólo debe recibir un fragmento limitado cuando sea necesaria:

```text
inicio: 0–15 s
final: últimos 15 s
```

Validar siempre el resultado.

Reglas:

```text
0 <= start_at <= 15
duration - 15 <= end_at <= duration
start_at < end_at
```

Fallback:

```text
start_at = 0
end_at = duration
```

---

## 29. No modificar los archivos originales

Nunca hacer como comportamiento normal:

```text
MP3 original
   ↓
recomprimir
   ↓
nuevo MP3
```

Guardar:

```text
start_at
end_at
```

y pedirle al reproductor que comience en:

```text
start_at
```

y considere:

```text
end_at
```

como fin lógico.

Sólo generar copias recortadas si la tecnología de reproducción realmente lo exige.

---

## 30. Relación entre letras y `start_at`

Las letras vienen con tiempos absolutos respecto de la pista.

Ejemplo:

```text
start_at = 8.2 s

lyrics:
00.280
03.770
...
```

El overlay debe seguir el **progreso real de Spotify**, no inventar un segundo reloj.

La regla existente continúa:

> Las letras no deben calcular un offset independiente. Deben seguir el progreso real que recibe el overlay.

---

## 31. Integración con el overlay de letras

Archivo:

```text
Control Cortex\frontend\spotify-lyrics-overlay.html
```

El overlay ya:

- descarta estados antiguos;
- compensa tránsito de red;
- usa URI/ID de pista para detectar cambios;
- cancela respuestas tardías;
- recibe aviso inmediato y confirmación de Spotify.

La nueva capa de resolución de letras debe entregar al overlay un formato normalizado, por ejemplo:

```json
{
  "trackId": "spotify-track-id",
  "source": "lrclib",
  "synced": true,
  "lines": [
    {
      "startMs": 25530,
      "endMs": 28680,
      "text": "..."
    }
  ]
}
```

---

## 32. Normalización obligatoria de fuentes

El overlay NO debería conocer el formato de:

```text
Spotify cache
LRCLIB
manual
```

Cada fuente debe convertirse a un modelo interno común:

```text
NormalizedLyrics
    trackId
    source
    language
    synced
    lines[]
```

con:

```text
line.startMs
line.endMs
line.text
```

Arquitectura:

```text
Spotify cache ──┐
LRCLIB ─────────┼──> NormalizedLyrics ──> overlay
manual ─────────┘
```

---

## 33. Parser de caché de Spotify: diseño recomendado

La lectura de la caché debe estar aislada.

Componente conceptual:

```text
SpotifyLyricsCacheReader
```

Responsabilidad única:

```text
discoverCache()
findTrackEntry(trackId)
readCacheBody(entry)
decompress()
parseLyrics()
normalize()
```

Salida:

```text
NormalizedLyrics | null
```

Si algo falla:

```text
return null
```

Nunca lanzar una excepción que detenga la reproducción.

---

## 34. Cómo encontrar la caché

La versión investigada de Microsoft Store usa:

```text
%LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0\
```

Pero no hardcodear solamente esa ruta.

La búsqueda debe:

1. detectar la instalación;
2. revisar las rutas conocidas;
3. localizar `LocalCache\Spotify\Browser\Cache\Cache_Data`;
4. verificar que existan `data_*`;
5. trabajar con lo que realmente exista en la máquina.

La versión investigada no tenía:

```text
%LOCALAPPDATA%\Spotify
```

porque esa corresponde a otra modalidad de instalación.

---

## 35. Evitar falsas coincidencias

NO hacer simplemente:

```text
buscar la palabra "lyrics"
```

en todos los archivos.

La investigación demostró que los cuerpos están comprimidos y que las búsquedas simples no encuentran las letras.

El parser debe reconocer las entradas de caché y:

```text
1. localizar claves relevantes;
2. extraer URL;
3. obtener Track ID;
4. localizar cuerpo asociado;
5. descomprimir gzip;
6. parsear JSON;
7. validar estructura lyrics;
8. normalizar;
9. devolver.
```

---

## 36. Herramienta de investigación ya creada

La investigación dejó:

```text
Rulo/otros/investigar-letras-spotify.js
```

Uso:

```bash
node "Rulo/otros/investigar-letras-spotify.js"
```

y:

```bash
node "Rulo/otros/investigar-letras-spotify.js" --mapa
```

También admite fotos de estado:

```bash
node "Rulo/otros/investigar-letras-spotify.js" --foto antes
```

después de la prueba:

```bash
node "Rulo/otros/investigar-letras-spotify.js" --foto despues
```

La herramienta está diseñada para leer archivos del usuario y no modifica ni descifra el audio.

---

## 37. Qué debe verificarse antes de convertir Spotify local en una feature estable

Antes de implementar el parser como parte permanente del bot, realizar una prueba controlada:

```text
1. Cerrar Spotify.
2. Foto "antes".
3. Abrir Spotify.
4. Reproducir una canción con letras.
5. Descargarla para offline.
6. Esperar a que termine.
7. Abrir Lyrics.
8. Cerrar Spotify.
9. Foto "después".
10. Comparar.
```

Objetivos:

```text
¿qué archivo cambia?
¿aparece una entrada nueva?
¿aparece el Track ID?
¿aparece la letra?
¿aparecen timestamps?
¿la entrada existe con Spotify cerrado?
```

Esta parte todavía debe considerarse una validación adicional, aunque ya existen hallazgos reales de caché.

---

## 38. Arquitectura final recomendada

```text
                         ┌─────────────────────┐
                         │      SPOTIFY         │
                         │ Web / local client   │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼──────────┐
                         │ spotify-flujo       │
                         └──────────┬──────────┘
                                    │
                      ┌─────────────┴─────────────┐
                      │                           │
                      ↓                           ↓
               reproducción                resolver lyrics
                      │                           │
              ┌───────┴────────┐        ┌────────┴─────────┐
              │                │        │                  │
             LOCAL            ONLINE   SQLite        Spotify cache
              │                │        │                  │
              │                │        └───────┐          │
              ↓                ↓                │          │
        start_at/end_at   Spotify Web        si falta       │
                                                  ↓         │
                                                LRCLIB      │
                                                  │         │
              └──────────────────────────────────┴─────────┘
                                    │
                                    ↓
                           NormalizedLyrics
                                    │
                                    ↓
                       spotify-lyrics-overlay
                                    │
                                    ↓
                                   OBS
```

---

## 39. Flujo de solicitud manual

Ejemplo:

```text
"poneme Ke Personajes"
```

Flujo:

```text
chat
 ↓
spotify-auto-music.js
 ↓
buscar Track ID
 ↓
¿hay canción local?
 ├── sí
 │    ↓
 │  reproducción local
 │  aplicar start_at/end_at
 │
 └── no
      ↓
    Spotify Web
```

En paralelo:

```text
resolverLyrics(trackId)
      ↓
SQLite
      ↓
si falta:
Spotify local cache (opcional)
      ↓
si falta:
LRCLIB
      ↓
guardar
```

---

## 40. Flujo automático

```text
timer / fin de canción
        ↓
buscar candidatos
        ↓
offline = true
enabled = true
played_today = false
        ↓
elegir aleatoriamente
        ↓
reproducir
        ↓
aplicar start_at/end_at
        ↓
registrar play_history
        ↓
actualizar played_today_ids
```

---

## 41. Rendimiento esperado

La arquitectura sigue siendo ligera.

### RAM

Sólo metadata:

```text
~3.000 tracks
```

No cargar letras completas permanentemente.

### SQLite

Para unas 3.000 canciones:

```text
extremadamente manejable
```

### Lyrics

Guardar las letras en SQLite no obliga a cargarlas todas en RAM.

La caché de Spotify investigada también es pequeña a nivel de archivos relevantes y sólo debería parsearse cuando sea necesario.

---

## 42. Índices recomendados

Para SQLite:

```text
UNIQUE spotify_track_id
INDEX offline, enabled
INDEX played_date
INDEX track_id, played_date
```

y para `lyrics`:

```text
PRIMARY KEY / UNIQUE track_id
```

---

## 43. Sincronización de RAM y SQLite

Cada cambio debe reflejarse inmediatamente:

```text
SQLite UPDATE
      ↓
actualizar RAM
```

No depender de reiniciar el bot.

Por ejemplo:

```text
!addskip
```

debe actualizar:

```text
SQLite
 +
RAM
```

sin reinicio.

---

## 44. Historial diario

Usar una fecha lógica de operación del bot:

```text
played_date = YYYY-MM-DD
```

y timestamps completos separados cuando sean necesarios.

Al iniciar:

```text
leer play_history del día
        ↓
played_today_ids
```

---

## 45. Comandos propuestos

Mantener o adaptar los comandos según la UI real:

```text
!scan
!scan --new
!reanalyze <song>
!reanalyze-all

!skiplist
!addskip <seconds> <song>
!changeskip <seconds> <song>
!removeskip <song>

!lyrics <song>
!history today
!resetdaily
!reloadcache
```

No implementar comandos que dupliquen capacidades ya existentes sin necesidad.

---

## 46. Dashboard Spotify

La página actual es:

```text
http://192.168.4.100:4000/rulo-spotify.html
```

Actualmente controla:

- esperas;
- modo prueba sin esperas;
- dispositivo;
- pruebas;
- registro;
- cambios automáticos.

Cualquier nueva sección de biblioteca debería integrarse sin romper estas funciones.

Posibles áreas futuras:

```text
Biblioteca local
Análisis
Letras
Historial
Diagnóstico
```

---

## 47. Logs y diagnóstico

Agregar logs útiles pero no excesivos.

Ejemplos:

```text
[SpotifyLyrics] track=XXXX source=sqlite
[SpotifyLyrics] track=XXXX source=spotify_local
[SpotifyLyrics] track=XXXX source=lrclib
[SpotifyLyrics] track=XXXX no lyrics
```

Para errores:

```text
[SpotifyLyrics] cache parse failed
```

No registrar:

- cookies;
- tokens;
- credenciales;
- secretos;
- datos privados innecesarios.

---

## 48. Seguridad

La investigación realizada NO descifró DRM ni extrajo audio protegido.

El desarrollo debe seguir exactamente ese límite.

No implementar:

```text
descifrado del audio
extracción del audio protegido
bypass de DRM
```

El lector de letras sólo debe leer metadata/texto de letras que ya esté en caché local.

---

## 49. Licenciamiento / letras

Las letras encontradas indican proveedor:

```text
Musixmatch
```

Que técnicamente podamos leerlas no implica automáticamente derechos adicionales de uso público.

La arquitectura debe mantener visible el origen:

```text
source = spotify_local
source = lrclib
source = manual
```

El uso de letras en el stream debe tratarse como contenido licenciado.

---

## 50. Qué NO hacer

No:

```text
- cargar todas las letras en RAM;
- hacer de Spotify cache la única fuente;
- bloquear la reproducción si falla el parser;
- hardcodear una única ruta para todas las instalaciones;
- asumir que cache = biblioteca permanente;
- modificar audio original;
- depender de un endpoint interno de Spotify como API estable;
- mezclar parser de caché con control de reproducción;
- modificar archivos generados de SSN como fuente principal;
- guardar secretos en logs/documentación.
```

---

## 51. Prioridades de implementación

### Fase 1 — Base persistente

Implementar:

```text
music.db
tracks
lyrics
play_history
analysis_jobs
```

sin romper el sistema existente.

### Fase 2 — Biblioteca local

Implementar:

```text
scanner
Track ID
local_path
offline
```

### Fase 3 — start_at / end_at

Implementar:

```text
análisis de audio
fallback
override manual
```

### Fase 4 — Reproducción

Implementar:

```text
local primero
online fallback
manual vs auto
daily history
```

### Fase 5 — Lyrics

Primero:

```text
SQLite + LRCLIB
```

Después:

```text
Spotify local cache
```

como optimización opcional.

---

## 52. Estrategia de implementación del lector de letras Spotify

No incorporarlo directamente en el núcleo del bot.

Usar:

```text
SpotifyLyricsCacheReader
```

con responsabilidades:

```text
discoverCache()
findTrackEntry(trackId)
readCacheBody(entry)
decompress()
parseLyrics()
normalize()
```

Salida:

```text
NormalizedLyrics | null
```

El resolver superior decide:

```text
SQLite
→ Spotify local
→ LRCLIB
→ manual
```

---

## 53. Tolerancia a actualizaciones de Spotify

Como Spotify puede cambiar:

- ruta;
- estructura;
- compresión;
- nombres;
- formato;
- endpoint;
- caché;

la integración debe tener un mecanismo configurable equivalente a:

```text
spotifyLocalLyricsEnabled = true
```

Si el parser deja de funcionar:

```text
desactivar automáticamente / fallback
```

sin afectar:

```text
reproducción
LRCLIB
overlay
```

---

## 54. Qué hacer si Spotify cambia la caché

El sistema debe continuar:

```text
Spotify local unavailable
        ↓
SQLite
        ↓
LRCLIB
        ↓
manual
```

No permitir que la desaparición de Spotify local rompa el streaming.

---

## 55. Pruebas mínimas antes de considerar terminado

### Playback

```text
manual local
manual online
automatic local
```

### Offset

```text
start_at = 0
start_at > 0
end_at < duration
```

### Lyrics

```text
SQLite lyrics
Spotify local lyrics
LRCLIB lyrics
no lyrics
```

### Cache

```text
Spotify cerrado
Spotify abierto
cache vacía
cache corrupta
cache eliminada
```

### Daily history

```text
auto no repeat
manual repeat
reset daily cycle
```

### Actualización

```text
Spotify actualizado
ruta diferente
parser incompatible
```

En todos esos escenarios la reproducción debe continuar.

---

## 56. Comandos de verificación de sintaxis actuales

Después de modificar código Node:

```powershell
node --check 'D:\plugins para mi OBS\Control Cortex\backend\server.js'

node --check 'D:\plugins para mi OBS\Control Cortex\integrations\spotify-auto-music\spotify-auto-music.js'
```

Si se modifica:

```text
Rulo\rulo-chat-relay.js
```

también:

```powershell
node --check 'D:\plugins para mi OBS\Rulo\rulo-chat-relay.js'
```

---

## 57. Flujo de despliegue actual

Después de tocar un override:

```text
1. Reiniciar Control Cortex.
2. Abrir brave://extensions.
3. Actualizar SocialStream Ninja.
4. Recargar Browser Sources de OBS.
5. Probar.
```

No saltarse la prueba real.

---

## 58. Uso de agentes

Mantener responsabilidades separadas.

### spotify-flujo

```text
parser
busqueda
dispositivo
offset
cola
reproducción
```

### cortex-backend

```text
SQLite
API
WebSocket
persistencia
migraciones
```

### lyrics-engine

```text
SQLite lyrics
LRCLIB
Spotify local cache
normalización
cache LRU
```

### music-library

```text
scanner
detección de nuevos archivos
metadata
Track IDs
offline
```

### audio-analysis

```text
start_at
end_at
audio analysis
IA sólo cuando sea necesario
```

### qa-stream

```text
Spotify Web
SSN
OBS
overlay
pruebas end-to-end
```

No permitir que un agente de UI modifique el núcleo de reproducción sin pruebas.

---

## 59. Estado de partida exacto

Ya existente:

```text
Rulo
Control Cortex
Spotify Web control
chat parser
cooldowns
device selection
offset
queue
Spotify lyrics overlay
Rulo overlay
Rulo chat history
WebSocket
SSN relays
auto-patcher
```

La investigación nueva agregó conocimiento técnico sobre:

```text
Spotify local lyrics cache
```

pero **no debe considerarse una dependencia obligatoria todavía**.

La arquitectura operativa recomendada queda:

```text
                 ┌──────────────────────┐
                 │      SPOTIFY         │
                 │ Web / local client   │
                 └──────────┬───────────┘
                            │
                   ┌────────▼────────┐
                   │ spotify-flujo   │
                   └────────┬────────┘
                            │
                 ┌──────────▼──────────┐
                 │    music.db         │
                 │                    │
                 │ tracks             │
                 │ lyrics             │
                 │ history            │
                 │ analysis_jobs      │
                 └──────────┬─────────┘
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
          ▼                 ▼                  ▼
     biblioteca        lyrics-engine      audio-analysis
       local               │                  │
          │                │                  │
          │        ┌───────┴───────┐          │
          │        │               │          │
          │     Spotify          LRCLIB       │
          │      cache                         │
          │                                    │
          └────────────────┬───────────────────┘
                           │
                           ▼
                spotify-lyrics-overlay
                           │
                           ▼
                          OBS
```

---

## 60. Decisión final

La investigación cambia nuestra conclusión original de esta manera:

### Antes

```text
SQLite + lyrics externas
```

### Después de investigar Spotify

No conviene invertir el orden por completo.

La arquitectura correcta es:

```text
SQLite = fuente de verdad
LRCLIB = fuente externa principal
Spotify local cache = bonus/fallback local
manual = fallback final
```

La caché local de Spotify es técnicamente aprovechable y fue verificada en una instalación real, pero no tiene la estabilidad ni cobertura necesarias para convertirse en la base principal del sistema.

---

## 61. Resultado esperado del proyecto

El sistema terminado debería poder hacer:

```text
USUARIO PIDE CANCIÓN
        ↓
Spotify Track ID
        ↓
¿existe local?
   ├── sí → usar local + start/end
   └── no → Spotify Web
        ↓
resolver lyrics
        ↓
SQLite
        ↓
si falta → Spotify local cache
        ↓
si falta → LRCLIB
        ↓
si falta → manual/sin letra
```

Y para reproducción automática:

```text
biblioteca local
        ↓
filtrar reproducidas hoy
        ↓
elegir aleatoriamente
        ↓
start_at / end_at
        ↓
reproducir
        ↓
registrar history
```

Con esta arquitectura:

```text
Spotify cache
```

es una optimización interesante, pero:

```text
NO es un punto único de fallo.
```

---

## 62. Referencias del contexto del proyecto

El contexto actual de Rulo, Control Cortex, Spotify y SSN incluye:

- Rulo como espacio independiente para funcionalidades propias;
- el módulo Spotify dentro de `Control Cortex\integrations\spotify-auto-music`;
- el overlay de Spotify/letras en `Control Cortex\frontend\spotify-lyrics-overlay.html`;
- Spotify Web como supuesto operativo más confiable para el control remoto;
- parser natural, cooldown, selección de dispositivo, offset y cola ya implementados;
- sincronización de letras basada en el progreso real de la pista.

No alterar estos componentes sin revisar primero sus dependencias.

---

## 63. Regla de mantenimiento

Antes de cerrar cualquier implementación relacionada con música:

```text
1. No romper funciones existentes.
2. No duplicar fuentes de verdad.
3. No cargar datos innecesarios en RAM.
4. No modificar audio original.
5. Hacer fallback cuando una fuente falle.
6. Validar Track IDs.
7. Validar timestamps.
8. Probar reproducción real.
9. Probar overlay real.
10. No guardar secretos.
11. Mantener Spotify local lyrics como módulo opcional.
12. Documentar cualquier cambio de arquitectura.
```

Este documento reemplaza la guía anterior como referencia de arquitectura para la evolución del sistema de música.
