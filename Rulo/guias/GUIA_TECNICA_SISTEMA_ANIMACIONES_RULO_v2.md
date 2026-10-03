# Guía técnica para mejorar el sistema de animaciones de Rulo

## Objetivo

Mejorar el sistema actual de animaciones de **Rulo** para que:

- Las transiciones entre animaciones sean fluidas y sin microcortes.
- El personaje no desaparezca ni siquiera durante unos milisegundos al cambiar de animación.
- Las animaciones estén organizadas por carpetas y familias de comportamiento.
- Cada animación sea un archivo independiente y fácil de reemplazar.
- Los videos generados por IA en MP4 puedan importarse y procesarse automáticamente con FFmpeg.
- El sistema pueda crecer fácilmente con nuevas animaciones.
- Las acciones puedan encadenarse de forma natural.
- El panel externo siga siendo quien controle el comportamiento.
- OBS Studio funcione únicamente como una **Browser Source** que muestra la página web del personaje.

---

# 1. Decisión de arquitectura

## No utilizar un WebM grande por familia

Se decidió **NO agrupar todas las animaciones de una familia dentro de un único WebM grande**.

En su lugar, cada animación será un archivo WebM independiente, organizado dentro de una carpeta correspondiente a su familia de comportamiento.

Ejemplo:

```text
animations/
│
├── Idle/
│   ├── Idle_Respirar_01.webm
│   ├── Idle_Respirar_02.webm
│   ├── Idle_Mirar_Izquierda_01.webm
│   ├── Idle_Mirar_Derecha_01.webm
│   └── Idle_Pestanear_01.webm
│
├── Dormir/
│   ├── Dormir_Entrada_01.webm
│   ├── Dormir_Entrada_02.webm
│   ├── Dormir_Respirar_01.webm
│   ├── Dormir_Respirar_02.webm
│   ├── Dormir_Roncar_01.webm
│   ├── Dormir_Moverse_01.webm
│   ├── Dormir_Acomodarse_01.webm
│   ├── Dormir_Salida_01.webm
│   └── Dormir_Salida_02.webm
│
├── Mate/
│   ├── Mate_Agarrar_01.webm
│   ├── Mate_Tomar_01.webm
│   ├── Mate_Tomar_02.webm
│   ├── Mate_Sostener_01.webm
│   └── Mate_Dejar_01.webm
│
├── Reacciones/
│   ├── Reaccion_Sorpresa_01.webm
│   ├── Reaccion_Risa_01.webm
│   ├── Reaccion_Enojo_01.webm
│   └── Reaccion_Miedo_01.webm
│
├── Baile/
│   ├── Baile_01.webm
│   ├── Baile_02.webm
│   └── Baile_03.webm
│
├── Hablar/
│   ├── Hablar_01.webm
│   ├── Hablar_02.webm
│   └── Hablar_03.webm
│
└── Especiales/
    ├── Especial_01.webm
    └── Especial_02.webm
```

---

# 2. Ventajas de esta arquitectura

Utilizar archivos independientes dentro de carpetas ofrece varias ventajas:

- Es mucho más fácil agregar una animación nueva.
- No es necesario reconstruir un WebM grande.
- No hay que calcular segundos de inicio y fin.
- No es necesario hacer `seek` dentro de archivos largos.
- Cada animación puede reemplazarse individualmente.
- Es más fácil detectar problemas en un archivo específico.
- El panel puede precargar únicamente las animaciones necesarias.
- La organización por carpetas sigue manteniendo el proyecto ordenado.
- El mantenimiento futuro es más sencillo.
- Los nombres de archivo sirven como identificadores claros.

Para este proyecto, esta arquitectura es preferible a mantener muchos segmentos dentro de un único archivo de video.

---

# 3. Flujo general del sistema

La arquitectura deseada es:

```text
IA genera animación
        ↓
     MP4 original
        ↓
     PANEL / BACKEND
        ↓
      FFmpeg
        ↓
WebM preparado y normalizado
        ↓
Carpeta de comportamiento
        ↓
Motor de estados de Rulo
        ↓
Reproductor web
        ↓
OBS Browser Source
```

OBS no debería administrar las animaciones directamente.

OBS solamente mostrará la aplicación web mediante una **Browser Source**.

---

# 4. FFmpeg como parte del proyecto

Las animaciones se generan mediante IA y normalmente se exportan en MP4.

Se recomienda integrar **FFmpeg** dentro del programa externo o backend para convertir automáticamente esos MP4 al formato utilizado por Rulo.

FFmpeg debe utilizarse principalmente durante:

```text
importación
preparación
conversión
normalización
```

No debería dependerse de conversiones pesadas durante una transmisión en vivo.

---

# 5. Flujo de importación de una nueva animación

Desde el panel se debería poder seleccionar o arrastrar un MP4 nuevo.

Ejemplo:

```text
Dormir_Roncar_Nuevo.mp4
```

El usuario debería seleccionar información como:

```text
Nombre:
Dormir_Roncar_02

Familia:
Dormir

Pose inicial:
Dormido_A

Pose final:
Dormido_A

Loop:
No

Interrumpible:
No

Peso:
10

Prioridad:
1

Cooldown:
30 segundos
```

El sistema debería hacer automáticamente:

```text
1. Recibir MP4
2. Validar archivo
3. Ejecutar FFmpeg
4. Normalizar resolución
5. Normalizar FPS
6. Convertir a WebM VP9
7. Eliminar audio si no es necesario
8. Aplicar transparencia si corresponde
9. Guardar en la carpeta correcta
10. Actualizar metadatos
11. Dejar la animación disponible inmediatamente
```

Ejemplo de destino:

```text
animations/Dormir/Dormir_Roncar_02.webm
```

---

# 6. Normalización automática con FFmpeg

Todas las animaciones deberían seguir un formato estándar.

Ejemplo:

```text
Formato: WebM
Codec: VP9
Resolución: 1920x1080
FPS: 30
Audio: deshabilitado por defecto
Transparencia: cuando corresponda
```

Ejemplo básico:

```bash
ffmpeg -i input.mp4 \
-vf "fps=30,scale=1920:1080" \
-c:v libvpx-vp9 \
-crf 28 \
-b:v 0 \
-an \
output.webm
```

Los parámetros deben estar definidos en configuración y no hardcodeados en muchas partes del programa.

Ejemplo:

```json
{
  "video": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "codec": "libvpx-vp9",
    "crf": 28,
    "audio": false
  }
}
```

---

# 7. Importante sobre resolución y relación de aspecto

FFmpeg no debería deformar a Rulo.

Si los MP4 generados por IA pueden tener relaciones de aspecto diferentes, es preferible utilizar un canvas fijo.

Ejemplo conceptual:

```text
escalar manteniendo proporción
+
rellenar el canvas con transparencia o fondo adecuado
```

En lugar de estirar directamente una imagen.

Todos los archivos finales deberían compartir:

```text
misma resolución
mismo canvas
misma posición base de Rulo
misma escala
mismo punto de referencia
```

Esto es extremadamente importante para evitar saltos visuales entre animaciones.

---

# 8. Transparencia

Para Rulo se recomienda:

```text
WebM
VP9
canal alfa cuando sea necesario
```

Si la IA genera el MP4 con fondo verde, FFmpeg puede utilizar chroma key.

Ejemplo aproximado:

```bash
ffmpeg -i input.mp4 \
-vf "chromakey=0x00FF00:0.12:0.08,format=yuva420p" \
-c:v libvpx-vp9 \
-crf 28 \
-b:v 0 \
-an \
output_transparent.webm
```

La eliminación de fondo debe ser opcional.

Importante:

FFmpeg no puede determinar automáticamente qué fondo debe eliminarse de cualquier MP4 normal.

Si se necesita transparencia, el archivo generado por IA debería idealmente:

- venir con un fondo preparado para eliminar;
- utilizar un color de chroma consistente;
- o pasar antes por un proceso específico de eliminación de fondo.

---

# 9. Guardar los MP4 originales

Se recomienda conservar los MP4 originales generados por IA.

Ejemplo:

```text
source/
│
├── Dormir/
│   ├── Dormir_Roncar_02.mp4
│   └── Dormir_Moverse_03.mp4
│
└── Mate/
    └── Mate_Tomar_03.mp4
```

Los archivos utilizados por el reproductor serían los WebM procesados:

```text
animations/
│
├── Dormir/
│   ├── Dormir_Roncar_02.webm
│   └── Dormir_Moverse_03.webm
│
└── Mate/
    └── Mate_Tomar_03.webm
```

Esto permite volver a procesar una animación en el futuro con nuevos parámetros sin perder el archivo original.

---

# 10. Metadatos de cada animación

Cada archivo debería tener metadatos separados.

Ya no es necesario almacenar:

```text
start
end
```

porque cada animación es un archivo independiente.

Ejemplo:

```json
{
  "Dormir_Roncar_02": {
    "file": "animations/Dormir/Dormir_Roncar_02.webm",
    "family": "Dormir",
    "from": "Dormido_A",
    "to": "Dormido_A",
    "loop": false,
    "weight": 10,
    "interruptible": false,
    "priority": 1,
    "cooldown": 30
  }
}
```

El código debería utilizar:

```javascript
playAnimation("Dormir_Roncar_02");
```

y nunca depender directamente de rutas dispersas o parámetros escritos manualmente en muchas partes del código.

---

# 11. Archivo de configuración

Puede utilizarse:

```text
animations.json
```

o una base de datos equivalente.

Ejemplo:

```json
{
  "Dormir_Respirar_01": {
    "file": "animations/Dormir/Dormir_Respirar_01.webm",
    "family": "Dormir",
    "from": "Dormido_A",
    "to": "Dormido_A",
    "loop": true,
    "weight": 50,
    "interruptible": true
  },

  "Dormir_Roncar_01": {
    "file": "animations/Dormir/Dormir_Roncar_01.webm",
    "family": "Dormir",
    "from": "Dormido_A",
    "to": "Dormido_A",
    "loop": false,
    "weight": 10,
    "interruptible": false
  }
}
```

Idealmente el panel debería modificar estos metadatos automáticamente.

---

# 12. Máquina de estados

El personaje debería manejarse como una máquina de estados.

Ejemplos:

```text
IDLE
DORMIR
MATE
HABLAR
BAILAR
REACCION
ESPECIAL
```

También deberían existir poses o subestados:

```text
Idle_Base
Dormido_A
Dormido_B
Mate_En_Mano
Sentado
De_Pie
```

Cada animación debe conocer:

```text
pose inicial
pose final
```

Ejemplo:

```text
Dormir_Respirar_01
Dormido_A -> Dormido_A

Dormir_Acomodarse_01
Dormido_A -> Dormido_B

Dormir_Respirar_02
Dormido_B -> Dormido_B
```

---

# 13. Regla principal de las animaciones

Toda animación nueva debe tener claramente definida:

```text
Pose inicial
Pose final
```

Ejemplos:

```text
Idle -> Idle
Idle -> Mate_En_Mano
Mate_En_Mano -> Mate_En_Mano
Mate_En_Mano -> Idle
Idle -> Dormido_A
Dormido_A -> Dormido_A
Dormido_A -> Dormido_B
Dormido_A -> Idle
```

Esta regla permitirá encadenar animaciones sin saltos.

---

# 14. Transiciones entre poses

Si dos animaciones no tienen poses compatibles, debe existir una animación de transición.

Ejemplo:

```text
Idle
↓
Dormir_Entrada_01
↓
Dormido_A
```

Luego:

```text
Dormido_A
↓
Dormir_Acomodarse_01
↓
Dormido_B
```

Y para despertar:

```text
Dormido_B
↓
Dormir_Salida_02
↓
Idle
```

Nunca saltar directamente entre poses incompatibles si el cambio visual resulta evidente.

---

# 15. Sistema de cola de acciones

Si Rulo está realizando una animación y se solicita otra acción:

```text
Animación actual:
Mate_Tomar_01

Usuario pulsa:
Dormir
```

el sistema debería poder hacer:

```text
Mate_Tomar_01
↓
termina
↓
Mate_Dejar_01
↓
Idle
↓
Dormir_Entrada_01
↓
Dormir
```

Las acciones pueden almacenarse en una cola.

Ejemplo:

```text
Saludar
Tomar Mate
Dormir
```

---

# 16. Animaciones interrumpibles

Agregar:

```text
interruptible: true/false
```

Ejemplo:

```text
Idle_Respirar_01
interruptible = true

Mate_Agarrar_01
interruptible = false

Dormir_Entrada_01
interruptible = false
```

Esto evita cortar movimientos importantes por la mitad.

---

# 17. Variantes para mayor naturalidad

Dentro de una carpeta pueden existir varias animaciones para un mismo comportamiento.

Ejemplo:

```text
Dormir/
│
├── Dormir_Respirar_01.webm
├── Dormir_Respirar_02.webm
├── Dormir_Respirar_03.webm
├── Dormir_Roncar_01.webm
├── Dormir_Roncar_02.webm
├── Dormir_Moverse_01.webm
└── Dormir_Acomodarse_01.webm
```

El sistema debe seleccionar variantes automáticamente.

---

# 18. Aleatoriedad ponderada

No utilizar una probabilidad completamente uniforme.

Ejemplo:

```text
Dormir_Respirar_01 = peso 50
Dormir_Respirar_02 = peso 40
Dormir_Moverse_01  = peso 15
Dormir_Roncar_01   = peso 5
```

Así las animaciones normales aparecen más seguido que las especiales.

---

# 19. Evitar repeticiones

Guardar historial reciente:

```text
recentAnimations
```

Ejemplo:

```json
[
  "Dormir_Respirar_01",
  "Dormir_Moverse_01",
  "Dormir_Respirar_02"
]
```

Evitar seleccionar nuevamente las últimas 1, 2 o 3 animaciones cuando existan alternativas compatibles.

---

# 20. Cooldowns

Algunas animaciones deben tener cooldown.

Ejemplo:

```text
Dormir_Roncar_01:
cooldown = 30 segundos

Reaccion_Susto_01:
cooldown = 20 segundos
```

Esto ayuda a que Rulo parezca menos mecánico.

---

# 21. Problema actual: microcorte al cambiar animación

Actualmente OBS solamente muestra una URL mediante Browser Source.

Por lo tanto, si Rulo desaparece algunos milisegundos al cambiar de animación, probablemente el problema ocurre dentro del reproductor web.

Flujo problemático:

```text
1. ocultar video actual
2. cambiar src
3. cargar archivo nuevo
4. esperar decodificación
5. play()
6. mostrar
```

Durante los pasos intermedios puede no haber ningún video visible.

---

# 22. Solución principal: Double Buffering

Utilizar dos elementos `<video>` superpuestos.

Ejemplo:

```html
<div id="rulo-container">
    <video id="videoA"></video>
    <video id="videoB"></video>
</div>
```

Funcionamiento:

```text
Video A:
visible y reproduciendo

Video B:
oculto y preparando la siguiente animación
```

Cuando se necesita cambiar:

```text
1. asignar nuevo archivo a Video B
2. cargarlo
3. esperar que tenga datos suficientes
4. iniciar play()
5. confirmar que puede mostrar un frame
6. mostrar Video B
7. ocultar Video A
8. intercambiar A/B
```

---

# 23. Nunca ocultar primero el video actual

Evitar:

```text
hide(A)
load(B)
play(B)
show(B)
```

Utilizar:

```text
load(B)
waitUntilReady(B)
play(B)
waitUntilPlaying(B)
show(B)
hide(A)
```

Incluso puede mantenerse A y B superpuestos durante uno o dos frames si las poses coinciden.

---

# 24. Eventos útiles del reproductor

Considerar:

```text
loadedmetadata
loadeddata
canplay
canplaythrough
playing
ended
timeupdate
error
```

Como cada animación ahora es un archivo independiente, normalmente ya no será necesario hacer `seek` a posiciones internas.

Esto simplifica considerablemente la reproducción.

---

# 25. Precarga

Las animaciones más probables pueden precargarse.

Ejemplo:

Mientras Rulo reproduce:

```text
Dormir_Respirar_01
```

el segundo reproductor puede preparar:

```text
Dormir_Respirar_02
```

o la próxima animación elegida por el motor de comportamiento.

Cuando termina la actual, la siguiente ya está lista.

---

# 26. Caché

Aprovechar la caché del navegador para evitar recargar constantemente los mismos WebM.

Las animaciones frecuentes deberían permanecer disponibles rápidamente.

Evitar invalidar la caché innecesariamente.

---

# 27. Keyframes

Los keyframes siguen siendo útiles, pero son menos críticos que en la arquitectura anterior.

Como cada animación comienza desde el inicio de su propio archivo WebM:

```text
0.0 segundos
```

el reproductor no necesita buscar constantemente posiciones internas de un archivo grande.

De todas formas, se recomienda que el archivo tenga un keyframe al comienzo, algo natural en una codificación correcta.

---

# 28. Mantener el mismo FPS

Todas las animaciones deben compartir el mismo FPS.

Ejemplo:

```text
30 FPS
```

FFmpeg puede normalizar automáticamente estos valores durante la importación.

---

# 29. Mantener la misma posición de Rulo

Todas las animaciones deberían generarse o procesarse de forma que Rulo se encuentre exactamente en la misma posición base.

Esto incluye:

```text
coordenadas
escala
tamaño
canvas
punto de apoyo
altura
```

El último frame de una animación compatible debe coincidir visualmente con el primer frame de la siguiente.

---

# 30. Organización de nombres

Usar nombres consistentes.

Formato recomendado:

```text
Familia_Accion_Numero.webm
```

Ejemplos:

```text
Dormir_Entrada_01.webm
Dormir_Entrada_02.webm
Dormir_Respirar_01.webm
Dormir_Respirar_02.webm
Dormir_Roncar_01.webm

Mate_Agarrar_01.webm
Mate_Tomar_01.webm
Mate_Tomar_02.webm
Mate_Dejar_01.webm
```

Evitar nombres ambiguos como:

```text
video1.webm
nuevo2.webm
final-final.webm
test3.webm
```

---

# 31. Panel de importación recomendado

El panel podría tener una sección:

```text
IMPORTAR ANIMACIÓN
```

Campos:

```text
Archivo MP4
Nombre
Familia
Pose inicial
Pose final
Loop
Interrumpible
Peso
Prioridad
Cooldown
Eliminar fondo: Sí/No
Color de chroma
```

Botón:

```text
Procesar e importar
```

Después mostrar:

```text
✓ Conversión FFmpeg completada
✓ WebM generado
✓ Guardado en animations/Dormir/
✓ Metadatos actualizados
✓ Disponible para Rulo
```

---

# 32. FFmpeg debe ejecutarse fuera del navegador

Si la aplicación tiene:

```text
Node.js
Python
C#
Electron
backend propio
```

ese componente puede llamar al ejecutable FFmpeg.

La Browser Source de OBS no debería intentar ejecutar `ffmpeg.exe`.

La arquitectura debe ser:

```text
Programa externo / backend
↓
FFmpeg
↓
archivos WebM
↓
servidor / aplicación web
↓
Browser Source
```

---

# 33. Validaciones durante la importación

Antes de aceptar un archivo, comprobar:

```text
archivo válido
duración válida
resolución
FPS
codec
tamaño
existencia de video
ruta de salida
nombre duplicado
```

---

# 34. Procesamiento temporal seguro

Durante la conversión:

```text
input.mp4
↓
archivo temporal
↓
FFmpeg
↓
validación
↓
mover a carpeta definitiva
```

Ejemplo:

```text
temp/Dormir_Roncar_02.processing.webm
```

y después:

```text
animations/Dormir/Dormir_Roncar_02.webm
```

Esto evita archivos corruptos si FFmpeg falla.

---

# 35. No modificar archivos utilizados en vivo

Si Rulo está utilizando:

```text
Dormir_Respirar_01.webm
```

no sobrescribir ese mismo archivo mientras está activo.

Procesar el nuevo archivo, validarlo y reemplazarlo cuando no esté siendo usado.

---

# 36. Mantener Idle como fallback

Siempre debe existir una animación segura:

```text
Idle_Default.webm
```

Si ocurre un error:

```text
archivo inexistente
FFmpeg falló
video no carga
animación incompatible
error de reproducción
```

el sistema debe volver a:

```text
Idle_Default
```

Nunca dejar a Rulo completamente invisible.

---

# 37. Manejo de errores del reproductor

Ejemplo conceptual:

```javascript
try {
    await playAnimation(nextAnimation);
} catch (error) {
    await playAnimation("Idle_Default");
}
```

Además:

- registrar el error;
- no romper la cola completa;
- evitar que ambos videos queden ocultos;
- informar al panel si un archivo está dañado o no disponible.

---

# 38. Reutilización dentro de OBS

Como OBS solamente muestra la página de Rulo, se recomienda mantener una única instancia de esa Browser Source siempre que sea posible.

Una opción es crear:

```text
Escena: RULO
```

y reutilizar esa escena dentro de otras escenas de OBS.

---

# 39. Evitar recargas de Browser Source

Revisar configuraciones de OBS relacionadas con:

```text
Shutdown source when not visible
Refresh browser source when scene becomes active
```

Si el objetivo es mantener vivo el sistema de Rulo entre escenas, evitar configuraciones que provoquen una recarga completa de la aplicación web.

---

# 40. Scheduler de comportamiento

A futuro puede existir un scheduler que genere comportamientos automáticos.

Ejemplo:

```text
Idle
↓
esperar tiempo aleatorio
↓
Idle_Mirar_Izquierda_01
↓
Idle
↓
esperar
↓
Idle_Pestanear_01
↓
Idle
```

Así Rulo puede parecer vivo incluso sin intervención.

---

# 41. Selección contextual

A futuro, el sistema puede seleccionar animaciones según:

```text
estado actual
pose actual
acción solicitada
historial reciente
prioridad
cooldown
familia
probabilidad
```

Ejemplo:

```text
estado = Dormir
pose = Dormido_A
```

Solo seleccionar animaciones donde:

```text
from = Dormido_A
```

---

# 42. Prioridades

Se puede utilizar:

```text
Idle = 0
Gestos = 1
Mate = 2
Dormir = 2
Reacciones = 3
Eventos especiales = 5
```

Cada acción puede decidir:

```text
esperar
interrumpir
reemplazar
descartar
```

según la prioridad y si la animación actual es interrumpible.

---

# 43. Protección contra comandos repetidos

Si se pulsa repetidamente:

```text
Dormir
Dormir
Dormir
Dormir
```

evitar añadir cuatro acciones idénticas a la cola.

Utilizar:

```text
debounce
deduplicación
cooldown
```

---

# 44. Recomendaciones para generar nuevas animaciones con IA

Cada nueva animación debería diseñarse pensando en el sistema.

Intentar mantener:

```text
misma cámara
mismo encuadre
misma iluminación
misma escala
misma posición del personaje
mismo FPS objetivo
misma resolución objetivo
```

Además:

- Evitar movimientos involuntarios de cámara.
- Evitar zooms si la animación debe conectarse con otra.
- El primer frame debe parecerse a la pose inicial definida.
- El último frame debe coincidir con la pose final.
- Las transiciones importantes deberían tener clips propios.
- Mantener las animaciones modulares facilita combinarlas.

---

# 45. Crear animaciones modulares

Ejemplo para dormir:

```text
Dormir_Entrada_01
Dormir_Entrada_02

Dormir_Respirar_01
Dormir_Respirar_02
Dormir_Respirar_03

Dormir_Roncar_01
Dormir_Roncar_02

Dormir_Moverse_01
Dormir_Acomodarse_01

Dormir_Salida_01
Dormir_Salida_02
```

Esto permite construir secuencias diferentes:

```text
Entrada_01
↓
Respirar_02
↓
Respirar_01
↓
Moverse_01
↓
Respirar_03
↓
Roncar_01
↓
Respirar_02
↓
Salida_02
```

---

# 46. Arquitectura final recomendada

```text
                         PANEL EXTERNO
                              │
                ┌─────────────┴─────────────┐
                │                           │
          IMPORTADOR                   MOTOR DE ESTADOS
                │                           │
              FFmpeg                 COLA / SCHEDULER
                │                           │
                ▼                           ▼
      animations/<familia>/          SELECTOR DE ANIMACIÓN
                │                           │
                └─────────────┬─────────────┘
                              ▼
                       DOUBLE BUFFER
                      VIDEO A / VIDEO B
                              │
                              ▼
                         PÁGINA WEB
                              │
                              ▼
                      OBS BROWSER SOURCE
```

---

# 47. Prioridades de implementación

## Prioridad alta

1. Cambiar organización a carpetas y archivos WebM independientes.
2. Integrar FFmpeg en el programa externo/backend.
3. Crear importador de MP4.
4. Normalizar FPS/resolución/codec.
5. Crear metadatos por animación.
6. Implementar double buffering.
7. Nunca ocultar el video actual antes de que el nuevo esté listo.
8. Mantener poses inicial/final.
9. Mantener Idle como fallback.

## Prioridad media

1. Cola de acciones.
2. Variantes aleatorias.
3. Pesos.
4. Historial anti-repetición.
5. Cooldowns.
6. Prioridades.
7. Animaciones interrumpibles.
8. Precarga inteligente.

## Futuro

1. Scheduler automático.
2. Selección contextual avanzada.
3. Comportamientos autónomos.
4. Reacciones a eventos del stream.
5. Sistema visual para administrar poses y compatibilidades.
6. Previsualización de transiciones desde el panel.

---

# 48. Resultado esperado

El flujo ideal debería ser:

```text
1. Genero una animación nueva con IA.
2. Obtengo un MP4.
3. Lo arrastro al panel.
4. Selecciono la familia.
5. Defino pose inicial y final.
6. Configuro loop, peso, prioridad, etc.
7. El programa ejecuta FFmpeg.
8. Convierte y normaliza automáticamente.
9. Guarda el WebM en su carpeta.
10. Actualiza los metadatos.
11. La animación queda disponible para Rulo.
```

Ejemplo:

```text
MP4:
Dormir_Roncar_Nuevo.mp4

↓

FFmpeg

↓

animations/Dormir/Dormir_Roncar_02.webm

↓

animations.json actualizado

↓

Disponible inmediatamente desde:

playAnimation("Dormir_Roncar_02")
```

---

# 49. Resumen para el desarrollador

La arquitectura final elegida es:

```text
NO utilizar un WebM grande por familia.

Utilizar:

una carpeta por familia
+
un WebM independiente por animación
+
FFmpeg para importar MP4 generados por IA
+
normalización automática
+
metadatos
+
máquina de estados
+
poses inicial/final
+
double buffering
+
precarga
+
cola de acciones
+
aleatoriedad ponderada
+
historial anti-repetición
+
cooldowns
```

Ejemplo:

```text
animations/
└── Dormir/
    ├── Dormir_Entrada_01.webm
    ├── Dormir_Entrada_02.webm
    ├── Dormir_Respirar_01.webm
    ├── Dormir_Respirar_02.webm
    ├── Dormir_Roncar_01.webm
    ├── Dormir_Moverse_01.webm
    ├── Dormir_Acomodarse_01.webm
    ├── Dormir_Salida_01.webm
    └── Dormir_Salida_02.webm
```

El punto principal para solucionar el microcorte sigue siendo:

```text
NO ocultar el video actual primero.

Cargar siguiente WebM
→ esperar que esté listo
→ reproducirlo
→ confirmar que tiene frame visible
→ mostrarlo
→ ocultar el anterior
→ intercambiar reproductores
```

Con esta arquitectura agregar nuevas animaciones será mucho más simple y no requerirá reconstruir videos grandes ni administrar rangos de segundos.
