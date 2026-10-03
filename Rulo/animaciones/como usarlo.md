# Cómo usar la biblioteca de animaciones de Rulo

Esta guía explica cómo importar videos nuevos y qué preparar para que Rulo pueda cambiar de una animación a otra sin saltos. No necesitas editar código ni convertir videos manualmente.

## 1. Abrir el panel

1. Inicia **Control Cortex** desde el acceso directo habitual.
2. Abre [http://localhost:4000/rulo-library.html](http://localhost:4000/rulo-library.html). También puedes entrar desde el botón **Rulo · Biblioteca de clips** en Inicio o **Abrir biblioteca de animaciones** en `rulo-mascota.html`.
3. En la parte superior revisa **Conexión OBS**. Para probar animaciones en vivo debe mostrar que hay un reproductor conectado.

Si el panel no carga, verifica que Control Cortex esté iniciado y que la dirección empiece con `http://localhost:4000`.

## 2. Cómo agregar un video

1. Copia el video a `D:\plugins para mi OBS\Rulo\animaciones`, o elígelo con **O importa un archivo de esta PC**. También puedes pulsar **Usar archivo** junto a un MP4 que ya aparezca en la lista.
2. Completa los campos del formulario **Importar / registrar un clip** (se explican en la siguiente sección).
3. Si el MP4 tiene un fondo verde uniforme que quieres quitar, deja activada la opción de chroma. Si el video ya tiene un fondo que debe conservarse, desactívala.
4. Pulsa **Procesar MP4 → WebM VP9** y espera a que el progreso indique que el WebM está validado.
5. Busca el clip en **Biblioteca de animaciones**. Usa **Ver** para revisar el video y **Probar** para enviarlo a la fuente de OBS conectada.

El proceso acepta archivos de hasta **250 MB** y **cinco minutos**. Conserva el original y crea un WebM nuevo; no reemplaza el video que OBS pudiera estar reproduciendo.

## 3. Qué significa cada campo

| Campo | Qué debes poner |
| --- | --- |
| **Nombre / identificador** | Un nombre único, sin espacios ni tildes. Debe empezar con una letra. Ejemplo: `Idle_Pestanear_01`. |
| **Familia** | El tipo de acción: `Idle`, `Dormir`, `Mate`, `Reacciones`, `Baile`, `Hablar` o `Especiales`. |
| **Pose inicial** | La pose exacta que tiene Rulo al comienzo. Ejemplo: `Idle_Base`. |
| **Pose final** | La pose exacta que tiene Rulo al terminar. Ejemplo: `Idle_Base`. |
| **Función del clip** | `Comportamiento / variante` para una acción normal; `Entrada`, `Transición` o `Salida` cuando el clip cambia de pose. |
| **Peso relativo** | Qué tan seguido se elige frente a otros clips compatibles de la misma familia. Un peso mayor hace que se elija más a menudo. Usa `0` para que no participe en la selección automática. |
| **Prioridad** | Qué tan pronto se atiende la acción cuando hay otras en cola. Un número mayor tiene prioridad. |
| **Cooldown** | Segundos que deben pasar antes de volver a elegir automáticamente ese clip. Usa `0` para no imponer espera. |
| **Loop** | Marca si el clip debe repetirse en las acciones que utilizan repetición. Para una acción con principio y fin, normalmente déjalo apagado. |
| **Interrumpible** | Permite que una acción más urgente lo corte en un límite seguro. Desactívalo para entradas, salidas o movimientos que deben terminar completos. |
| **Habilitado para selección automática** | Deja participar al clip en las elecciones automáticas. Desmárcalo si quieres conservarlo en la biblioteca, pero no seleccionarlo automáticamente. |
| **Quitar este fondo de color** | Actívalo solo cuando el video tenga un fondo uniforme que quieras hacer transparente. |

## 4. Poses y transiciones: lo más importante

La pose inicial y la final deben describir lo que realmente ocurre en el video. El motor solo puede encadenar clips cuando encuentra una ruta desde la pose actual hasta la pose inicial del siguiente clip.

- Una animación que empieza y termina de pie en reposo puede ser `Idle_Base → Idle_Base`.
- Una animación de entrada puede ser `Oculto → Idle_Base`.
- Una transición para sentarse puede ser `Idle_Base → Sentado`.
- Un comportamiento que se repite sentado puede ser `Sentado → Sentado`.
- Una salida al ocultarse puede ser `Sentado → Oculto`.

Escribe los nombres de las poses siempre igual, incluyendo mayúsculas y guiones bajos. Si defines una pose nueva, necesitarás también clips de entrada o transición que la conecten con la pose actual; de lo contrario, el panel puede mostrar que no hay un clip compatible.

Para empezar, utiliza las poses que ya existen en tus clips. En esta instalación, tanto `Idle_Mirar_Izquierda_01` como `Dormir_Entrada_02` empiezan y terminan en `Idle_Base`.

## 5. Preparar buenos videos nuevos

Antes de importar un video generado o editado, procura que:

- Rulo tenga un tamaño, encuadre y posición parecidos a los demás clips.
- La cámara no haga zoom, paneo ni cambie de ángulo si el clip debe empalmar con otro.
- El primer fotograma coincida con la **pose inicial** que vas a declarar.
- El último fotograma coincida con la **pose final** que vas a declarar.
- Haya una pausa visual breve al comienzo o al final si la pose necesita quedar estable para una transición.
- No haya cortes negros, fundidos a negro ni fondos que cambien de color inesperadamente.
- La duración solo incluya el movimiento útil; elimina esperas vacías innecesarias.

El perfil inicial prepara los videos a **1920×1080, 30 FPS, WebM VP9 y sin audio**, conservando la proporción del original y colocándolo en un canvas común con anclaje inferior centrado. Esto ayuda a que los clips de Rulo coincidan de tamaño y posición.

En **Normalización de video** hay dos modos seleccionables:

- **Perfil anterior: canvas común con resolución y FPS configurables.** Ajusta todos los videos al mismo canvas y usa el anclaje elegido. Es el modo recomendado si quieres mantener a Rulo en el mismo tamaño y posición entre clips.
- **Conservar resolución y FPS de cada video original.** Cada importación usa el ancho, el alto y los FPS detectados en ese archivo; no se aplica el canvas ni el anclaje. Los videos con dimensiones impares no se pueden conservar exactamente con el formato de transparencia actual: prepara un original con ancho y alto pares o elige el perfil de canvas.

Selecciona el modo y pulsa **Guardar video predeterminado**. La elección se aplica a las importaciones que hagas después; no modifica los WebM que ya están en la biblioteca.

La conversión a WebM VP9 siempre vuelve a codificar el video. Para alta calidad, prueba CRF **18–22** (cuanto menor el número, mayor calidad y tamaño). CRF **0** activa la codificación VP9 sin pérdida adicional respecto de los fotogramas que salen del original, pero el WebM puede crecer mucho y tardar más en convertirse. Ningún conversor puede recuperar detalles que ya se perdieron al comprimir el MP4. El original se conserva para poder procesarlo otra vez.

### Si necesitas quitar el fondo

Un MP4 normal no tiene transparencia. Para quitar el fondo con chroma, prepara el video con un color sólido y uniforme (por ejemplo, verde `#00ff00`) que no aparezca en Rulo ni en los objetos que quieras conservar. Deja algo de espacio entre el personaje y el fondo para reducir bordes verdes. En el panel, activa **Quitar este fondo de color** y ajusta el color, la tolerancia y el suavizado; comprueba el resultado en **Ver**.

Si el chroma se lleva partes de Rulo, baja la tolerancia. Si queda un halo del fondo, aumenta poco a poco el suavizado. Los valores altos pueden borrar detalles finos, así que revisa cabello, contornos y objetos antes de usar el clip en directo.

### Audio y tamaño

El audio se quita por defecto. Si necesitas sonido, revisa **Conservar audio** en el perfil de normalización. Mantén los clips razonablemente cortos para que carguen rápido y no pesen demasiado.

## 6. Loop, interrupciones y cambios de acción

- Para un movimiento corto con final definido, usa **Loop** desactivado.
- Para un movimiento que debe mantenerse mientras no ocurra nada nuevo, usa Loop cuando corresponda a esa acción.
- Si una acción nueva debe esperar a que termine el ciclo actual, no marques el clip como interrumpible.
- Marca **Interrumpible** solo si el personaje puede cortarse en un límite de ciclo sin quedar en una pose incoherente.

En particular, el clip actual de Dormir termina su ciclo antes de pasar a una nueva acción. Evita marcarlo como interrumpible si quieres conservar ese comportamiento.

## 7. Ajustes de comportamiento

En **Comportamiento automático** puedes definir:

- **Inactividad mínima y máxima:** Cortex elige al azar un tiempo dentro de ese rango antes de pasar de Idle a Dormir.
- **Evitar las últimas N animaciones:** reduce repeticiones cuando haya variantes compatibles disponibles.
- **Máximo de acciones en cola:** limita cuántas solicitudes esperan turno.
- **Clip de emergencia / Idle seguro:** el clip que se usa como respaldo si una animación falta o no carga. Mantén siempre habilitado un Idle válido como respaldo.

El tiempo tras el cual Rulo se oculta mientras duerme se configura por separado en `rulo-mascota.html`, en los ajustes de sueño.

## 8. Usarlo en OBS

OBS muestra la página reproductora y Cortex controla qué video se reproduce.

1. En OBS agrega o conserva una **Fuente de navegador** para el reproductor de Rulo.
2. Usa la URL que aparece en los controles de Rulo. En esta instalación se ve así: `http://localhost:4000/rulo-animaciones.html?session=XJ9hQ2JDHH`.
3. Mantén una sola fuente de animaciones conectada para evitar dos reproductores compitiendo.
4. Después de actualizar el código o la fuente, recarga la Browser Source desde OBS.
5. Abre la biblioteca y confirma que **Conexión OBS** diga que el reproductor está conectado antes de pulsar **Probar**.

## 9. Qué hacer si algo no funciona

- **No aparece el panel:** inicia Control Cortex y vuelve a abrir `http://localhost:4000/rulo-library.html`.
- **Conexión OBS desconectada:** comprueba que la Browser Source use `rulo-animaciones.html`, esté activa y se haya recargado.
- **No se puede importar:** verifica que el archivo sea MP4 o WebM, pese menos de 250 MB y dure menos de cinco minutos.
- **No aparece el personaje:** confirma que el clip esté habilitado, revisa la transparencia con **Ver** y comprueba que el archivo no sea todo negro o tenga un fondo oscuro opaco.
- **Se ven bordes verdes:** ajusta el color, la tolerancia y el suavizado de chroma.
- **Una acción no encuentra animación compatible:** revisa la familia y las poses inicial/final; agrega un clip de entrada o transición si las poses no coinciden.
- **El clip no se elige automáticamente:** revisa que esté habilitado, que tenga peso mayor que cero y que no esté en cooldown.
- **Una prueba reemplazó una acción en vivo:** el botón **Probar** reproduce el clip en el reproductor conectado; úsalo cuando estés listo para probarlo al aire.

## 10. Dónde queda cada archivo

- `Idle/`, `Dormir/`, `Mate/`, `Reacciones/`, `Baile/`, `Hablar/`, `Especiales/`: WebM convertidos que reproduce OBS.
- `source/`: originales importados; no los borres si podrías querer volver a procesarlos.
- `.temp/`: archivos temporales del procesamiento.
- `animations.json`: lista de clips, poses, pesos y ajustes del motor. No lo edites a mano mientras Cortex está funcionando; usa el panel.

### Ejemplo completo

Quieres agregar un parpadeo que comienza y termina en reposo:

```text
Nombre: Idle_Pestanear_01
Familia: Idle
Pose inicial: Idle_Base
Pose final: Idle_Base
Función: Comportamiento / variante
Peso: 10
Prioridad: 0
Cooldown: 5
Loop: apagado
Interrumpible: activado
```

Importa el MP4, revisa la vista previa y pulsa **Probar**. Si se ve bien, déjalo habilitado. Para una variante de Idle menos frecuente, baja su peso; para excluirla de la selección automática, desmarca **Habilitado para selección automática**.
