# Guia tecnica: auto seleccion de musica desde el chat

> Esta guia toma como referencia el estado actual de `SPOTIFY-SETUP-GUIDE.md` y de la integracion existente de SocialStream Ninja con Spotify. La solicitud nueva es permitir que una persona escriba mensajes naturales como "quiero un tema de Damas Gratis" o "quiero la musica de Amar Azul, el tema Yo Tomo Licor" y que el sistema detecte el pedido, busque la cancion y cambie automaticamente a ese tema, respetando una espera de unos 40 segundos por pedido.

---

## 1. Objetivo

Crear una capa de auto seleccion que escuche los mensajes del chat, detecte pedidos de musica sin depender solamente de comandos como `!sr`, y controle Spotify de forma segura:

1. Entender pedidos naturales del chat.
2. Extraer artista y/o titulo de la cancion.
3. Buscar el mejor resultado en Spotify.
4. Reproducir el tema automaticamente.
5. Bloquear nuevos cambios durante 40 segundos para evitar saltos constantes.
6. Mantener el sistema liviano y estable para streaming.

---

## 2. Estado actual del sistema

El sistema ya tiene una base fuerte:

- SocialStream Ninja lee chats multicadena.
- `SocialStream Ninja/spotify.js` ya maneja autenticacion OAuth con Spotify.
- La integracion ya incluye scopes de reproduccion:
  - `user-read-currently-playing`
  - `user-read-playback-state`
  - `user-modify-playback-state`
- `spotify.js` ya puede:
  - buscar tracks en Spotify con `/v1/search`
  - agregar temas a cola con `/v1/me/player/queue`
  - saltar, pausar, reproducir y cambiar volumen
  - procesar comandos como `!song`, `!sr`, `!queue`, `!skip`, `!revoke`
- Control Cortex sirve overlays de SSN en `/ssn` y controla servicios con PM2.

Lo que falta para este pedido no es rehacer Spotify desde cero, sino agregar una capa optimizada encima de lo existente.

---

## 3. Decision recomendada

La mejor opcion es implementar la auto seleccion dentro de `SocialStream Ninja/spotify.js`, cerca de `handleCommand()`, reutilizando el access token, `refreshAccessToken()`, `parsePlaybackError()` y la logica de busqueda existente.

Recomendacion:

- Mantener `!sr` y `!queue` como cola tradicional.
- Crear una funcion nueva para pedidos naturales: `handleNaturalSongRequest(message, data)`.
- Crear una funcion nueva para reproduccion inmediata controlada: `playTrackNow(query, requesterData)`.
- Aplicar cooldown global de 40 segundos.
- Opcionalmente aplicar cooldown por usuario para evitar abuso.
- Permitir bypass a moderadores/admins si hace falta.

Esto evita crear otro microservicio, evita duplicar OAuth y usa la conexion Spotify ya probada.

---

## 4. Frases que debe entender

El detector debe aceptar mensajes como:

```text
quiero un tema de Damas Gratis
quiero musica de Amar Azul
quiero la musica de Amar Azul el tema Yo Tomo Licor
poneme Yo Tomo Licor de Amar Azul
pon Amar Azul Yo Tomo Licor
pasate un tema de Rafaga
me pones una cancion de Los Palmeras
quiero escuchar No Te Creas Tan Importante de Damas Gratis
```

Tambien se recomienda aceptar comandos explicitos para cuando el detector natural falle:

```text
!playnow Yo Tomo Licor Amar Azul
!tema Damas Gratis
!musica Amar Azul Yo Tomo Licor
!spotifydevices
```

---

## 5. Reglas de interpretacion

La deteccion debe ser conservadora para no cambiar la musica por mensajes casuales.

Aceptar solo si el texto contiene una intencion musical clara:

```text
quiero
pon
poneme
pone
pasate
me pones
quiero escuchar
quiero musica
quiero un tema
```

Y ademas contiene una pista musical:

```text
tema
musica
cancion
track
de <artista>
el tema <titulo>
```

Rechazar mensajes demasiado cortos o ambiguos:

```text
musica
pon algo
quiero tema
ese tema
```

Minimo recomendado:

- 3 palabras utiles despues de limpiar el mensaje, o
- artista conocido + intencion clara, o
- titulo + artista.

---

## 6. Normalizacion del texto

Antes de interpretar el mensaje:

1. Pasar a minusculas.
2. Quitar tildes.
3. Quitar emojis.
4. Quitar signos repetidos.
5. Reemplazar espacios multiples por uno.
6. Quitar comillas alrededor del titulo.
7. Ignorar URLs.

Ejemplo:

```text
"quiero la musica de Amar Azul el tema **Yo Tomo Licor**"
```

queda como:

```text
quiero la musica de amar azul el tema yo tomo licor
```

---

## 7. Extraccion de artista y titulo

Orden recomendado de patrones:

### Patron A: artista + titulo claro

```text
quiero la musica de Amar Azul el tema Yo Tomo Licor
```

Extraer:

```json
{
  "artist": "Amar Azul",
  "title": "Yo Tomo Licor",
  "query": "track:Yo Tomo Licor artist:Amar Azul"
}
```

### Patron B: titulo + artista

```text
poneme Yo Tomo Licor de Amar Azul
```

Extraer:

```json
{
  "artist": "Amar Azul",
  "title": "Yo Tomo Licor",
  "query": "track:Yo Tomo Licor artist:Amar Azul"
}
```

### Patron C: solo artista

```text
quiero un tema de Damas Gratis
```

Extraer:

```json
{
  "artist": "Damas Gratis",
  "title": "",
  "query": "artist:Damas Gratis"
}
```

Si el usuario pide solo artista, Spotify va a devolver el tema mas relevante/popular de ese artista. Es simple y rapido, aunque no siempre sera el tema exacto que el usuario imaginaba.

---

## 8. Cooldown de 40 segundos

Debe existir un cooldown global para que el stream no salte de tema todo el tiempo.

Regla base:

- Si se acepta un pedido y se ejecuta `playTrackNow`, guardar `lastAutoPlayAt = Date.now()`.
- Durante los siguientes 40 segundos, ignorar pedidos nuevos o responder que falta esperar.
- Mods/admins pueden tener permiso para saltarse el cooldown si se desea.

Mensajes sugeridos:

```text
Reproduciendo: Yo Tomo Licor - Amar Azul
Espera 23s para pedir otro tema.
No encontre ese tema en Spotify.
```

Para optimizar, no llamar a Spotify si el cooldown sigue activo. Primero validar cooldown, despues buscar.

---

## 9. Reproduccion inmediata

Para cambiar automaticamente al tema pedido se usa:

```http
PUT https://api.spotify.com/v1/me/player/play
```

Payload:

```json
{
  "uris": ["spotify:track:TRACK_ID"]
}
```

Flujo:

1. Validar que Spotify este conectado.
2. Validar cooldown.
3. Parsear mensaje.
4. Buscar track en Spotify.
5. Ejecutar `/me/player/play`.
6. Publicar respuesta al chat/overlay.
7. Actualizar `lastAutoPlayAt`.

Importante: Spotify necesita un dispositivo activo. Si no hay uno, abrir Spotify en la PC y reproducir cualquier cancion manualmente una vez.

---

## 10. Pseudocodigo recomendado

Agregar propiedades al constructor de `SpotifyIntegration`:

```js
this.autoMusicCooldownMs = 40000;
this.lastAutoMusicRequestAt = 0;
this.autoMusicEnabled = false;
```

Funcion de cooldown:

```js
canAcceptAutoMusicRequest(data = {}) {
  const now = Date.now();
  const bypass = data.host || data.admin || data.mod;
  const remaining = this.autoMusicCooldownMs - (now - this.lastAutoMusicRequestAt);

  if (!bypass && remaining > 0) {
    return {
      ok: false,
      message: `Espera ${Math.ceil(remaining / 1000)}s para pedir otro tema.`
    };
  }

  return { ok: true };
}
```

Funcion para detectar pedidos naturales:

```js
parseNaturalMusicRequest(message) {
  const original = String(message || '').trim();
  const text = original
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s"!'.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length < 12) return null;

  const hasIntent = /\b(quiero|pon|pone|poneme|pasate|me pones|quiero escuchar)\b/.test(text);
  const hasMusicWord = /\b(tema|musica|cancion|track)\b/.test(text);
  if (!hasIntent || !hasMusicWord) return null;

  let match = text.match(/\bde\s+(.+?)\s+(?:el\s+)?tema\s+(.+)$/);
  if (match) {
    return {
      artist: match[1].trim(),
      title: match[2].trim(),
      query: `track:${match[2].trim()} artist:${match[1].trim()}`
    };
  }

  match = text.match(/\b(?:pon|pone|poneme|quiero escuchar)\s+(.+?)\s+de\s+(.+)$/);
  if (match) {
    return {
      artist: match[2].trim(),
      title: match[1].trim(),
      query: `track:${match[1].trim()} artist:${match[2].trim()}`
    };
  }

  match = text.match(/\b(?:tema|musica|cancion)\s+de\s+(.+)$/);
  if (match) {
    return {
      artist: match[1].trim(),
      title: '',
      query: `artist:${match[1].trim()}`
    };
  }

  return null;
}
```

Funcion para reproducir:

```js
async playTrackNow(query) {
  if (!this.accessToken) {
    return { success: false, message: 'Spotify no esta conectado.' };
  }

  const searchResponse = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=3`,
    { headers: { Authorization: `Bearer ${this.accessToken}` } }
  );

  if (searchResponse.status === 401) {
    await this.refreshAccessToken();
    return this.playTrackNow(query);
  }

  const searchData = await searchResponse.json();
  const track = searchData?.tracks?.items?.[0];
  if (!track) {
    return { success: false, message: 'No encontre ese tema en Spotify.' };
  }

  const playResponse = await fetch('https://api.spotify.com/v1/me/player/play', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ uris: [track.uri] })
  });

  if (playResponse.status === 204 || playResponse.ok) {
    this.lastAutoMusicRequestAt = Date.now();
    return {
      success: true,
      message: `Reproduciendo: ${track.name} - ${track.artists.map(a => a.name).join(', ')}`
    };
  }

  if (playResponse.status === 404) {
    return {
      success: false,
      message: 'No hay dispositivo activo. Abri Spotify y reproduce algo manualmente primero.'
    };
  }

  const message = await this.parsePlaybackError(playResponse, 'No pude cambiar el tema');
  return { success: false, message };
}
```

Funcion principal:

```js
async handleNaturalSongRequest(message, data = {}) {
  if (!this.settings?.spotifyAutoMusicRequests) return null;

  const parsed = this.parseNaturalMusicRequest(message);
  if (!parsed) return null;

  const cooldown = this.canAcceptAutoMusicRequest(data);
  if (!cooldown.ok) return cooldown.message;

  const result = await this.playTrackNow(parsed.query);
  return result.message;
}
```

---

## 11. Donde engancharlo

En el flujo que recibe mensajes de chat, antes o despues de `handleCommand()`, llamar:

```js
const autoMusicResponse = await spotifyIntegration.handleNaturalSongRequest(data.chatmessage, data);
if (autoMusicResponse) {
  // Enviar respuesta al chat si el sistema ya tiene callback configurado.
}
```

Orden recomendado:

1. Procesar comandos explicitos (`!sr`, `!playnow`, `!skip`).
2. Si no era comando, probar pedido natural.
3. Si no detecta pedido musical, no hacer nada.

Asi se evita que un mensaje normal dispare Spotify por accidente.

---

## 12. Opcion de comando directo `!playnow`

Ademas del lenguaje natural, conviene agregar un comando directo:

```text
!playnow Yo Tomo Licor Amar Azul
```

En `getCommandPermissions()`:

```js
'!playnow': ['anyone']
```

En `getCustomTriggers()` agregar:

```js
'!playnow'
```

En `handleCommand()`:

```js
if (cmd === '!playnow') {
  if (!this.hasPermission(data, permissions['!playnow'])) return null;
  if (!args) return 'Uso: !playnow <tema o artista>';

  const cooldown = this.canAcceptAutoMusicRequest(data);
  if (!cooldown.ok) return cooldown.message;

  const result = await this.playTrackNow(args);
  return result.message;
}
```

---

## 13. Optimizacion y seguridad

Para que funcione fluido en vivo:

- Revisar cooldown antes de llamar a Spotify.
- Cachear busquedas repetidas durante 5 a 10 minutos.
- Limitar a `limit=3` en `/v1/search`; no hace falta pedir 20 resultados.
- Ignorar mensajes de bots.
- Ignorar mensajes con URLs.
- No reproducir si el mensaje tiene insultos/palabras bloqueadas.
- Limitar por usuario: por ejemplo 1 pedido cada 2 minutos.
- Permitir a mods usar `!skip`.
- Registrar en consola quien pidio cada tema.

Cache sugerida:

```js
this.autoMusicSearchCache = new Map();
```

Clave:

```js
query.toLowerCase()
```

Valor:

```js
{ track, expiresAt: Date.now() + 10 * 60 * 1000 }
```

---

## 14. Configuracion recomendada

Agregar un setting booleano:

```js
spotifyAutoMusicRequests: false
```

Agregar otro para cooldown:

```js
spotifyAutoMusicCooldownSeconds: 40
```

Valores recomendados:

```json
{
  "spotifyAutoMusicRequests": true,
  "spotifyAutoMusicCooldownSeconds": 40,
  "spotifyAutoMusicUserCooldownSeconds": 120,
  "spotifyAutoMusicDeviceName": "OBS",
  "spotifyManagedQueue": true
}
```

`spotifyAutoMusicDeviceName` es opcional. Sirve cuando la app de Spotify que debe sonar esta en otra PC, por ejemplo la PC de OBS. Para saber el nombre exacto, escribir `!spotifydevices` en el chat y copiar una parte reconocible del nombre.

Si el stream es grande, mejor usar cola (`!sr`) en vez de reproduccion inmediata para todos. La reproduccion inmediata es divertida, pero debe estar controlada.

---

## 15. Pruebas manuales

Probar con Spotify abierto y reproduciendo algo:

```text
quiero un tema de Damas Gratis
```

Resultado esperado:

- Busca Damas Gratis.
- Reproduce el primer tema relevante.
- Responde que esta reproduciendo.
- Activa cooldown de 40 segundos.

Luego probar antes de los 40 segundos:

```text
quiero la musica de Amar Azul el tema Yo Tomo Licor
```

Resultado esperado:

- No busca en Spotify.
- Responde que hay que esperar X segundos.

Despues de 40 segundos:

```text
quiero la musica de Amar Azul el tema Yo Tomo Licor
```

Resultado esperado:

- Busca `track:Yo Tomo Licor artist:Amar Azul`.
- Cambia automaticamente a ese tema.

---

## 16. Resumen final para implementar

Archivos principales:

- `D:\plugins para mi OBS\SocialStream Ninja\spotify.js`
- `D:\plugins para mi OBS\SocialStream Ninja\spotify.html` si se quiere agregar configuracion visual
- `D:\plugins para mi OBS\Control Cortex\frontend\app.js` solo si se quiere mostrar/editar este ajuste desde Control Cortex

Cambios minimos:

1. Agregar estado de cooldown en el constructor.
2. Agregar parser de pedidos naturales.
3. Agregar `playTrackNow()`.
4. Agregar `handleNaturalSongRequest()`.
5. Enganchar esa funcion al flujo de mensajes entrantes.
6. Opcional: agregar comando `!playnow`.

La regla mas importante: cooldown antes de buscar. Eso mantiene el sistema optimizado, evita llamadas innecesarias a Spotify y protege el directo de cambios constantes.

## 14. Formatos naturales y generos

La integracion reconoce estos formatos sin exigir un comando con signo de exclamacion:

- `quiero el tema de Estrelar - Marcos Valle`
- `Quiero el tema de Los Días Que No Estás – Barbi Recanati`
- `Tema Los Días Que No Estás – Barbi Recanati`
- `Quiero escuchar ke personajes`
- `Quiero otro tema de marcos`
- `quiero algun reggaeton`

Los separadores `-`, `–` y `—` se normalizan. Cuando hay titulo y artista, se usa una busqueda precisa con `track:` y `artist:`. Cuando se pide un genero reconocido, se usa `genre:` y se amplia el limite de resultados para encontrar una pista reproducible. El destino de Spotify y el cooldown siguen aplicandose igual.

Si un pedido con `tema de` no incluye separador ni artista claro, la primera busqueda puede interpretarlo como artista. Si no devuelve resultados, la integracion reintenta automaticamente con texto libre para encontrar el titulo y el artista juntos.

## 15. Continuacion automatica

Cuando se acepta un pedido natural, la integracion prepara una pista siguiente en la cola de Spotify usando el tema pedido como semilla de recomendacion. Guarda las URI ya utilizadas durante la sesion para no repetirlas. Cuando empieza la pista preparada, vuelve a buscar y encolar otra.

Si el endpoint de recomendaciones no responde, usa como fallback otra pista del artista actual. Esta funcion no necesita que alguien escriba otro mensaje y no modifica el cooldown de los pedidos del chat. La biblioteca personal queda como mejora futura porque requiere el permiso OAuth `user-library-read` y volver a autorizar Spotify.

---

## 17. Implementacion local aplicada

Para no mezclar toda la logica propia dentro del plugin de tercero, la auto seleccion quedo separada asi:

- Fuente principal propia:
  `D:\plugins para mi OBS\Control Cortex\integrations\spotify-auto-music\spotify-auto-music.js`
- Copia cargable por la extension:
  `D:\plugins para mi OBS\SocialStream Ninja\local-overrides\spotify-auto-music.js`
- Enganche minimo en SSN:
  `D:\plugins para mi OBS\SocialStream Ninja\loader.js`

El archivo `spotify-auto-music.js` extiende `SpotifyIntegration.prototype.handleCommand()` sin modificar directamente `spotify.js`. Primero deja trabajar los comandos nativos de SSN y, si no hubo respuesta, intenta detectar:

```text
quiero un tema de Damas Gratis
quiero la musica de Amar Azul el tema Yo Tomo Licor
pon Amar Azul Yo Tomo Licor
!playnow Yo Tomo Licor Amar Azul
!tema Damas Gratis
!musica Amar Azul Yo Tomo Licor
```

Tambien se agrego un auto-parcheador en:

```text
D:\plugins para mi OBS\Control Cortex\backend\server.js
```

Cuando Control Cortex arranca, revisa si SocialStream Ninja conserva:

1. la `key` fija del `manifest.json`
2. la copia `local-overrides/spotify-auto-music.js`
3. la linea de carga en `loader.js`

Si al actualizar SocialStream Ninja se pierde alguno de esos cambios, Control Cortex lo vuelve a inyectar automaticamente.

## 18. Quitar segundos configurables

En la tarjeta `Spotify Now Playing` de `http://localhost:4000/` se puede activar `Quitar los segundos` y elegir un valor entre 1 y 120. Al guardarlo, la extension inicia cada tema nuevo en ese segundo y pasa al siguiente cuando queda aproximadamente ese mismo tiempo. La pequena tolerancia existe porque el estado de Spotify se consulta periodicamente. El ajuste se guarda en `Control Cortex/backend/spotify-playback-offset.json`.
