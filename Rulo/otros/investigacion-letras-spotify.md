# Informe técnico: ¿Spotify guarda las letras en Windows y se pueden aprovechar?

**Investigación pedida en:** `Rulo/otros/investigar lo de Spotify.txt`
**Fecha:** 19 de septiembre de 2026
**Máquina y cliente investigados:** Windows 11 · Spotify **Microsoft Store 1.300.277.0** (x64)
**Estado:** investigación cerrada. **No se implementó nada** ni se modificó la arquitectura del proyecto.

**Herramienta reproducible que acompaña este informe:** `Rulo/otros/investigar-letras-spotify.js` (sólo lee archivos del usuario; no descifra audio, no modifica nada).

---

## 1. Veredicto

| Pregunta de fondo | Respuesta |
| --- | --- |
| ¿Es **posible** leer letras que Spotify ya tiene localmente en Windows? | **Sí.** Verificado: 12 letras completas, sincronizadas por línea, en la caché del cliente, legibles desde otro proceso, sin permisos de administrador y con Spotify cerrado. |
| ¿Conviene usarla como **fuente primaria** de letras? | **No.** Cobertura parcial, se borra con la caché, el formato puede cambiar con cualquier actualización y hay que parsear el formato interno de la caché de Chromium. |
| ¿Qué conviene entonces? | **LRCLIB** como fuente primaria (probada en vivo, gratis, sin cuenta, sincronizada) + `manual`; la caché local sólo como *bonus* opcional. |

Resumen en una línea: **la letra está, se puede leer, pero no es una base sobre la que construir.**

---

## 2. Cómo se investigó

1. Reconocimiento del disco: rutas del usuario (`%LOCALAPPDATA%\Spotify`, `%LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_*`, `LocalState`, `LocalCache`, `Storage`, `Users`, `Browser`) sin asumir que las rutas históricas siguen siendo válidas.
2. Búsqueda por nombre de archivo (`*lyric*`), por tipo (SQLite `.db`, `.ldb`, `.json`, `.file`, `.bnk`) y por contenido.
3. Barrido de contenido de **todos** los archivos del paquete (390 MB, 561 archivos) buscando marcadores del formato de letras sincronizadas (`startTimeMs`, `LINE_SYNCED`, `providerLyricsId`, `syncLyricsUri`, `isDenseTypeface`).
4. Al no aparecer en texto plano: **descompresión** de los cuerpos (brotli / gzip / deflate) y nueva búsqueda — incluidos los *streams* comprimidos incrustados dentro de archivos mayores.
5. Extracción y parseo del JSON de las letras encontradas; medición de la relación clave ↔ cuerpo dentro de la caché.
6. Verificación cruzada del contenido con una fuente externa independiente (LRCLIB) para confirmar que es la misma letra y los mismos tiempos.
7. Comprobación en vivo del endpoint interno documentado por la comunidad y de su formato de respuesta.

Contraste con fuentes públicas: anuncio oficial de letras offline (The Verge y PCMag, 4-5 de febrero de 2026), documentación comunitaria del endpoint `color-lyrics` (spicetify, StackOverflow, proyectos de letras) y el comportamiento de las apps de letras para escritorio.

---

## 3. Qué hay en la máquina (evidencia)

### 3.1 Instalación

- Cliente: **Microsoft Store**, versión **1.300.277.0**.
  `C:\Program Files\WindowsApps\SpotifyAB.SpotifyMusic_1.300.277.0_x64__zpdnekdrzrea0`
- Datos: `%LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0\` — **390 MB** totales.
  - `LocalState\Spotify\` → 123 MB (`Storage\` 78 MB de blobs `.file`, `Users\` 45 MB)
  - `LocalCache\Spotify\` → 267 MB (`Browser\` = perfil Chromium completo)
- **No existe** `%LOCALAPPDATA%\Spotify` en esta máquina: esa es la ruta del instalador clásico, que acá no aplica.

### 3.2 El cliente de escritorio es un navegador

`LocalCache\Spotify\Browser\` contiene `Cache`, `Cache_Data`, `IndexedDB`, `Local Storage`, `Session Storage`, `Service Worker`, `Code Cache`, `Network`. Esto define **dónde** buscar: todo lo que el cliente pide por HTTP puede quedar en su caché.

### 3.3 Descartado (con evidencia)

| Se buscó | Resultado |
| --- | --- |
| Archivos con `lyric` en el nombre | **Ninguno** en todo el paquete |
| SQLite de Spotify | **No hay**. Los 3 `.db` hallados son de Chromium (`WidevineCdm`, `heavy_ad_intervention_opt_out`, `first_party_sets`) |
| `.json` propios de Spotify | Sólo 4, todos de Chromium/Widevine |
| Letras en texto plano | **Cero** coincidencias en 390 MB |
| Letras dentro del audio offline | `Storage\` (69 blobs `.file`, 794 B a 6,8 MB, cabeceras JPEG/OGG) — **cero** marcadores de letras |
| "lyrics" en el LevelDB (`primary.ldb`, 45 MB) | Sólo **títulos de canciones** ("Pain (Fine Malt Lyrics)", "Lyrical Lemonade", "Lyric Pieces") |

### 3.4 Dónde están de verdad

En la caché HTTP del navegador interno:

```
%LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0\LocalCache\Spotify\Browser\Cache\Cache_Data\
    data_0   45 KB    (varios)
    data_1  270 KB    ← CLAVES de las entradas (URLs)
    data_2   1,0 MB   ← CUERPOS (letras gzip, imágenes, brotli)
    data_3   4,2 MB   ← CUERPOS
    f_0000xx  ...     ← cuerpos grandes: JPEG / PNG / WebP / brotli
```

Las letras **no** aparecen como texto: son **JSON comprimido con gzip incrustado** dentro de `data_2` y `data_3` (magic `1f 8b 08`). Por eso cualquier búsqueda de texto plano da cero.

### 3.5 Lo extraído

**12 letras** cacheadas, todas `LINE_SYNCED` del proveedor **Musixmatch**:

```
data_1@32768    38 líneas | es | 280 ms → 193540 ms   "Perdóname, mi amor"
data_2@243712   64 líneas | es | 25550 ms → 341310 ms "Ella despidió a su amor"
data_2@290816   55 líneas | es | 13810 ms → 308260 ms "Aquí me tiene bien clavado"
data_2@292864   49 líneas | es | 22150 ms → 237830 ms "Eres como una mariposa"
data_2@311296   54 líneas | es | 40 ms → 205620 ms    "Cuidado"
data_2@313344   61 líneas | en | 29310 ms → 292170 ms "She was more like a beauty queen…"
data_2@393216   58 líneas | en | 38100 ms → 255830 ms "They told him, \"Don't you ever…\""
data_2@395264   30 líneas | es | 12350 ms → 150240 ms "Fue mucho mi penar andando lejos…"
data_2@421888   51 líneas | es | 5490 ms → 286890 ms  "Yo siento que me provocas"
data_2@423936   48 líneas | es | 2730 ms → 244300 ms  "¡Ey! Como siempre"
data_2@518144   39 líneas | es | 10 ms → 175570 ms    "Estar sin ti"
data_2@569344   49 líneas | es | 185990 ms → …        "Salgo volando por la ventana"
```

**Formato exacto del cuerpo** (JSON, 5.251 bytes el primero):

```json
{
  "lyrics": {
    "syncType": "LINE_SYNCED",
    "lines": [
      { "startTimeMs": "280",   "words": "Perdóname, mi amor",              "syllables": [], "endTimeMs": "0" },
      { "startTimeMs": "3770",  "words": "Por pedirte tanto, tanto amor",   "syllables": [], "endTimeMs": "0" }
    ],
    "provider": "Musixmatch",
    "providerLyricsId": "143717275",
    "providerDisplayName": "Musixmatch",
    "syncLyricsUri": "",
    "isDenseTypeface": false,
    "alternatives": [],
    "language": "es",
    "isRtlLanguage": false,
    "capStatus": "",
    "previewLines": []
  },
  "colors": { "background": -9079435, "text": -16777216, "highlightText": -1 },
  "hasVocalRemoval": false
}
```

Puntos clave: **`startTimeMs` por línea** (string, milisegundos), **sílabas vacías** (no hay karaoke por sílaba), colores de la portada incluidos, y `providerLyricsId` de Musixmatch.

### 3.6 Cómo se identifica la canción

- El cuerpo de la letra **no trae** ningún identificador adentro.
- En `data_1` están las **claves** (la URL de cada petición), y ahí sí aparece el **Track ID**:

```
https://spclient.wg.spotify.com/color-lyrics/v2/track/2s8CxJRN5vTaf6rjKIE3md/image/spotify%3Aimage%3Aab67616d0000b273a5a181712999036d6d9a5cc6?format=json&vocalRemoval=false&market=from_token
https://spclient.wg.spotify.com/metadata/4/track/50a04098fe694b149a38a9ece87e3d6d?market=from_token
```

Conteos exactos en la caché: **12 claves** `color-lyrics/v2/track/<ID>` (la variante `/image/`, que el cliente pide junto con la letra) y **12 cuerpos** de letra. Además 15 claves `metadata/4/track/<hex>`.

- La relación `Track ID → líneas` existe, pero **la clave y el cuerpo están en archivos distintos** (`data_1` vs `data_2/3`): unirlos de forma confiable exige **parsear el índice de la caché simple de Chromium** (hash de clave → dirección de entrada). Es factible, pero es trabajo real y frágil — no alcanza con "buscar el texto".

### 3.7 Acceso

- Lectura **con Spotify cerrado**: sí (así se hizo).
- Sin permisos de administrador: sí (carpeta del usuario).
- No se descifró ni se tocó el audio protegido: los blobs de `Storage\` se inspeccionaron sólo para comprobar que **no** contienen letras.

### 3.8 Verificación cruzada con una fuente independiente

LRCLIB devuelve la misma letra con los mismos tiempos (±20 ms), lo que confirma que el contenido cacheado por Spotify es la letra de Musixmatch:

```
Spotify (caché): 25550 ms → "Ella despidió a su amor"
LRCLIB         : 25530 ms → "Ella despidió a su amor"
```

---

## 4. Conclusiones clasificadas

### A. Confirmado (verificado, reproducible)

1. El cliente de escritorio de Windows **guarda el JSON de letras en disco**, comprimido con gzip, dentro de su caché HTTP.
2. Formato: `syncType: LINE_SYNCED` con **`startTimeMs` por línea** (milisegundos) + `words`, proveedor Musixmatch, idioma, colores.
3. **Se leen desde otro proceso**, sin administrador y **con Spotify cerrado**.
4. La ruta y el formato del contenedor: caché simple de Chromium en `LocalCache\Spotify\Browser\Cache\Cache_Data\data_*`.
5. Los **Track IDs** aparecen como claves de la caché (`color-lyrics/v2/track/<ID>…`), no dentro del cuerpo.
6. El endpoint que usa el cliente es `spclient.wg.spotify.com/color-lyrics/v2/track/{id}`; `lyrics/v1` quedó en desuso.
7. El **audio offline está cifrado** y no es accesible — y no hace falta para esto.
8. **LRCLIB funciona sin cuenta ni clave** y devuelve sincronizada (LRC), plana y estructurada con `start_ms`/`end_ms`.

### B. Probable (evidencia técnica, sin confirmación oficial)

1. La función "letras offline" (anunciada en febrero de 2026) es real, pero en **escritorio** lo que existe es esta caché HTTP; **no se encontró un almacén durable específico** (y el anuncio se comunicó con foco en la app móvil).
2. Las letras se cachean **cuando el cliente las pide** (al mostrar la vista de letras): hay 12 de las muchas canciones escuchadas.
3. La duración de cada entrada depende de la evicción de la caché y de su tamaño; **"Borrar caché" en Ajustes las borra**.
4. El mapeo `clave → cuerpo` requiere parsear el índice de la caché de Chromium (o una heurística por cercanía, menos fiable).
5. El endpoint interno `color-lyrics` **rechaza tokens de la Web API oficial** (403 "Client not allowed") y exige el token del reproductor web / cookie de sesión — dato de la comunidad, no verificado acá.

### C. Desconocido

1. Si el instalador clásico (`%LOCALAPPDATA%\Spotify`) usa la misma ruta y estructura (no está instalado en esta máquina).
2. Si el contenido cambia entre online y offline, y si sobrevive a actualizaciones del cliente.
3. Si existen letras cacheadas para canciones descargadas cuyas letras nunca se mostraron.
4. Cuánto tiempo sobrevive exactamente cada entrada (no se pudo leer el `cache-control` de las entradas).

---

## 5. Las 18 preguntas puntuales

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | ¿Spotify guarda letras offline en Windows? | **Sí** guarda las letras que pide (verificado). Almacén durable "offline": probable, no encontrado |
| 2 | ¿Dónde? | `%LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0\LocalCache\Spotify\Browser\Cache\Cache_Data\data_2` y `data_3`. **No** hay `%LOCALAPPDATA%\Spotify` en la versión Store |
| 3 | ¿En qué formato? | **JSON + gzip** incrustado en la caché de Chromium. No hay SQLite ni protobuf propio de letras |
| 4 | ¿Se pueden leer desde otro proceso? | **Sí**, sin administrador y con Spotify cerrado |
| 5 | ¿Están asociadas al Spotify Track ID? | Sí, en la **clave** (URL `color-lyrics/v2/track/<ID>`); el cuerpo no lo incluye |
| 6 | ¿Incluyen timestamps? | Sí, `startTimeMs` **por línea** (LINE_SYNCED). Sin timing por sílaba |
| 7 | ¿Completas o parciales? | Cada letra está **completa** para esa canción (30-64 líneas, hasta el final); la **cobertura** es parcial (sólo lo pedido) |
| 8 | ¿Necesitan Spotify abierto? | **No** |
| 9 | ¿Cambian entre online/offline? | Desconocido |
| 10 | ¿Usables legal/técnicamente sin tocar el audio? | Técnicamente sí (no hay descifrado de DRM: la letra está en texto comprimido). Las letras son contenido licenciado (Musixmatch): mostrarlas en el stream tiene las mismas implicancias que con cualquier fuente |
| 11 | ¿Riesgos de depender de esa estructura? | Altos: evicción/borrado de caché, cobertura parcial, cambios de formato, mapeo no trivial |
| 12 | ¿Spotify puede cambiarla fácilmente? | **Sí**, muy fácilmente (formato de caché, ruta, endpoint) |
| 13 | ¿Fuente primaria o fallback? | **Sólo fallback/bonus**. Nunca primaria |
| 14 | ¿Qué cambios haría falta en SQLite? | Sólo si se usa: `lyrics.source` (`lrclib` / `manual` / `spotify_local`), `is_synced`, y guardar **líneas con tiempos** (`start_ms`, `end_ms`) en lugar de texto plano |
| 15 | ¿Cambios en el scanner? | **Ninguno**: la letra no viene con el archivo de audio |
| 16 | ¿Cambios en el bot? | Sólo el punto de lectura de letras (caché → si no hay, fuente externa). La reproducción offline queda igual |
| 17 | ¿Rendimiento y RAM? | Caché: ~5 MB de archivos a parsear, puntual. Con LRCLIB: **2-8 KB por canción** → 3.000 canciones ≈ 6-25 MB **en disco y nada en RAM** (coincide con la idea de caché bajo demanda) |
| 18 | ¿Y cuando la letra no existe? | En la caché no hay entrada. En LRCLIB responde **HTTP 200 con `error: true`** (hay que leer el flag, no confiar en el status) → cae a `manual` o queda sin letra |

---

## 6. Comparación de fuentes de letras

| | Caché local de Spotify | Endpoint interno `color-lyrics` | **LRCLIB** | Manual |
| --- | --- | --- | --- | --- |
| Estabilidad | Baja (cambia con el cliente) | Baja (token de sesión que expira) | **Alta** | Alta |
| Cobertura | Sólo lo ya pedido (12 acá) | Todo el catálogo | Muy alta (probado con canciones del stream) | Lo que cargues |
| Autenticación | Ninguna | Cookie `sp_dc` + token del reproductor | **Ninguna** | — |
| Sincronización | Sí (`startTimeMs`) | Sí (`startTimeMs`) | Sí (LRC + `start_ms`/`end_ms`) | Según lo que cargues |
| Esfuerzo de implementación | Alto (parser de la caché de Chromium) | Medio | **Bajo** | Bajo |
| Riesgo | Frágil, se borra, sin aviso | Uso no documentado / ToS | Ninguno relevante | — |
| Dependencia de Spotify | Alta (versión, ruta, formato) | Alta (sesión activa) | **Ninguna** | Ninguna |

Muestra real de LRCLIB (probado en vivo, sin clave):

```
GET https://lrclib.net/api/get?artist_name=Mana&track_name=En%20el%20muelle%20de%20San%20Blas
→ { id, trackName, artistName, albumName, duration, instrumental:false,
    plainLyrics, syncedLyrics: "[00:25.53] Ella despidió a su amor…",
    lyricsfile: "… lines: - text: … start_ms: 25530  end_ms: 28680 …" }

GET https://lrclib.net/api/search?q=ke+personajes+un+finde
→ 12 resultados, ej.: "Un Finde | CROSSOVER #2 / Ke personajes" 169 s, synced: true
```

---

## 7. Propuesta de arquitectura (comparación, **sin implementar**)

La guía planteaba:

```
ANTES:  SQLite + lyrics externas
DESPUÉS: Spotify local lyrics → SQLite/cache → fuente externa como fallback
```

Con lo investigado, el orden conviene invertirlo:

```
AHORA:  pedido → SQLite (fuente de verdad de letras) → si falta → LRCLIB/otra fuente → guardar en SQLite
        caché local de Spotify = BONUS opcional (si está, se usa; si no, no pasa nada)
```

Motivos, en orden de peso: **estabilidad** (la caché cambia con cualquier actualización del cliente), **cobertura** (sólo letras ya pedidas), **simplicidad** (LRCLIB no necesita parser de caché ni sesión) y **mantenimiento** (nada que romperse cuando Spotify actualiza).

Piezas que tocaría cada opción, si algún día se decide:

- **SQLite:** tabla `lyrics` con `source` (`lrclib`/`manual`/`spotify_local`), `is_synced` y las líneas con `start_ms`/`end_ms`; `tracks.spotify_track_id` ya sirve como clave para consultar cualquier fuente.
- **Scanner:** sin cambios (la letra no viene con el audio).
- **Bot/reproductor:** un único punto de resolución de letras: SQLite → si no hay, fuente externa → guardar. La caché local de Spotify, si se usa, entra **antes** de la fuente externa sólo como optimización sin red, nunca como verdad.
- **RAM:** sin cambios respecto de lo planeado (metadata en RAM, letras bajo demanda desde SQLite).

---

## 8. Procedimiento reproducible

La herramienta queda en el proyecto y ya fue probada:

```bash
# Lista las letras que el cliente tiene cacheadas (con proveedor, idioma y tiempos)
node "Rulo/otros/investigar-letras-spotify.js"

# Además, cuenta claves y cuerpos por archivo (para ver el mapeo fallido texto→letra)
node "Rulo/otros/investigar-letras-spotify.js" --mapa
```

Experimento paso a paso para comprobar qué archivo cambia con cada acción:

```bash
node "Rulo/otros/investigar-letras-spotify.js" --foto antes
#  1. Cerrar Spotify por completo.
#  2. Abrir Spotify.
#  3. Poner una canción que tenga letras.
#  4. Descargarla para uso offline y esperar a que termine.
#  5. Abrir la vista de letras.
#  6. Cerrar Spotify.
node "Rulo/otros/investigar-letras-spotify.js" --foto despues
node "Rulo/otros/investigar-letras-spotify.js"          # ¿aparecieron letras nuevas?
```

La foto guarda tamaño y fecha de modificación de todos los archivos de `Browser/Cache`, `Browser/IndexedDB`, `Browser/Local Storage`, `Browser/Code Cache`, `Browser/Service Worker`, `Storage` y `Users`, y muestra **nuevos / cambiados / borrados**. Eso responde exactamente: qué archivo cambió al descargar, cuál al abrir las letras y si ese archivo contiene texto, Track ID y timestamps.

---

## 9. Qué NO se verificó

1. El experimento "antes/después" controlado con el usuario (los 12 hallazgos son de escuchas previas, no de una prueba con pasos).
2. El comportamiento del instalador clásico de Spotify (no está instalado).
3. La perdurabilidad de las entradas a través de actualizaciones del cliente y de "Borrar caché".
4. El endpoint interno con una sesión propia (no se usó ninguna credencial; se describe como lo reporta la comunidad).
5. El mapeo exacto `clave → cuerpo` de cada letra (requiere implementar el parser del índice de la caché de Chromium).

---

## 10. Nota de seguridad y límites

- No se descifró DRM ni se extrajo audio protegido.
- No se modificó ningún archivo de Spotify ni su instalación.
- No se usaron credenciales ni servicios de terceros como prueba del formato: el formato se obtuvo leyendo el disco de esta máquina.
- Todo lo hallado es **metadata y texto de letras** dentro de archivos propios del usuario.
- Las letras son **contenido licenciado** (Musixmatch): este informe documenta cómo se almacenan; el uso que se haga de ellas en el stream es responsabilidad del titular del canal.
