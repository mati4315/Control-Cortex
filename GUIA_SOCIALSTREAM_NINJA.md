# 🥷 Guía de Uso Rápido: SocialStream Ninja + OBS

Esta guía te explica paso a paso cómo capturar comentarios en vivo de **Facebook**, **YouTube**, **Twitch**, **Kick** o **TikTok** y mostrarlos automáticamente en tu transmisión de OBS (en tu setup de 2 PCs).

---

## 📡 ¿Cómo funciona en tu setup de 2 PCs?

```
[ PC 1: Tu PC Principal ]                             [ PC 2: PC de Transmisión ]
   Navegador Brave                                              OBS Studio
┌────────────────────────┐                             ┌────────────────────────┐
│ Pestaña Facebook/Live  │                             │ Fuente Browser: "CHAT" │
│           │            │                             │           ▲            │
│           ▼            │                             │           │            │
│ Extensión SocialStream ├──── Transmite por la red ───┼───────────┘            │
│ (Dock abierto)         │                             │ (Muestra los mensajes  │
└────────────────────────┘                             │  en pantalla en vivo)  │
                                                       └────────────────────────┘
```

* **En la PC 1:** Abres las transmisiones en Brave con la extensión activa y el Dock abierto.
* **En la PC 2 (OBS):** Tienes la fuente de navegador **`CHAT`** que recibe y dibuja los comentarios.

---

## 🚀 Pasos para Iniciar en cada Directo

### Paso 1: Abrir el Dock de SocialStream Ninja (PC 1)
1. En tu navegador Brave, haz clic en el icono de **SocialStream Ninja** (arriba a la derecha).
2. Haz clic en el botón verde **"Open Dock"** (o "Launch Dock").
3. Se abrirá una pestaña con tu panel de control de mensajes (`https://socialstream.ninja/dock.html?session=...`).
4. **Mantén esta pestaña siempre abierta** mientras dure tu transmisión.

---

### Paso 2: Obtener tu enlace para OBS (Solo se hace la primera vez)
1. En la pestaña del Dock (o en el menú de la extensión), busca la sección **Overlays**.
2. Haz clic en **"Copy Overlay URL"** (o Chat Overlay).  
   *Tu enlace tendrá este formato:*  
   `https://socialstream.ninja/chat-overlay.html?session=TU_CODIGO`
3. Ve a tu **OBS (PC 2)**:
   - Haz doble clic en la fuente llamada **`CHAT`**.
   - En el campo **URL**, pega ese enlace.
   - Ancho recomendado: `800`, Alto recomendado: `600` (o ajusta según tu diseño).
   - Marca las casillas:
     - [x] *Cerrar la fuente cuando no sea visible*
     - [x] *Actualizar el navegador cuando la escena se active*
   - Haz clic en **Aceptar**.

---

### Paso 3: Capturar Comentarios según la Plataforma (PC 1)

#### 🔵 En Facebook (Videos o En Vivo)
1. Abre el video o directo de Facebook en una pestaña de Brave:  
   Ejemplo: `https://www.facebook.com/.../videos/...`
2. **Inicia sesión en Facebook** si te lo pide.
3. Asegúrate de que los comentarios sean visibles en la pantalla.
4. En el filtro de comentarios de Facebook (que suele decir *"Más relevantes"*), cámbialo a:  
   👉 **"Todos los comentarios"** o **"Más recientes"**.
5. Si es un video grabado o emitido anteriormente, haz un poco de **scroll hacia abajo** en la lista de comentarios para que Facebook los cargue en el navegador.

#### 🔴 En YouTube
1. Abre tu directo o YouTube Studio.
2. Deja abierta la ventana del chat en vivo (o el chat emergente / popout).
3. SocialStream Ninja lo detectará de forma 100% automática.

#### 🟣 En Twitch / Kick / TikTok
1. Abre la página del canal o panel de creador con el chat visible.
2. La extensión captura los mensajes instantáneamente.

---

## 🎁 Integración con tu "Ruleta de Comentarios" (`http://localhost:9742`)

Tu plugin local **Ruleta de Comentarios** ya está integrado con SocialStream Ninja:

1. En el Dock de SocialStream Ninja, copia tu **Session ID** (el código de letras/números de tu sesión).
2. Entra a tu panel de la Ruleta: **`http://localhost:9742/dashboard.html`**.
3. En la configuración:
   - Activa la casilla **SocialStream Ninja**.
   - Pega tu **Session ID**.
   - Guarda los cambios.
4. ¡Listo! Cada persona que comente en Facebook, YouTube o Twitch **se sumará automáticamente a la ruleta** para hacer sorteos en vivo.

---

## 🔧 Solución de Problemas Frecuentes

* **¿No aparecen los comentarios en el Dock?**
  - Asegúrate de que la extensión en Brave esté en **ON** (icono a color, no gris).
  - Recarga la pestaña de Facebook/YouTube pulsando **F5**.
  - Asegúrate de haber hecho scroll en los comentarios de Facebook si es un video largo.

* **¿No aparecen en el OBS?**
  - En tu panel **Control Cortex** (`http://localhost:4000/`), pulsa el botón **`🔄 Recargar Fuentes OBS`** para refrescar la fuente `CHAT` sin necesidad de reiniciar OBS.
  - Verifica que el Session ID del link de OBS sea exactamente el mismo que el del Dock abierto en tu navegador.
