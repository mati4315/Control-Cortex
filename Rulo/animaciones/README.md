# Biblioteca de animaciones de Rulo

Las animaciones nuevas y futuras se administran desde `http://localhost:4000/rulo-library.html` o desde el acceso de **Biblioteca de clips** en Control Cortex y `rulo-mascota.html`.

## Clips incluidos

- `Idle_Mirar_Izquierda_01`: estado Idle seguro y fallback cuando otra familia todavía no tiene clips.
- `Dormir_Entrada_02`: comportamiento Dormir completo. Como termina despierta, vuelve a la pose `Idle_Base`; el clip se repite como una unidad y una acción entrante espera al final del ciclo.

Los archivos WebM que usa OBS están en sus carpetas de familia. Los originales MP4 quedan conservados bajo `source/`; la biblioteca no modifica ni elimina esos originales. No se usan los clips antiguos archivados.

## Importación

1. Copia los MP4 a esta carpeta o selecciónalos desde el panel.
2. En el panel, asigna un identificador, familia, pose inicial/final, función, prioridad, peso y política de loop/interrupción.
3. Usa chroma solo si el original tiene un fondo uniforme que se debe eliminar. Revisa color, tolerancia y suavizado en la vista previa.
4. Procesa el clip. FFmpeg conserva la relación de aspecto, adapta al canvas común, normaliza a VP9 con transparencia y valida el resultado.
5. Deja una Browser Source de OBS apuntando a `http://localhost:4000/rulo-animaciones.html?session=...`. Usa una sola fuente activa para que Cortex controle el estado y los cambios entre clips.

El perfil inicial es 1920×1080, 30 fps, VP9, CRF 28, sin audio, ancla inferior centrada. En **Normalización de video** puedes elegir el perfil anterior de canvas común o conservar la resolución y los FPS originales de cada video. CRF 18–22 da alta calidad; CRF 0 activa VP9 sin pérdida adicional respecto de los fotogramas de entrada y puede producir archivos grandes. La conversión VP9 no puede recuperar calidad ya perdida en el MP4. Las dimensiones impares no se pueden conservar exactamente con el formato de transparencia actual. Los nombres de salida incluyen una huella del contenido y no se sobrescriben clips publicados; al reemplazar una animación se publica un archivo nuevo.

## Compatibilidad de poses

Cada clip declara `from` y `to`. Los clips de comportamiento deben empezar en una pose alcanzable. Para cambiar de pose, registra clips `entry`, `transition` o `exit` con la pose inicial y final correspondientes. El motor busca una ruta antes de reproducir una acción. Si falta una familia solicitada, usa el fallback Idle cuando sea posible y muestra el problema en el panel.

El Idle se elige con peso y evita repetir los clips usados recientemente. La pausa antes de Dormir y sus límites se configuran en el panel/ajustes actuales de la mascota. Una acción entrante espera el límite seguro definido por el loop del clip; marca `interruptible` solo para clips que se puedan cortar sin romper la animación.

## Carpetas

- `Idle/`, `Dormir/`, `Mate/`, `Reacciones/`, `Baile/`, `Hablar/`, `Especiales/`: WebM publicados.
- `source/<familia>/`: originales de entrada sin modificar.
- `.temp/`: temporales de procesamiento y vistas previas.
- `animations.json`: biblioteca, perfil de salida, fallback y metadatos.

No edites manualmente el manifiesto mientras Cortex está activo. Usa el panel para que cambios, validaciones y estado del motor queden sincronizados.
