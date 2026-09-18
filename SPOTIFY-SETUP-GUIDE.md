# 🎵 Guía de Configuración — Spotify + OBS

> Documentación de todo lo configurado. Última actualización: Septiembre 2025

---

## 📋 Resumen del sistema

```
PC Principal (192.168.4.100)
  ├── Brave Browser
  │     └── Extensión: Social Stream Ninja (SSN)
  │           └── Módulo Spotify → conecta con Spotify Web API
  └── Control Cortex  (http://localhost:4000)
        └── Backend Node.js (PM2) → sirve overlays a OBS

PC con OBS (192.168.4.45)
  └── OBS Browser Sources
        ├── Spotify Now Playing  → http://192.168.4.100:4000/ssn/spotify-overlay.html?session=XJ9hQ2JDHH&ln=es
        └── Spotify + Letras     → http://192.168.4.100:4000/ssn/spotify-lyrics-overlay.html?session=XJ9hQ2JDHH&ln=es&lyrics
```

---

## 🔑 Datos clave actuales

| Ítem | Valor |
|------|-------|
| **Extension ID (fijo)** | `lfompadnhpldepaaelcabnjfkglepnjb` |
| **Session ID (SSN)** | `XJ9hQ2JDHH` |
| **Client ID (Spotify App)** | `b7bca8a140c04ba7b5259f8a17be2588` |
| **Redirect URI registrada** | `https://lfompadnhpldepaaelcabnjfkglepnjb.chromiumapp.org/spotify` |
| **Control Cortex URL** | `http://192.168.4.100:4000` |
| **IP PC principal** | `192.168.4.100` |
| **IP PC con OBS** | `192.168.4.45` |

---

## 🆕 Pasos al crear una nueva cuenta de Spotify

### Paso 1 — Crear la App en Spotify Developer

1. Ir a **https://developer.spotify.com/dashboard**
2. Loguearse con la nueva cuenta de Spotify
3. Clic en **"Create app"**
4. Completar:
   - **App name:** el que quieras (ej: "Mi OBS Overlay")
   - **App description:** cualquier texto
   - **Redirect URIs:** `https://lfompadnhpldepaaelcabnjfkglepnjb.chromiumapp.org/spotify`
   - **APIs used:** marcar solo ✅ **Web API**
5. Aceptar los términos → **Save**
6. En la app creada ir a **Settings** → copiar el **Client ID**

> ⚠️ El Client ID cambia con cada app nueva.

---

### Paso 2 — Configurar la extensión SSN con el nuevo Client ID

1. Abrir Brave → clic en el ícono de **Social Stream Ninja**
2. En el popup buscar la sección **Spotify**
3. Abrir la página de config: `chrome-extension://lfompadnhpldepaaelcabnjfkglepnjb/spotify.html`
4. Ingresar el nuevo **Client ID**
5. Clic en **"Connect"** → se abre Spotify para autorizar → aceptar
6. Debería aparecer **✓ Connected**

---

### Paso 3 — Verificar en Control Cortex

1. Abrir **http://localhost:4000**
2. En la tarjeta **🎵 Spotify Now Playing**:
   - El **Session ID** (XJ9hQ2JDHH) **no cambia** — es de SSN, no de Spotify
   - Solo necesitás reconectar Spotify si cambió la cuenta
3. Clic en **Guardar** para regenerar la URL del overlay si hiciste cambios

---

## 🖥️ URLs de los overlays para OBS

### Sin letras (now playing básico)
```
http://192.168.4.100:4000/ssn/spotify-overlay.html?session=XJ9hQ2JDHH&ln=es
```
Tamaño recomendado en OBS: **720×120px**

### Con letras sincronizadas
```
http://192.168.4.100:4000/ssn/spotify-lyrics-overlay.html?session=XJ9hQ2JDHH&ln=es&lyrics
```
Tamaño recomendado en OBS: **720×130px**

### Parámetros disponibles

| Parámetro | Efecto |
|-----------|--------|
| `&lyrics` | Activa letras sincronizadas |
| `&hidepaused` | Oculta el overlay cuando la canción está pausada |
| `&hideinactive` | Oculta cuando Spotify está cerrado |
| `&hideart` | Oculta la carátula del álbum |
| `&hidealbum` | Oculta el nombre del álbum |
| `&hideprogress` | Oculta la barra de progreso |
| `&compact` | Versión compacta |
| `&style=comic` | Tema visual: minimal / glass / comic / ticker |
| `&accent=%231db954` | Color de acento (en formato URL-encoded) |
| `&ln=es` | Idioma (es / en / pt) |

---

## 📁 Archivos importantes

```
D:\plugins para mi OBS\
├── SPOTIFY-SETUP-GUIDE.md             ← este archivo
│
├── SocialStream Ninja\
│   ├── manifest.json                  ← tiene la KEY que fija el extension ID
│   ├── spotify-overlay.html           ← overlay original (now playing)
│   ├── spotify-lyrics-overlay.html    ← overlay nuevo (now playing + letras)
│   └── spotify.html                   ← página de configuración de Spotify
│
└── Control Cortex\
    ├── frontend\
    │   ├── app.js                     ← tarjeta Spotify (renderSpotifyCard)
    │   └── style.css                  ← estilos de la tarjeta Spotify
    └── backend\
        ├── server.js                  ← sirve /ssn/* desde SocialStream Ninja
        └── services.json              ← lista de microservicios
```

---

## 🔧 Por qué el Extension ID es fijo

Originalmente el ID cambiaba cada vez que se recargaba la extensión en modo desarrollador.
Se solucionó agregando una `"key"` al `manifest.json` de SSN.

**ID fijo:** `lfompadnhpldepaaelcabnjfkglepnjb`

**Si desinstalás y volvés a instalar la extensión:**
1. Ir a `brave://extensions`
2. Activar **Modo desarrollador** (toggle arriba a la derecha)
3. Clic en **"Cargar descomprimida"**
4. Seleccionar la carpeta `D:\plugins para mi OBS\SocialStream Ninja`
5. El ID debe seguir siendo `lfompadnhpldepaaelcabnjfkglepnjb`
6. Si por alguna razón cambia → actualizar la Redirect URI en el dashboard de Spotify

---

## 🎵 Cómo funcionan las letras sincronizadas

```
1. SSN detecta canción → envía artista + título al overlay
2. Overlay consulta https://lrclib.net (API gratis, sin API key)
3. LRCLib devuelve letras con timestamps [mm:ss.xx]
4. El overlay sincroniza cada línea con el progreso de la canción
5. Muestra 1 línea a la vez, centrada y en negrita
```

- **Sin letras:** muestra "Sin letras"
- **Instrumental:** muestra "🎸 Instrumental"
- **Error de conexión:** muestra "⚠ No se pudieron cargar las letras"

---

## 🔄 Botón "Recargar Fuentes OBS" en Control Cortex

Recarga **todas** las browser sources de OBS vía WebSocket (incluyendo Spotify).

Configuración OBS WebSocket (en `server.js` línea 17):
- **URL:** `ws://192.168.4.45:4455`
- **Password:** guardada en el código

---

## ⚠️ Notas importantes

- El **Session ID** de SSN (`XJ9hQ2JDHH`) es estable → no cambia al reconectar Spotify
- Si Brave actualiza SSN desde el .zip → verificar que `manifest.json` conserve la `"key"`
- Control Cortex debe estar corriendo para que los overlays funcionen desde la PC con OBS
- Las letras vienen de LRCLib (base de datos comunitaria) → algunas canciones pueden no tenerlas
- Si la IP de la PC principal cambia → actualizar las URLs en `app.js` (líneas SPOTIFY_BASE_URL)

---

*Generado automáticamente — Septiembre 2025*