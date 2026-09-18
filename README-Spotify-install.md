# 🎧 Guía de Supervivencia: Instalación y Mantenimiento de Spotify

> **Importante:** Leer este documento antes de instalar esto en una PC nueva o antes de actualizar SocialStream Ninja.

---

## 🏗️ 1. Arquitectura del Sistema (¿Cómo funciona esto?)

Nuestro sistema de Spotify para OBS se divide en dos partes que trabajan juntas:

1. **SocialStream Ninja (SSN):** Es la extensión de Brave. Se encarga de conectarse con la API de Spotify, leer lo que estás escuchando y procesar comandos del chat.
2. **Control Cortex:** Es tu panel de control local. Se encarga de alojar tu overlay personalizado (el de las letras) y servirlo para que OBS lo pueda leer correctamente. Además, **protege** a SSN de perder su configuración.

---

## 🚀 2. Instalación desde cero en una PC nueva

Si formateás o cambiás de PC, seguí estos pasos exactos:

1. Cloná o descargá todo este repositorio en `D:\plugins para mi OBS\`.
2. Abrí Brave y andá a `brave://extensions`.
3. Activá el **Modo Desarrollador** (arriba a la derecha).
4. Hacé clic en **"Cargar descomprimida"** y seleccioná la carpeta `SocialStream Ninja`.
5. Verificá que el ID de la extensión sea **`lfompadnhpldepaaelcabnjfkglepnjb`**.
6. Abrí la extensión de SSN, andá a Spotify e iniciá sesión. (Debe decir "Connected").
7. Iniciá **Control Cortex** (abriendo el backend con Node/PM2).
8. Abrí tu panel en `http://localhost:4000`.
9. Copiá las URLs de Spotify y pegalas en tu OBS como "Browser Source" (Fuente de Navegador).

---

## 🔄 3. ¿Cómo actualizar SocialStream Ninja sin romper nada?

SSN se actualiza seguido. Si querés bajar una nueva versión, podés hacerlo **sin miedo a romper Spotify**, pero tenés que seguir este orden:

1. Descargá el ZIP de la nueva versión de SocialStream Ninja.
2. Extraé los archivos y **sobreescribí** el contenido de la carpeta `SocialStream Ninja` actual.
3. Al hacer esto, el archivo `manifest.json` se va a pisar y SSN va a perder su "Key" (lo que mantiene fijo el ID de la extensión). **NO TE ASUSTES, es normal.**
4. **Magia de Control Cortex:** Simplemente **reiniciá Control Cortex** (cerrá y volvé a abrir el backend).
5. Al arrancar, Control Cortex tiene un "Auto-Parcheador". Va a revisar la carpeta de SSN, se va a dar cuenta de que falta la Key, y la va a inyectar automáticamente.
6. Andá a Brave (`brave://extensions`) y dale al botón de **"Actualizar"** (la ruedita) en la extensión de SSN para que tome el parche.
7. ¡Listo! El ID vuelve a ser el correcto y Spotify sigue funcionando sin tener que reconfigurar la API.

---

## 🎨 4. ¿Dónde está el Overlay personalizado de las Letras?

El archivo `spotify-lyrics-overlay.html` **NO ESTÁ** en la carpeta de SocialStream Ninja.

Para protegerlo de las actualizaciones de SSN, lo mudamos a:
`D:\plugins para mi OBS\Control Cortex\frontend\spotify-lyrics-overlay.html`

Si tu desarrollador web quiere cambiarle los colores, la fuente, o el tamaño, debe editar **ese** archivo. Ya está configurado para conectarse con SSN por detrás sin importar dónde esté.

---

## 🚑 5. Troubleshooting (Solución de problemas frecuentes)

### Problema: OBS muestra la pantalla en blanco donde debería estar la canción.
*   **Causa 1:** Control Cortex está apagado. El overlay de las letras es servido por Control Cortex en el puerto 4000. Si está apagado, OBS no encuentra el archivo.
*   **Solución 1:** Iniciá Control Cortex.
*   **Causa 2:** Cambió la IP de tu PC principal (ej: ya no es `192.168.4.100`).
*   **Solución 2:** Entrá al panel de Control Cortex, asegurate de que la URL diga la IP correcta, copiala y pegala de nuevo en OBS.

### Problema: SocialStream Ninja dice "Spotify Auth Error" o "Invalid Redirect URI".
*   **Causa:** El ID de la extensión en Brave cambió porque se borró la Key del manifest y Control Cortex no la auto-parcheó.
*   **Solución:** Reiniciá Control Cortex para que inyecte la Key. Luego andá a `brave://extensions` y recargá la extensión. El ID DEBE SER `lfompadnhpldepaaelcabnjfkglepnjb`.

### Problema: La canción sale, pero las letras dicen "Sin Letras".
*   **Causa:** La canción que estás escuchando no está en la base de datos de LRCLib (que es comunitaria y gratuita).
*   **Solución:** Poner una canción más conocida. (No hay fallo técnico, simplemente no existe la letra para esa versión exacta).

---
*Documento generado para asegurar la supervivencia de la configuración - 2025*