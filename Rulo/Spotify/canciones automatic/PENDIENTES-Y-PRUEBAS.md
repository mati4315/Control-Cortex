# Pendientes y pruebas — biblioteca musical de Rulo

**Fecha:** 19 de septiembre de 2026
**Versión del módulo: v39** (la extensión tiene que estar recargada; si el chip dice v32/v33, en `brave://extensions` → Actualizar).

**Estado verificado ahora mismo:** extensión conectada en **v37** (recargala para pasar a **v39**, que trae el arreglo final de los pedidos de artista), backend corriendo en el puerto 4000, dispositivo configurado en **`Web Player (Chrome)`** (decisión del 19-sep: se usa el Spotify del navegador, que responde siempre), biblioteca con **1 fila** (la de prueba de letras: Maná, `offline = 0`), carpeta de música **vacía**, modo automático **apagado**.
**Código:** Fases 1 a 5 completas, **674 pruebas OK** (14 archivos). Nada más que implementar en esas fases.

Este documento es la lista de lo que **falta probar en vivo** y de lo que queda **pendiente**. Los ítems están ordenados: primero lo que destraba todo, después lo opcional.

---

## 1. Lo que tenés que probar vos

### 1.1 Preparación (5 minutos)

- [ ] **Abrir el dashboard**: `http://127.0.0.1:4000/rulo-spotify.html`
  - Debería verse la sección nueva **"Biblioteca local"** arriba de "Variedad de temas".
  - *Si no aparece:* recargá con Ctrl+F5 (el navegador puede tener la página vieja en caché).
- [x] **Extensión**: en `brave://extensions` dice **v37** ✅ (verificado, conectada).
- [ ] **Pestaña del navegador**: dejá abierta (y **pinned**) la pestaña de `open.spotify.com` con música sonando. El `Web Player` **solo existe como dispositivo mientras esa pestaña está abierta y activa**; si Chrome la duerme o la cierra, el bot contesta "no aparece el dispositivo". Para que no la duerma: *Configuración → Rendimiento* → desactivar el ahorro de memoria para `open.spotify.com` (o dejar la música sonando, que ya impide que se duerma).
- [ ] Backend corriendo: si el dashboard no carga nada, arrancá tu `.bat` de siempre.

### 1.2 Biblioteca: escanear y analizar (con tus propios archivos)

Banco de pruebas que ya tenés: `D:\RADIO\enganchados` (4 audios largos, con silencios al final — ideales para ver el corte).

- [ ] En **Biblioteca local** → *Carpeta de música*: escribí `D:\RADIO\enganchados` (se guarda solo, no hay botón de guardar).
- [ ] Apretá **"Escanear carpeta"**.
  - **Debe decir**: `✔ 4 archivos: 4 nuevos, 0 actualizados, 0 adoptados, 0 sin cambios en ~300 ms`.
  - Los chips deben pasar a: Canciones 4, Con archivo 4, Sin Spotify ID 4.
- [ ] Apretá **"Escanear carpeta"** otra vez, sin tocar nada.
  - **Debe decir**: `0 nuevos … 4 sin cambios` y tardar casi nada. **Esto demuestra que no vuelve a leer los archivos que no cambiaron.**
- [ ] Apretá **"Analizar 10 (inicio/final)"**.
  - **Debe decir**: `✔ analizadas 4 de 4 (~2000 ms)`. Tarda ~0,5 s por canción.
- [ ] Verificá los resultados con este comando (te muestra los offsets que guardó):

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('D:/plugins para mi OBS/Rulo/Spotify/spotify-analytics.db');console.table(db.prepare('SELECT id,title,round(duration_ms/1000.0,1) dur,round(start_at,1) inicio,round(end_at,1) fin,analysis_status FROM tracks ORDER BY id').all())"
```

  - **Esperado**: los 4 enganchados con `fin` unos segundos antes de `dur` (por el silencio final). Los enganchados no tienen silencio al principio, así que `inicio` debería ser 0.
- [ ] **Probar el corte de verdad**: en el dashboard elegí uno de esos temas para reproducir (o pedilo por el chat) y escuchá el final.
  - **Esperado**: corta antes del silencio final, no se queda en silencio.

### 1.3 Modo automático

- [ ] Marcá **"Modo automático"** y poné la espera en **30 segundos** (para probar rápido).
- [ ] No pidas nada por el chat durante ~1 minuto.
  - **Esperado**: a los ~20-40 s arranca una canción de la biblioteca sola.
  - *Si no arranca:* revisá el log del backend — debería decir `[Automatico] encolado: <tema>`. Si dice `esperando a que termine lo que suena`, es que hay algo sonando.
- [ ] Dejá que termine esa canción.
  - **Esperado**: alrededor de **5 segundos** después de que termina (o de que se corta por el `end_at`), arranca la siguiente **sin repetir**.
- [ ] Pedile algo por el chat en medio del automático.
  - **Esperado**: suena lo pedido y el automático **espera** (vuelve el reloj de la espera). El automático nunca le pisa un pedido.
- [ ] Dejá que salgan todas las canciones del ciclo.
  - **Esperado**: cuando se agotan, **arranca un ciclo nuevo** (no se queda mudo). Se ve en el log: `se agotaron las canciones del ciclo N`.
- [ ] Revisá el historial y la ausencia de repetidos:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('D:/plugins para mi OBS/Rulo/Spotify/spotify-analytics.db');console.table(db.prepare('SELECT played_date,track_id,play_mode,cycle,played_at FROM play_history ORDER BY id DESC LIMIT 15').all())"
```

  - **Esperado**: cada `track_id` aparece **una sola vez por ciclo** en `auto`; los pedidos manuales pueden repetir.
- [ ] Cuando termines de probar, **desmarcá "Modo automático"** (así no te sorprende en medio de un stream).

> **Ojo con esto:** tu biblioteca real todavía no está cargada. Para el automático en serio necesitás apuntar la carpeta a donde tengas tus ~3.000 canciones. Con 4 enganchados va a repetir mucho (y está bien: son 4).

### 1.4 Letras (overlay en OBS)

El overlay ya pide las letras a Cortex y **LRCLIB queda como respaldo**: esto funciona sin recargar nada.

- [ ] En OBS, que la fuente de letras esté activa y poner una canción con letras (por ejemplo "En El Muelle De San Blas – Maná", que ya está cacheada).
  - **Esperado**: la primera vez tarda lo que tarda LRCLIB; la **segunda vez aparece al instante y sin internet**.
- [ ] Verificá cuántas quedaron guardadas:

```bash
curl -s "http://127.0.0.1:4000/api/letras-estado"
```

  - **Esperado**: `{"guardadas": N, "porFuente": {"lrclib": N}}` y el `kb`.
- [ ] Probá una canción **sin letras** conocida (o instrumental).
  - **Esperado**: dice `Sin letras` o `🎸 Instrumental`, sin errores en pantalla, y **no** vuelve a consultar por esa canción.
- [ ] Probá con **internet cortado** (desconectá el WiFi un momento) con una canción ya cacheada.
  - **Esperado**: la letra se sigue viendo (sale de SQLite). Con una **no** cacheada, se queda sin letras pero la música sigue.

### 1.5 Que no se rompió nada (regresión)

- [ ] Un pedido normal por el chat sigue funcionando (y responde con tu vocabulario).
- [ ] La **variedad por artista**: "pasame otro tema de Ke Personajes" dos veces → temas distintos.
- [ ] Los comandos del dashboard: probar un tema, simular un comentario, pausa/siguiente.
- [ ] Las tres páginas abren: dashboard, entrenamiento y Bot/Rulo.
- [ ] El **respaldo de SSN** sigue funcionando (`SSN 1 - Estado.bat`).

---

## 2. Pendientes de infraestructura (no dependen del código)

- [x] **Recordatorio de los lunes.** ✅ **HECHO (19-sep)**: el gateway quedó instalado como **tarea programada de Windows** (`Hermes_Gateway`, arranca solo al iniciar sesión) y **corriendo ahora mismo**. El trabajo `Rulo - recordatorio de analisis` (lunes 10:00, `Control Cortex/tools/recordatorio-analisis.py`) ya dispara solo.

```bash
hermes gateway install     # queda arrancando solo al iniciar sesión (una vez)
# o, si lo querés sólo ahora:
hermes gateway run
```

- [x] **Default global del modelo.** ✅ **HECHO (19-sep)**: quedó en `deepseek-flash` con proveedor `deepseek` (antes apuntaba a un Gemini que devolvía HTTP 404, y por eso cualquier tarea nueva sin modelo fijo se caía). Verificado con `hermes config get model.default`. Los comandos quedan por si alguna vez hay que repetirlo:

```bash
hermes config set model.default deepseek-flash
hermes config set model.provider deepseek
```

- [x] **Subir a GitHub.** ✅ **HECHO (19-sep)**: commit **`8e23316`** (27 archivos: biblioteca, tests, guía, informe, herramienta de diagnóstico y los arreglos del bot) ya está en `mati4315/Control-Cortex---rulo-spotify` y verificado contra la API de GitHub.
  - Recordá: **la base `spotify-analytics.db` no se sube** (tiene comentarios y nombres del chat) — ya está excluida.

---

### Privacidad: el subidor tenía un agujero (cerrado el 19-sep)

Antes de subir, el `--estado` mostró que iba a publicar **`Spotify/spotify-analytics.db.backup-2026-09-19T02-27-39-036`**:
un backup de la base con los comentarios y nombres del chat. Las exclusiones listaban el archivo, `-wal` y `-shm`
**por nombre exacto**, así que cualquier variante con fecha se colaba.

Dos arreglos, en `Control Cortex/tools/subir-rulo.js`:

1. La exclusión ahora es un **comodín**: `Spotify/spotify-analytics.db*` cubre la base y todo lo que se derive
   (backups, `-wal`, `-shm`).
2. **El clon temporal se limpia antes de copiar** (`git reset --hard` + `git clean -fdx`). Antes, un archivo
   excluido en una corrida vieja quedaba *staged* y se subía igual aunque ya no correspondiera.

Verificado: la lista de subida ya no lo incluye, el escaneo de secretos no encontró nada, y **la API de GitHub
confirma que el repo no tiene ningún archivo de la base**.

## 3. Fase 6 (letras de la caché de Spotify) — puerta de entrada

Hoy está **apagada a propósito**. Para activarla hay que cerrar dos cosas:

- [ ] **(a) Experimento controlado.** Con Spotify **cerrado por completo**:

```bash
node "Rulo/otros/investigar-letras-spotify.js" --foto antes
#  1. abrí Spotify
#  2. poné una canción descargada (que diga "Descargada")
#  3. abrí las letras de esa canción
#  4. cerrá Spotify
node "Rulo/otros/investigar-letras-spotify.js" --foto despues
node "Rulo/otros/investigar-letras-spotify.js"          # ¿apareció una letra nueva?
```

  - **Qué anotar**: ¿se creó/modificó un archivo al abrir las letras? ¿aparece una letra nueva en la lista? ¿queda con Spotify cerrado?
  - Con eso se sabe si las entradas son **vivas** o restos. Hoy veo 12 letras completas (LINE_SYNCED, Musixmatch) en `LocalCache\Spotify\Browser\Cache\Cache_Data\`, pero **no** está probado que se creen en el momento de mirar las letras.

- [ ] **(b) Lector del índice de la caché.** Es la parte pesada: las claves (con el Track ID) están en `data_1` y los cuerpos en `data_2`/`data_3`, así que hay que interpretar el índice de la caché de Chromium para unirlos sin adivinar. Va aislado (`leer-cache-spotify.js`), devuelve `null` ante cualquier problema y con **validación por duración** para no mostrar la letra de otra versión.

**Recordatorio importante:** el audio descargado de Spotify (carpeta `LocalState\Spotify\Storage`, 131,8 MB hoy) está **cifrado** — ffmpeg no lo puede leer y no hay forma de usarlo como biblioteca. La biblioteca local son **tus propios archivos**.

---

## 4. Fase 7 (reproductor local) — decisión pendiente

Hoy la biblioteca reproduce **por Spotify** con sus offsets (es lo que quedó implementado y probado). Si algún día querés que suene el archivo local, hay que elegir:

| Opción | Ventaja | Costo |
|---|---|---|
| A (actual) | No toca nada del pipeline que ya funciona | No hay ahorro de ancho de banda |
| B · mpv/VLC por consola | Reproducción local real | Hay que crear un canal de estado nuevo para el overlay |
| C · página propia con `<audio>` en OBS | Todo dentro de Cortex | Fuente nueva en OBS y que el overlay acepte dos orígenes |

**No hay que decidirlo hoy**: la opción A ya da el beneficio del `start_at`/`end_at` y del "no repetir".

---

## 5. Cosas que no pude verificar yo (y conviene mirar)

| Qué | Por qué quedó abierto | Cómo se comprueba |
|---|---|---|
| Reproducción real en el dispositivo | Necesita tu Brave + Spotify abiertos con audio | Los ítems del §1.2 y §1.3 |
| Umbrales del análisis en cumbias reales | Sólo lo medí en 4 enganchados y en audios de prueba | §1.2: si un `start_at`/`end_at` queda raro, se ajusta a mano (pasa a `manual`) o se reanaliza |
| El overlay dentro de OBS | No puedo ver tu escena | §1.4 |
| El overlay con LRCLIB caído | Sólo probé el camino normal | §1.4 con internet cortado |
| La caché de Spotify como fuente | Falta el experimento del §3 | §3 |

**Si algo falla, lo primero que hay que mirar:**

```bash
# resumen completo del sistema de música
curl -s http://127.0.0.1:4000/api/biblioteca

# últimas líneas del backend (dónde quedan los avisos [Biblioteca], [Automatico], [Letras])
node -e "console.log('log del backend: ' + process.env.LOCALAPPDATA + '/Temp/cortex-backend.log')"
```

---

## 5.bis Problemas conocidos y cómo se resuelven (19-sep-2026)

### "El bot intenta pero no cambia el tema" → revisá el DISPOSITIVO

**Qué pasó:** el dispositivo objetivo estaba en **`Web Player (Chrome)`**, que **no existe** si no hay una pestaña de
`open.spotify.com` abierta. Cada pedido terminaba en:

```text
El dispositivo "Web Player (Chrome)" no aparece: manda !spotifydevices
No encuentro el dispositivo configurado "Web Player (Chrome)".
```

**Cómo se arregla:** dashboard → campo **Dispositivo** → poner el nombre real (el que aparece con
`!spotifydevices` o en el dashboard). En esta PC el que existe es **`NOTEBOOK-MATI`** (la app de la Store).
El "Web Player" sólo sirve si dejás Chrome con la web de Spotify abierta y **sin dormir** (Brave/Chrome
suspenden las pestañas de fondo). Ya quedó configurado en `NOTEBOOK-MATI` y una prueba real funcionó.

**Cómo darse cuenta:** en el registro del dashboard, los pedidos fallan con "no aparece" o "no encuentro el
dispositivo". No es un problema del bot: es que le estamos diciendo a otro dispositivo que no está.

### "La app de Spotify se congela" → puede ser el cambio de carpeta de descargas

**Qué pasó:** hoy a las **16:12** se cambió la **ubicación de almacenamiento sin conexión** de Spotify a:

```text
D:\RADIO\TEMAS Spotify
```

Spotify **migró ahí sus 133 MB de canciones descargadas** (la carpeta vieja de C: quedó en 0 bytes). Esa
migración vuelve pesada/inestable a la app de la Store mientras trabaja, y mientras está ocupada también
puede fallar el "traspaso de dispositivo" de la API (el bot no logra activar la PC).

**Qué hacer:** dejarlo terminar (no volver a cambiar la ubicación, porque reinicia la migración), y si sigue
trabada: cerrar Spotify por completo y volver a abrirlo. Se ve en **Spotify → Ajustes → Almacenamiento**.

### OJO: esa carpeta NO es tu biblioteca de música

`D:\RADIO\TEMAS Spotify` es **la caché interna de Spotify**: subcarpetas con nombre de hash (`01/`, `05/`…),
archivos `.file` **cifrados** y un `index.dat`. **No sirve como biblioteca** (y Spotify la reescribe sola).

- La biblioteca de Rulo tiene que ser **una carpeta propia con tus archivos** (`.mp3`, `.m4a`, `.flac`, `.wav`, `.ogg`).
- El scanner **ignora** los `.file` de Spotify (sólo mira extensiones de audio), así que aunque apuntaras la
  carpeta ahí no rompería nada — pero sería un lío: mezclaría tu música con la caché de Spotify.

### "El bot dice que no encuentra el tema" pero el tema SI existe

**Qué pasaba:** Spotify **limita las búsquedas seguidas** (HTTP 429). Cuando eso pasaba, el bot recibía una
respuesta vacía y contestaba "no aparece ni a palos" — una mentira: el artista existía, Spotify nos estaba
frenando. En la última hora hubo 10 pedidos reales así (`artist:amar azul`, `artist:damas gratis`,
`artist:polaco`), todos con el tema disponible.

**Cómo se arregló (v34):** el bot ahora detecta el frenazo, respeta el `Retry-After` que manda Spotify,
**no insiste** mientras dura y contesta otra cosa:

```text
Spotify me esta frenando {nombre}: proba de nuevo en {segundos}s.
```

En la base quedan con estado **`throttled`** (no como "no encontrada"), así no ensucian las estadísticas.
Las variantes se editan como datos en la pestaña **Bot / Rulo**.

### "La app se congela y el bot se queda trabado"

**Qué pasaba:** todas las consultas a Spotify se hacían **sin límite de tiempo**. Si la app (o la red)
no contestaba, esa consulta quedaba esperando para siempre → el bot quedaba marcado como "ocupado" y
**todos los pedidos siguientes respondían "Pará la mano, estoy con otro pedido"**. Los 13 `busy` de esa
hora son eso.

**Cómo se arregló (v34):** toda consulta tiene tope de **12 s**. Si no hay respuesta, el bot avisa:

```text
Spotify no me respondió (parece colgada la app): probá de nuevo en unos segundos.
```

Queda con estado **`no_response`** en la base y **el bot nunca se traba**.

### "Pausa y Reanudar no funcionan, pero Siguiente y Anterior sí"

**Qué pasaba:** esos cuatro botones no usan el mismo código. *Siguiente* y *Anterior* los manda el código de
SocialStream (`POST /v1/me/player/next` y `/previous`) y funcionan. *Pausa* y *Reanudar* los mandaba el mismo
código pero con `PUT /v1/me/player/pause` y `/play` **sin indicar el dispositivo**.

La pista la dio el propio registro: a las **17:19:59 la pausa funcionó** (`paused`) y a partir de ahí todas
fallaron. Es el comportamiento clásico de Spotify: **cuando la reproducción se pausa (o queda quieta), el
dispositivo deja de estar "activo"**, y los comandos que no indican `device_id` empiezan a responder 404
"No active device found". Con *Siguiente/Anterior* no pasa porque no dependen de eso.

**Cómo se arregló (v35):** pausa y reanudar ahora los maneja el módulo de Rulo, indicando **siempre el
dispositivo**, y si no alcanza prueba en orden:

1. `PUT /me/player/pause|play?device_id=NOTEBOOK-MATI` (reanudar con cuerpo `{}`)
2. lo mismo sin cuerpo
3. igual que SocialStream (sin indicar dispositivo)
4. traspasando el audio a la PC primero (al reanudar arranca; al pausar **no** arranca nada)

Si las cuatro fallan, **el registro guarda el motivo real** (`HTTP 403 {...}`, etc.), así la próxima vez no
hay que adivinar. *Siguiente* y *Anterior* siguen igual porque funcionan.

**Lo mismo aplica a "Reproducir ahora" (v36):** el pedido de un tema usaba `device_id` pero **no traspasaba el
audio a la PC** cuando el dispositivo había quedado inactivo (justo lo que pasa después de pausar). Ahora:

1. si el dispositivo está inactivo, **traspasa el audio a la PC sin arrancar** (`play:false`);
2. reproduce indicando el dispositivo (y si no, sin indicarlo);
3. confirma que quedó sonando el tema pedido y, si todo falla, **guarda el motivo HTTP real** en el registro.

En la base, el estado de un tema que no se pudo reproducir ahora viene con el detalle técnico (`| HTTP 404
{...}`), para no adivinar.

### El 403 "Restriction violated" NO es un error: significa "ya estaba así"

Si en el registro aparece:

```text
HTTP 403 {"error":{"status":403,"message":"Player command failed: Restriction violated","reason":"UNKNOWN"}}
```

**no es un fallo de la app ni del bot.** Spotify devuelve ese 403 cuando el reproductor **ya está en el estado
que le pedís**:

| Le pedís | Y ya estaba | Resultado |
| --- | --- | --- |
| Pausar | pausado | 403 Restriction violated |
| Reanudar | sonando | 403 Restriction violated |
| Siguiente/Anterior | sin tema al que saltar | 403 Restriction violated |

Está documentado como comportamiento esperado (el proyecto *spojure* lo trata igual: "this error is ignored").
Lo correcto es **confirmar el estado y darlo por hecho**.

**Cómo se arregló (v37):** cuando Spotify contesta ese 403, el bot **consulta el estado real** y:

- si coincide con lo pedido (pausar y ya está pausado, o reanudar y ya está sonando) → **éxito**, y el botón
  deja de mostrar la ✖;
- si NO coincide, sigue siendo un fallo y **queda el motivo con el 403 en el registro** (por si algún día es
  una restricción de verdad).

Lo mismo en la reproducción: si pedís un tema que **ya está sonando** y Spotify contesta 403, se confirma el
estado y se da por hecho.

### "Un tema de X" traía un tema de OTRO artista (o decía que no existía)

**Qué pasaba (20:29, reproducido):** el pedido `un tema del polaco` se convertía en la búsqueda
`artist:polaco`, y Spotify **no usa ese campo como filtro**: es una búsqueda por palabras. Resultado real:

| Pedido | Búsqueda que mandaba | Qué devolvía |
| --- | --- | --- |
| un tema **del polaco** | `artist:polaco` | ✗ **Beautiful - Tan Bionica** (nada que ver), o "no está en Spotify" |
| un tema **de el polaco** | `artist:el polaco` | ✓ Vengo de la casa de ella - **El Polaco** |
| un tema de ke personajes | `artist:ke personajes` | ✓ (funcionaba porque el nombre coincide entero) |

O sea: **el nombre real del artista lleva el artículo** ("El Polaco") y sin él Spotify devuelve cualquier cosa,
y el bot **no revisaba que el resultado fuera de ese artista** — elegía lo que viniera.

**Cómo se arregló (v38):** cuando el pedido es de un artista, el bot ahora:

1. **Resuelve el nombre real** con una búsqueda de artistas (`type=artist`): `polaco` → **`El Polaco`**;
2. busca los temas con el **nombre completo** (`artist:"El Polaco"`);
3. **descarta todo lo que no sea de ese artista** (por eso la basura ya no puede salir);
4. guarda la bolsa de variedad con el **nombre resuelto**, así "del polaco" y "de el polaco" comparten la
   misma bolsa y sigue habiendo variedad.

Si el artista no se puede resolver, sigue el camino de siempre: **nada de lo que ya funcionaba se rompió**.
Las pruebas cubren el caso exacto reportado (que elija a El Polaco y **nunca** a Tan Bionica) y que el camino
viejo siga andando cuando no hay resolución.

### OJO con "Simular un comentario del chat"

Ese cuadro espera **solo el comentario**, como si lo hubiera escrito alguien:

```text
quiero un tema de ke personajes
```

Si pegás el texto copiado del panel del historial (que incluye "Matias Moreira comentó facebook 08:39:58 p. m.
… Rulo responde …"), el bot lo lee como un comentario gigante y contesta "no encontré ese tema" — **no es un
fallo, es que le llegó basura**. Verificado en la base: el comentario que entró era exactamente ese texto
pegado, y el bot buscó `track:en spotify. artist:ke personajes…`.

### El arreglo de los pedidos de artista, segunda vuelta (v39)

La v38 (resolver el nombre real + filtrar) **no alcanzó**: seguía devolviendo `Beautiful - Tan Bionica` para
"un tema del polaco". La razón, encontrada en los datos: **el resultado de la búsqueda de artistas se
cacheaba aunque hubiera fallado**. Un error transitorio de Spotify (429, 5xx, corte) dejaba esa búsqueda
"no resuelta" **para toda la sesión**, así que el bot volvía al camino viejo (que devuelve cualquier cosa).

La v39 lo hace bien:

1. **No se cachea un fallo**: si la búsqueda de artistas no responde, el próximo pedido la reintenta.
2. **Se usa el catálogo real del artista** (`/v1/artists/<id>/top-tracks`), que es lo que Spotify conoce de
   él; la búsqueda por nombre queda como respaldo.
3. **Red de seguridad**: si lo que devuelve Spotify no es de ese artista, **no se reproduce** — mejor decir
   "no encontré" que poner una canción que nadie pidió (antes salía Tan Bionica para el Polaco).
4. Cada paso queda en el log de la extensión (`artistas para "polaco": ...`, `catálogo de El Polaco: N temas`).

### Los estados en la base (para leer el historial de un vistazo)

| Estado | Significa |
| --- | --- |
| `played` | Se reprodujo ✓ |
| `no_device` | El dispositivo configurado no existe (poné el nombre real) |
| `throttled` | Spotify nos frenó por consultar de más (se recupera solo) |
| `no_response` | Spotify o la app no contestaron (se recuperó sin trabas) |
| `busy` | Había otro pedido en curso |
| `notfound` | No lo encontró de verdad |
| `wait_user` / `wait_global` | Esperas configuradas |
| `skipped` / `paused` | La gente lo saltó o lo pausó (señal de si gustó) |

**Qué pasó con la app de la Store:** se le cambió la carpeta de descargas a las 16:12 y Spotify **migró ahí
sus 133 MB** (la carpeta vieja de C: quedó en 0 bytes). Mientras migra, la app queda pesada. Hoy se verificó
que **no se está colgando**: sin eventos de cuelgue en Windows, la app responde, CPU 0 % y **14 temas se
reprodujeron** en hora y media. Lo que fallaba eran las tres cosas de arriba.

### Herramienta de diagnóstico (doble clic)

En esta misma carpeta: **`Diagnostico Spotify.bat`** (corre `diagnostico-spotify.ps1`). Solo lee y te dice,
en 10 segundos:

- si la app de Spotify está viva (responde) o colgada, y cuánta CPU está usando;
- **en qué carpeta está guardando Spotify** (según su propio archivo de preferencias);
- si Windows registró cuelgues de Spotify en las últimas 8 horas;
- si el bot está conectado, qué versión reporta la extensión, los últimos pedidos y **qué dispositivo hay
  disponible contra el configurado** (el error más común).

Salida real de hoy:

```text
=== La app de Spotify ===
  Todos los procesos responden (la app esta viva).
  CPU en 3 s: 0,0 %
  Version instalada (Microsoft Store): 1.300.277.0
=== Carpeta donde Spotify guarda sus descargas ===
  storage.location = D:\RADIO\TEMAS Spotify
=== Cuelgues / errores de Spotify en Windows (ultimas 8 horas) ===
  ninguno (si la app "se congela" y no hay eventos, no es un cuelgue real)
=== El bot ===
  Extension conectada: True | version que reporta: 32      <- tiene que decir 34
  Dispositivos: NOTEBOOK-MATI (activo) | Web Player (Chrome)
  Dispositivo configurado: NOTEBOOK-MATI  <- correcto
```

## 6. Comandos de referencia

```bash
# todas las pruebas (14 archivos)
cd "Rulo/tests" && npm test

# sólo las de la biblioteca (scanner, análisis, letras, automático)
cd "Rulo/tests" && npm run test:biblioteca

# esquema sobre una base temporal + mediciones (no toca tus datos)
node "Rulo/Spotify/canciones automatic/probar-esquema.js"

# aplicar el esquema si alguna vez hace falta (hace backup antes)
node "Rulo/Spotify/canciones automatic/aplicar-esquema.js"

# verificar sintaxis después de tocar backend o módulo
node --check "Control Cortex/backend/server.js"
node --check "Control Cortex/integrations/spotify-auto-music/spotify-auto-music.js"

# investigación de las letras de Spotify (Fase 6)
node "Rulo/otros/investigar-letras-spotify.js"
```

### Ajustes nuevos (dashboard → se guardan solos)

| Ajuste | Para qué | Valor actual |
|---|---|---|
| `musicLibraryPath` | Carpeta de la biblioteca local | vacío |
| `autoBiblioteca` | Modo automático | apagado |
| `autoEsperaSegundos` | Silencio antes de arrancar solo | 240 |
| `spotifyLocalLyrics` | Leer letras de la caché de Spotify (Fase 6) | apagado |

---

## 7. Lo que ya está hecho (para no volver a hacerlo)

- **Fase 1:** base única (`Rulo\Spotify\spotify-analytics.db`) con las tablas de biblioteca, letras, historial y trabajos + migraciones automáticas. Backup antes de aplicar.
- **Fase 2:** scanner con ffprobe, detección de cambios por tamaño/fecha, adopción de fichas y completado de Track IDs con el historial del chat.
- **Fase 3:** análisis de `start_at`/`end_at` con ffmpeg (sólo los bordes de 15 s), cola con reintentos, override manual y detalle crudo guardado.
- **Fase 4:** modo automático con ciclo diario, planificador y **módulo v32** que reproduce por URI aplicando los offsets y avisando cuando corta.
- **Fase 5:** letras con caché en SQLite (LRCLIB como fuente externa) y el overlay pidiendo a Cortex con respaldo directo.
- **Extras:** sección "Biblioteca local" en el dashboard, 10 endpoints nuevos, 4 ajustes nuevos, y los informes `GUIA-RULO-SPOTIFY.md`, `ENTREGA-FASES-2-A-5.md` e `investigacion-letras-spotify.md`.
