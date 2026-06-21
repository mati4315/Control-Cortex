# Guía de Uso del Overlay "Empezamos Pronto" (OBS)

Este módulo incluye una pantalla de **"Starting Soon" (Empezamos pronto)** de estilo gamer/neón futurista y un **Admin Dashboard** para controlar todos los aspectos visuales y de tiempo en tiempo real sin tocar código.

---

## 🚀 Cómo Iniciar el Sistema

1. **Ejecutar el servidor:**
   - Abre la carpeta `D:\FIREBASE\Modulo de loteria\modulo de bienvendos`.
   - Haz doble clic en el archivo **`iniciar-overlay.bat`**.
   - Esto abrirá una consola de comandos, comprobará que todo esté instalado e iniciará el servidor en tu computadora.

2. **Acceder a las URLs:**
   - **Panel de Control (Admin Dashboard):** Abre en tu navegador [http://localhost:9345/admin](http://localhost:9345/admin)
   - **Overlay Visual (Para OBS):** La URL que ingresarás en tu software de transmisión es [http://localhost:9345/starting-soon](http://localhost:9345/starting-soon)

---

## 📺 Configuración en OBS Studio

Para agregar este overlay a tu transmisión en OBS:

1. En la sección **Fuentes (Sources)** de OBS, haz clic en el botón `+` y selecciona **Navegador (Browser)**.
2. Nómbralo como quieras (ej. *Overlay Bienvenido*).
3. Configura las siguientes opciones en la ventana de propiedades:
   - **URL:** `http://localhost:9345/starting-soon`
   - **Ancho (Width):** `720`
   - **Alto (Height):** `1280` *(Resolución de Reel/TikTok vertical)*
   - **Controlar audio vía OBS (Control audio via OBS):** Activa esta casilla si deseas mutear/regular el volumen de la música de fondo directamente desde el mezclador de OBS.
   - **Actualizar el navegador cuando la escena se vuelva activa (Refresh browser when scene becomes active):** Activa esta opción para reiniciar la animación inicial (GSAP) cada vez que cambies a esta escena.
4. Haz clic en **Aceptar**.

---

## ⚙️ Características del Panel de Administración (`/admin`)

El dashboard de control funciona **en tiempo real** utilizando WebSockets. Cualquier cambio que guardes o modifiques se reflejará instantáneamente en el overlay de OBS:

### 1. ⏱️ Cronómetro Regresivo (Countdown)
- **Control en Vivo:** Botones para **Iniciar**, **Pausar** y **Reestablecer** el cronómetro.
- **Ajustes Rápidos:** Suma o resta 1 minuto / 10 segundos en vivo para corregir desfases o alargar la espera.
- **Duración Inicial:** Elige cuántos minutos y segundos cargará por defecto el cronómetro al iniciar.

### 2. ✍️ Edición de Textos
- Cambia la insignia superior (`🔴 EN VIVO PRONTO`), el sub-encabezado (`STREAM COMENZANDO`), el título principal (`Empezamos Pronto`) y el subtítulo de espera de forma directa.

### 3. 🎨 Diseño y Colores
- **Paleta de Colores:** Selectores visuales para el color primario de los textos y bordes, color secundario, color del brillo glow y el color de fondo general.
- **Fuentes (Typography):** Menú desplegable con fuentes de Google Fonts ideales para streamers (como *Orbitron*, *Rajdhani*, *Share Tech Mono*, *Outfit*, etc.). Se descargan y aplican dinámicamente en el overlay.
- **Sistema de Partículas:** Configura la cantidad de estrellas flotantes (de 20 a 250), la velocidad de flujo y si tienen brillo glow neón o no.

### 4. 🖼️ Multimedia y Archivos
- **Tipo de Fondo:** Alterna entre partículas espaciales dinámicas (dibujadas en Canvas), un video personalizado subido, una imagen estática o un color sólido/degradado.
- **Subida de Archivos (Drag & Drop):**
  - **Logo:** Sube el avatar o logotipo de tu canal para que flote con brillo en el centro.
  - **Video de Fondo:** Sube archivos MP4/WebM ligeros de fondo.
  - **Imagen de Fondo:** Sube imágenes en alta definición.
  - **Música:** Sube canciones en MP3 o WAV. Puedes modular el volumen final desde el panel.

### 5. 🔗 Redes Sociales
- Añade, edita o elimina enlaces de redes sociales (Twitch, YouTube, X, Instagram, TikTok, Facebook).
- Puedes ocultar o mostrar filas específicas marcando la casilla **Visible**.

---

## 📁 Persistencia de Datos
Toda la configuración se guarda automáticamente en el archivo `settings.json` y los archivos multimedia subidos se almacenan en la carpeta `/uploads` en el servidor local. No perderás tus configuraciones al cerrar o reiniciar la PC.
