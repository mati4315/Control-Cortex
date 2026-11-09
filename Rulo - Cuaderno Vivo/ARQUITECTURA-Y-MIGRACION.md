# Arquitectura y migración de Rulo · Cuaderno Vivo

## Estado de implementación (2026-11-08)

- Creado el módulo lógico, su perfil estructurado, el motor de cuatro tonos, el control Automático/Manual persistente y un dashboard local servido por Cortex.
- Importados snapshots versionados de la instrucción general actual y de las variantes de respuesta Spotify. Los archivos de origen siguen intactos y son la fuente activa para el vivo.
- Conectada la opción de vista previa de Cuaderno Vivo al simulador aislado `/rulo-hablar.html`. La vista previa usa el nuevo perfil; el chat público y el flujo de Spotify no se migraron.
- Implementada memoria local revisable por identidad estable: almacenamiento SQLite separado, hash HMAC de identidad, alta/corrección/borrado desde el dashboard, propuestas basadas en el archivo público y recuperación de contexto solo en la simulación aislada.
- El historial de audiencia sigue en su SQLite actual y no se duplica. No se guardan conversaciones privadas del simulador, no hay aprendizaje automático y ninguna propuesta de IA se persiste sin acción del operador.
- Pendientes: ingesta de señales reales de carga, editor/compatibilidad del catálogo, memoria general del programa, fuente verificable del rol administrativo, migración del generador público e intervenciones espontáneas.

## Recomendación

Conviene que **Cuaderno Vivo sea el lugar único que define cómo habla Rulo y cómo usa su memoria**, pero no conviene mover de una vez todo lo que actualmente procesa comentarios, controla Spotify o guarda el archivo de audiencia.

La separación recomendada es:

- **Cuaderno Vivo:** identidad, instrucciones de estilo, catálogo de respuestas, armado del contexto, resúmenes y recuerdos por participante, memoria de conversaciones administrativas verificadas, generación de texto y revisión de propuestas inciertas.
- **Rulo / Control Cortex:** recepción de comentarios, identidad y archivo de audiencia, entrega de mensajes al historial y overlay, animaciones y permisos generales.
- **Chat Bot Spotify:** detección de pedidos musicales, parser, búsqueda, cooldowns, cola de reproducción, OAuth y confirmación de resultados reales.
- **Otros dominios** (por ejemplo, la Ruleta): conservan sus propios permisos, datos y reglas. Cuaderno Vivo solo recibe los hechos públicos y verificados que necesite para expresarse.

La IA puede elegir las palabras, pero el módulo que conoce cada dominio conserva la autoridad sobre los hechos y las acciones. Así una respuesta más natural no puede transformar un error de Spotify en un éxito ni una pregunta en una reserva de lotería.

## Qué sí conviene centralizar

### Perfil e instrucciones de estilo

Mover gradualmente a Cuaderno Vivo las instrucciones generales sobre personalidad: tono, variedad regional, extensión, humor, expresiones preferidas y límites. El perfil debería estar dividido en campos legibles y tener versión, en vez de crecer como un prompt único y difícil de revisar.

Preferencias confirmadas para el perfil: más entrerriano/argentino, informal, curioso y pícaro, con humor negro ocasional. Las instrucciones finales deben conservar un tono respetuoso y excluir ese humor en contextos sensibles o dirigido contra personas vulnerables.

Las preferencias actuales de estilo de Rulo Spotify son parte de la configuración vigente y se deben importar sin perderlas. La migración no debería cambiar cómo habla Rulo en el vivo hasta que el resultado sea aprobado.

#### Sistema de tono en cuatro niveles

El perfil tendrá un selector de tono administrable, con **Nivel 2: Normal** como valor predeterminado al iniciar:

| Nivel | Estado | Efecto de estilo |
| --- | --- | --- |
| 1 | Contento | Más cálido, amable, entusiasta y paciente. |
| 2 | Normal | Equilibrado; conserva el tono base habitual de Rulo. |
| 3 | Enojado | Más seco y firme, con menos paciencia, sin descargar el enojo contra la persona. |
| 4 | Muy enojado | Enojo de personaje más visible y respuestas contundentes, sin perder el respeto básico. |

Estos niveles son una actuación de tono, no emociones reales ni memoria. Todo se administra desde el dashboard. El modo automático será el comportamiento normal: empieza en Nivel 2 y ajusta el tono según un puntaje de carga; el modo manual permite a un administrador verificado elegir cualquiera de los cuatro niveles. La selección manual no vence por tiempo. Mientras Manual esté activo, el puntaje continúa visible, pero no modifica la selección hasta que el operador vuelva explícitamente a Automático. La simulación prueba ambos modos sin alterar el estado del chat real.

El nivel modifica la redacción; no altera permisos, hechos, decisiones, frecuencia de respuesta ni acciones de Spotify, OBS o la Ruleta. Ningún nivel permite amenazas, discriminación, humillación o insultos dirigidos. El puntaje representa carga global, no culpa de las personas: un pedido aislado o una provocación del público no debe elevarlo por sí solo. Los tonos enojados no se aplican a situaciones sensibles. Al iniciar, el modo automático parte de **Normal (2)**.

Para reducir duplicación y deriva de personalidad, es preferible conservar un perfil base y aplicar cambios pequeños a rasgos explícitos —calidez, paciencia, energía y contundencia— en lugar de mantener cuatro prompts independientes. Los números son rótulos de interfaz, no una escala ordinal; internamente conviene representar los estados con claves (`contento`, `normal`, `enojado`, `muy_enojado`) y no interpolar el tono mediante operaciones con los números.

El dashboard debe mostrar modo, nivel activo, puntaje, tendencia y motivos desglosados, con controles para cambiar de modo, seleccionar el nivel manual y volver a Automático/Normal. La selección afecta respuestas nuevas. El puntaje se basa en carga medible: pedidos aceptados y pendientes, su antigüedad, tasa de llegada frente a resolución y fallos o atascos operativos. Solo cuentan solicitudes que crean trabajo; la charla general no suma por sí sola. Medir la demanda agregada por ventanas de tiempo evita que una persona sea culpada y ayuda a distinguir actividad normal de saturación. Cada evento suma como máximo una vez; refrescar el panel no lo vuelve a contar. Resolver pedidos reduce carga.

Como escala inicial para probar, se propone un puntaje acotado de **0 a 40**: 0–9 corresponde al Nivel 1, 10–19 al Nivel 2, 20–29 al Nivel 3 y 30–40 al Nivel 4. Al iniciar, el modo automático parte de **10 puntos / Nivel 2: Normal**. Los pedidos nuevos pueden sumar carga; una espera excesiva o un atasco puede añadir puntos extra una sola vez; resolver pedidos reduce el puntaje. Si no queda trabajo pendiente ni en curso, la carga baja paulatinamente —por ejemplo, un punto por intervalo de descanso— hasta llegar a cero. Estos pesos, intervalos y el límite sirven como base de calibración, no como valores finales.

Al llegar a cero, Rulo queda en Nivel 1. La animación de sueño ya existe en el módulo de la mascota y entra después de su temporizador de inactividad; Cuaderno Vivo debe reutilizar esa lógica, sin crear un segundo temporizador. El puntaje puede seguir bajando mientras la animación duerme. Cuando llega trabajo nuevo, el controlador actual lo despierta y el puntaje vuelve a subir. Para evitar oscilaciones, las transiciones deben tener estabilidad o histéresis: el umbral para volver a un nivel menos enojado puede ser distinto del umbral de subida. El modelo puede explicar o sugerir, pero el nivel automático final depende de señales y reglas auditables. Los pesos, umbrales y recuperación se calibran en simulación antes de afectar el vivo.

Durante una selección Manual, mostrar también el nivel que habría seleccionado Automático según el puntaje presente. Así el retorno al modo automático es previsible. Guardar un registro técnico breve de los cambios de estado (momento, modo, nivel anterior/nuevo y motivo técnico o selección manual); no copiar comentarios del público al registro.

### Respuestas redactadas y variantes

Cuaderno Vivo puede ser dueño del catálogo de frases y de la redacción para situaciones como respuesta aceptada, espera, error o falta de dispositivo. Para que siga siendo ordenado, cada contexto se identifica por dominio, por ejemplo `spotify.ok`, `spotify.wait_user` o `chat.casual`.

El dominio que originó el contexto sigue enviando un resultado verificable y una lista pequeña de datos permitidos. Por ejemplo, Spotify puede enviar `contexto=spotify.ok`, el nombre de la persona, el tema y el artista **después** de verificar la reproducción. Cuaderno Vivo redacta la frase; no decide que el contexto era correcto.

También se pueden centralizar la selección aleatoria, la prevención de repeticiones y el fallback a variantes guardadas. Las respuestas de progreso que no deben demorar la operación (como «estoy buscando») pueden seguir siendo mensajes breves locales o tener una ruta rápida sin consulta de IA.

### Construcción de contexto conversacional

Tiene sentido centralizar la política que determina qué conversación reciente puede acompañar una respuesta: límite de cantidad y antigüedad, exclusión de alertas y pruebas, y filtro de relevancia.

No hace falta trasladar ni duplicar el historial original. La fuente permanente sigue siendo la base de audiencia existente; Cuaderno Vivo consulta únicamente el fragmento mínimo aprobado para la respuesta actual. En la implementación actual de respuestas dinámicas de Spotify, Cortex reúne hasta ocho comentarios/respuestas recientes de la ventana de los últimos ocho minutos. Ese comportamiento debe revisarse y hacerse configurable antes de reutilizarlo para otros contextos.

### Recuerdos y revisión de propuestas

Como diseño de destino, Cuaderno Vivo debería ser dueño de los resúmenes conversacionales, recuerdos por participante, notas del programa, notas de emisión y memoria derivada de conversaciones administrativas verificadas. La preferencia actual es no hacer vencer esos recuerdos al principio. El sistema debe permitir corregirlos y borrarlos, y dejar preparado el campo de expiración para agregar más adelante políticas de retención. La primera etapa de memoria ya permite recuerdos manuales y propuestas revisables por participante; no implementa resúmenes automáticos, notas de programa ni aprendizaje administrativo.

Los mensajes administrativos operativos del chat real podrán ser una fuente acotada de contexto cuando exista una verificación de rol e identidad estable. La captura revisada hoy no entrega esa verificación a Cuaderno Vivo, por lo que esa ingesta está desactivada. Cuando se implemente, solo se clasificarán como memoria hechos o instrucciones duraderos y relevantes; la charla casual o ambigua no se guardará como conocimiento estable. Los cambios a la personalidad base y reglas generales requieren una acción explícita y revisión. Los datos privados o internos no se comparten con el chat público salvo que tengan un ámbito público aprobado.

### Simulación privada y solicitudes explícitas de mejora

En **Simular Streaming en VIVO** el administrador conversa con Rulo y puede seleccionar participantes históricos para representar distintos escenarios. Ese chat es temporal y aislado: no debe alimentar la memoria privada del administrador ni la memoria del participante seleccionado, ni el historial real, la Ruleta o el entrenamiento.

La recomendación es **conservar el simulador actual** (`/rulo-hablar.html`) como interfaz de prueba; no crear otra conversación simulada. Es parte de la migración como consumidor y banco de evaluación: sus respuestas pueden usar Cuaderno Vivo al seleccionarlo en la vista previa, mientras se mantienen sus controles, archivo de programas y garantías de aislamiento actuales. Allí se prueban los cuatro tonos; las respuestas del chat público siguen con el motor actual hasta que la migración se valide. Los controles del dashboard y los ajustes de prueba son independientes. Los casos y correcciones siguen el flujo de revisión manual existente.

El comportamiento previsto es que, si el administrador pide explícitamente mejorar una respuesta o regla, Rulo trabaje de inmediato dentro de esa misma simulación y presente una versión revisada para el caso, sin pedir otra confirmación para iniciar. Esa detección y propuesta dentro de la conversación todavía no están implementadas. Si se quiere conservar una mejora para el módulo, se prepara para el flujo manual de revisión y guardado de Entrenamiento e IA. La simulación no modifica por sí sola el perfil persistente ni entrena el modelo.

En el diseño futuro, los resúmenes de participantes podrán guardarse automáticamente para sostener la continuidad. Hoy las propuestas generadas desde comentarios públicos requieren guardado manual; las memorias ambiguas, sensibles o de baja confianza deben quedar apartadas o pendientes de revisión. Esto no entrena ni modifica el modelo.

La memoria semántica nueva no debe convertirse en una segunda copia de todos los comentarios. Si necesita relacionar un recuerdo con una participación archivada, conservará una referencia interna controlada; el prompt de IA recibe solo el hecho resumido que necesita, nunca tokens ni identificadores privados.

## Ideas para sostener continuidad sin perder control

### Separar archivo, memoria y contexto de respuesta

No conviene guardar todo en una sola memoria gigante. Mantener tres niveles distintos:

1. **Archivo original:** comentarios y respuestas conservados por el sistema de audiencia actual. Sigue siendo la evidencia histórica y no se copia entero al módulo nuevo.
2. **Memoria duradera:** recuerdos y resúmenes por participante, temas recurrentes, datos del programa y aprendizajes de administradores. Por decisión actual no vencen al principio; se pueden corregir y borrar, y el esquema deja preparada la expiración futura.
3. **Contexto de turno:** un paquete breve que se construye para responder al comentario actual: perfil de Rulo, estado de la emisión y solo los recuerdos relevantes.

Así se puede conservar continuidad de largo plazo sin volver a enviar todas las conversaciones al modelo cada vez.

### Guardar recuerdos con procedencia y estado

Conviene registrar cada recuerdo como una unidad pequeña y rastreable, no solo como una frase extensa de resumen. Cada unidad debería diferenciar:

- qué se recuerda y sobre quién o qué;
- si lo dijo la propia persona, un administrador verificado o lo resumió la IA;
- cuándo se observó y qué conversación o evento lo respalda;
- si es una preferencia declarada, un hecho confirmado, un tema pendiente o una inferencia;
- a quién se puede mostrar: solo Rulo/administración o también el chat;
- si está vigente, fue corregido o reemplazado por un dato posterior.

Los resúmenes pueden facilitar la lectura, pero no sustituyen el origen ni convierten una inferencia en un hecho. Si dos recuerdos chocan, Rulo debería reconocer la incertidumbre o preferir una corrección explícita y más reciente, no combinar ambos inventando una tercera versión.

### Actualizar memoria sin demorar la respuesta

La respuesta en vivo no debería esperar a que se procese todo el historial. Primero se atiende el comentario con el contexto disponible; después, en una tarea breve o al cerrar una emisión, se resumen las nuevas interacciones y se actualizan los recuerdos pertinentes. Si hay dudas importantes, se generan propuestas para revisión en lugar de guardarlas como hechos.

Esto separa dos trabajos: **conversar ahora** y **ordenar lo aprendido**. También permite evitar llamadas de IA por cada comentario y reducir duplicados.

### Recuperar contexto por relevancia

Para la primera versión bastaría con memoria estructurada y búsqueda local por identidad, tema y palabras clave. No hace falta añadir embeddings o una base vectorial hasta que pruebas reales demuestren que la búsqueda local no encuentra recuerdos útiles.

El contexto de una respuesta puede combinar la pregunta actual con algunos recuerdos pertinentes —por ejemplo, una preferencia expresada y un tema pendiente— y el resumen breve de la emisión. El límite exacto se configura y se mide en pruebas; no se fija ahora un número rígido de recuerdos.

### Permitir correcciones y callbacks naturales

Rulo puede usar recuerdos para dar continuidad, pero no debería mencionar un recuerdo solo para demostrar que lo guarda. Conviene priorizar callbacks cuando ayuden a responder, preguntar si la persona quiere retomar un tema y aceptar correcciones como «eso ya cambió» o «no era yo».

Una corrección explícita debe actualizar o marcar el recuerdo anterior como corregido, mantener la procedencia y evitar que el resumen viejo reaparezca como verdad actual. El diseño también debe contemplar borrar recuerdos de una persona sin eliminar el archivo histórico completo, salvo que el usuario lo solicite mediante el mecanismo correspondiente.

### Mantener separadas memoria administrativa y pública

Los mensajes administrativos operativos del chat real pueden ser fuente de memoria si el rol y la identidad estable están verificados y el contenido expresa hechos o instrucciones duraderos y relevantes. La charla casual no se transforma automáticamente en memoria. Una nota sobre el guion puede servirle a Rulo; una conversación privada sobre operaciones no debe aparecer en el chat público. Las solicitudes explícitas para mejorar una respuesta o regla se hacen desde **Simular Streaming en VIVO**: Rulo trabaja enseguida en una versión revisada dentro de la prueba y cualquier cambio persistente pasa por revisión y guardado manual. El chat general en vivo no sirve para cambiar personalidad o entrenamiento.

## Criterios adicionales de diseño

- En el chat de simulación, Rulo responde a quien conversa con él; en el vivo real, las respuestas espontáneas son una opción independiente y no deben confundirse con el comportamiento de prueba.
- La intervención espontánea debe tener interruptor propio, límites globales y por participante, y opciones para no repetir el mismo tema o responder varias veces seguidas a la misma persona.
- El sistema de tonos se configura en el dashboard. Automático parte de Normal (2); Manual permite forzar cualquiera de los cuatro niveles y tiene prioridad mientras esté seleccionado. La simulación mantiene un estado independiente del chat real.
- Evaluar el puntaje automático con picos de pedidos, colas largas, atascos, fallos y recuperación; comprobar deduplicación de eventos, enfriamiento e histéresis, además de respuestas ante provocaciones y temas sensibles. El modo solo debe cambiar la redacción, no los hechos, permisos, frecuencia ni acciones; los resultados quedan pendientes de revisión humana.
- En la evaluación aislada, comparar los cuatro tonos en conversaciones corrientes, provocaciones, temas sensibles e intentos de cambiar las reglas. Verificar que cambie el estilo, pero no los hechos, permisos, seguridad ni acciones; cada resultado queda pendiente de revisión humana.
- El humor negro es ocasional y contextual; se desactiva ante duelo, salud, emergencias, conflictos personales u otros temas sensibles. No se dirige contra quien participa.
- Registrar en el historial si la respuesta usó plantilla o IA y qué clase de contexto la orientó, sin almacenar el prompt entero en telemetría ni exponer recuerdos privados.
- Si la IA o la memoria no están disponibles, Rulo conserva sus respuestas actuales de respaldo y el resto del sistema continúa operando.

## Ideas adicionales a definir

### Control y transparencia de recuerdos

Como los recuerdos no vencen al principio, se puede considerar más adelante una consulta de baja prioridad y solo lectura para que una persona pregunte «¿qué recordás de mí?». La respuesta debe limitarse a los recuerdos propios cuya identidad se pueda verificar de forma estable. Al principio no habría comandos del chat para corregir, borrar o desactivar recuerdos; esas acciones quedan bajo control de administradores autorizados.

El administrador debería poder revisar el origen, alcance y fecha de cada recuerdo; los recuerdos personales no se muestran públicamente solo porque existan en la base. La visibilidad pública y la retención son decisiones separadas.

### Confirmación de una mejora pedida en simulación

Una frase como «Rulo, mejorá esta respuesta» en **Simular Streaming en VIVO** hace que Rulo trabaje en el acto y muestre una respuesta revisada para ese mismo escenario; no se necesita una segunda confirmación para empezar. Esa acción no altera el perfil persistente ni el entrenamiento. Si la propuesta resulta útil, el administrador la guarda manualmente desde el flujo de Entrenamiento e IA, donde puede revisar el caso, la respuesta original y la corrección propuesta.

Esto permite que la conversación de simulación siga temporal y aislada mientras se conserva únicamente la corrección elegida. El chat general en vivo no activa este mecanismo. La solicitud explícita en la conversación es suficiente para que Rulo empiece a trabajar; un botón adicional puede evaluarse más adelante como comodidad de interfaz.

### Diagnóstico útil sin archivar prompts

Para investigar una respuesta incorrecta se puede registrar qué origen de respuesta se usó (plantilla, IA o fallback), el contexto y la versión de estilo/memoria. Guardar referencias técnicas internas, no copiar el prompt completo, el historial crudo ni identificadores privados a la telemetría.

## Qué debe quedarse en cada módulo

| Componente o dato actual | Dueño recomendado | Tratamiento |
| --- | --- | --- |
| Perfil de personalidad e instrucciones generales | Cuaderno Vivo | Migrar y versionar; conservar los valores actuales al importarlos. |
| Variantes de respuesta redactadas por contexto | Cuaderno Vivo | Migrar como contextos con namespace, sin alterar el contenido al principio. |
| Reglas para reconocer pedidos de música | Chat Bot Spotify | Mantener allí; son específicas del dominio musical. |
| IA que interpreta un pedido musical | Chat Bot Spotify / Cortex | Mantener separada de la IA que redacta la personalidad. Puede compartir proveedor, no necesariamente instrucciones, modelo o prioridad. |
| Elección del contexto `ok`, `notFound`, `waitUser`, etc. | Chat Bot Spotify | El módulo Spotify determina el resultado real; Cuaderno Vivo solo recibe el contexto y los hechos verificados. |
| OAuth, cola, búsqueda, dispositivo y reproducción Spotify | Chat Bot Spotify | No mover a Cuaderno Vivo. |
| Comentarios archivados, identidades y avatares | Rulo / SQLite existente | Conservar una sola fuente de verdad; no importar todo el archivo a una nueva base. |
| Política de qué mensajes recientes se comparten con IA | Cuaderno Vivo | Centralizar límites, filtros y minimización; leer desde las fuentes existentes. |
| Respuesta casual opcional y sus límites de frecuencia | Rulo / Cuaderno Vivo | Debe existir un solo coordinador para evitar respuestas duplicadas. Migrar el control de frecuencia cuando se integre. |
| Reproducción de animación y publicación del mensaje | Control Cortex / Rulo | Mantener como entrega; recibir el texto final y su estado. |
| Resumen estadístico del archivo histórico | Asistente IA / consultas existentes | Mantener separado de la memoria conversacional y de la generación de respuestas en vivo. |

## Separar las dos funciones de IA de Spotify

Hoy `Rulo/Spotify/spotify-vocabulary.json` contiene vocabulario de pedidos, ajustes de IA y respuestas. No conviene mover el objeto `ai` entero como una unidad: ahí conviven tareas distintas.

1. **Interpretación musical:** decide si el comentario parece pedir música y qué artista, tema o género parece nombrar. Sigue bajo Chat Bot Spotify y su parser local contrasta la interpretación.
2. **Redacción de Rulo:** expresa el resultado ya decidido con el estilo y el contexto adecuados. Esta parte sí puede migrar a Cuaderno Vivo.

Al separar la configuración, definir campos independientes para endpoint/modelo/instrucciones por tarea, aunque inicialmente se conserve el mismo proveedor. Mantener una sola clave segura en el backend cuando sea posible; nunca guardarla en el JSON servido al navegador ni enviarla al prompt.

## Organización interna posible

La forma concreta queda abierta, pero una estructura inicial podría ser:

```text
Rulo - Cuaderno Vivo/
├── README.md
├── ARQUITECTURA-Y-MIGRACION.md
├── profile.json                       # perfil estructurado y cuatro tonos
├── imports/                           # snapshots de estilo, respuestas y contexto
├── src/index.js                       # estado de tono y constructor de instrucción
├── dashboard/index.html               # control del módulo
└── data/runtime-state.json            # creado localmente; excluido de Git
```

El contenido de `imports/` es de referencia. Los recuerdos y datos personales todavía no se guardan en este módulo. Cuando se incorpore SQLite, se usarán tablas separadas por tipo de dato y consultas parametrizadas.

Un recuerdo podría guardar: `scope`, `subject_ref`, `content`, `source_ref`, `observed_at`, `confidence`, `status`, `visibility`, `expires_at` y fechas de creación/actualización. `expires_at` queda vacío inicialmente y permite añadir expiración en el futuro. Para datos que requieran aprobación, se conservan además el revisor y la fecha de aprobación. Los identificadores de usuario permanecen solo del lado servidor y no pasan al modelo.

## Interfaz entre módulos

Durante la transición se recomienda conservar la ruta existente de respuestas como **fachada de compatibilidad**. Chat Bot Spotify seguirá llamándola con el mismo contrato; Cortex comprobará el origen autorizado y reenviará la tarea al servicio nuevo. El navegador no llama al proveedor de IA ni recibe credenciales.

El contrato conceptual debería separar dos pasos:

1. **Solicitar redacción:** `contexto`, `hechos verificados`, `nombre visible`, `comentario actual`, resúmenes pertinentes y opciones de estilo permitidas.
2. **Registrar resultado:** fuente usada (`plantilla` o `IA`), contexto, si hubo fallback y referencias internas no sensibles para auditoría.

Las tareas sensibles continúan en el módulo que las posee. Por ejemplo, Spotify informa que confirmó una pista; Cuaderno Vivo no recibe permiso para iniciar reproducción. Las notas de administradores solo se comparten públicamente cuando tienen ámbito `programa_compartido` y cumplen la aprobación necesaria.

## Decisión de orden: migrar la base temprano, activar gradualmente

La recomendación es **migrar primero el contenido que define la voz de Rulo, pero no cambiar todavía el flujo del vivo**. No conviene construir muchas funciones nuevas sobre los ajustes antiguos y postergar toda la migración hasta el final: eso duplicaría instrucciones, respuestas y editores, y luego habría que trasladar lo nuevo también. Tampoco conviene cambiar todos los consumidores de una vez.

La distinción clave es entre **mover el contenido** y **cambiar quién lo usa en producción**:

| Elemento | Cuándo llevarlo a Cuaderno Vivo | Cuándo activarlo |
| --- | --- | --- |
| Personalidad e instrucciones de estilo actuales | Al principio, importadas sin reescritura y con versión/procedencia | Tras comparar respuestas y conservar un fallback |
| Plantillas y variantes por situación | Al principio, usando los mismos nombres de contexto y placeholders | Al integrar el primer consumidor, detrás de la ruta de compatibilidad |
| Selección aleatoria, anti-repetición y tono de respuesta | Definir y portar junto al catálogo | Activar solo para un consumidor inicialmente |
| Interpretación de pedidos musicales por IA | No mover como parte de esta migración; solo separar su configuración de la IA redactora | Se queda bajo Chat Bot Spotify |
| Cola/OAuth/búsqueda/verificación de Spotify | No migrar | Se queda bajo Chat Bot Spotify |
| Historial bruto de audiencia | No copiarlo entero a la nueva base | Sigue en su archivo y SQLite actual |
| Resúmenes y recuerdos de participantes | El esquema y el CRUD manual ya existen; las propuestas consultan la fuente con ID estable y requieren guardado manual | La memoria aprobada se incluye solo en la simulación aislada; falta definir una migración de resúmenes históricos |
| Conversaciones administrativas operativas | Definir su clasificación/alcance al principio | Aceptar solo mensajes del chat real con rol e identidad estable verificables y contenido duradero relevante; excluir charla casual de la memoria estable. La solicitud explícita de mejora se limita a la simulación y cualquier cambio persistente requiere revisión/guardado manual |

### Orden de trabajo recomendado

1. **Inventariar y fijar una línea base:** realizado para la instrucción de estilo, los 22 contextos de respuesta y las políticas actuales de contexto. Los snapshots conservan sus fuentes y no reemplazan los archivos originales.
2. **Separar responsabilidades:** perfil y tonos ya están en Cuaderno Vivo; parser, OAuth, cola y reproducción siguen bajo Chat Bot Spotify. La vista previa del nuevo perfil está conectada solo al simulador aislado.
3. **Revisar el catálogo importado:** comparar etiquetas, variantes, placeholders y namespace de cada contexto antes de convertir el snapshot en fuente editable o conectarlo a un consumidor.
4. **Definir memoria segura:** completado para la primera etapa: identidad estable, hash HMAC, procedencia, visibilidad, acceso local, corrección/borrado y campo de expiración futura.
5. **Preparar recuerdos con revisión:** implementado como propuestas no persistentes a partir del archivo público; el operador elige qué guardar. La generación de resúmenes históricos por lote sigue pendiente y no debe duplicar el corpus de comentarios.
6. **Comparar en vista previa aislada:** cotejar salidas nuevas y actuales para los mismos casos. La prueba debe evitar reproducción real de Spotify, historial normal, OBS y Ruleta; los resultados de evaluación siguen pendientes de revisión humana.
7. **Conectar un consumidor con compatibilidad:** empezar por respuestas de Spotify, que seguiría decidiendo el contexto y entregando hechos verificados. La API existente puede conservarse como fachada; si Cuaderno Vivo falla, el consumidor vuelve a las variantes actuales.
8. **Cambiar una sola fuente editable:** cuando el primer consumidor esté validado, el panel escribe en Cuaderno Vivo y los paneles antiguos pasan a usar esa API o quedan temporalmente en solo lectura. Evitar doble escritura y dos fuentes canónicas.
9. **Retirar lo viejo al final:** después de confirmar la estabilidad y tener una vuelta atrás, retirar los bloques de configuración/editor duplicados. Expandir luego el servicio al chat general y a intervenciones espontáneas.

El principio es: **migración de contenido al inicio, cambio de tráfico por etapas, limpieza de legado al final**. La implementación ya fue autorizada; cada cambio sigue limitado a las superficies aisladas hasta resolver comparación y compatibilidad.

## Plan de migración sin doble fuente de verdad

### Etapa 0 — Inventario y línea base

- Mapear todos los campos, paneles, API y consumidores de instrucciones, respuestas, IA y contexto reciente.
- Guardar el estado vigente de perfil y variantes para poder comparar y revertir.
- Definir qué es estilo general y qué es específico de Spotify.
- Confirmar qué respuestas de IA pueden recibir comentarios e historial y qué límites de datos se aplican.

### Etapa 1 — Importación de contenido

- **Parcialmente realizada:** `imports/legacy-style-instruction.json` conserva la instrucción vigente y `imports/spotify-response-catalog.json` contiene los contextos y variantes, con procedencia.
- `profile.json` adapta las preferencias confirmadas a campos estructurados. La vista previa usa ese perfil y deja la instrucción anterior fuera para evitar duplicar o contradecir el estilo.
- Falta portar y revisar selección aleatoria, anti-repetición, placeholders y contratos antes de ofrecer edición o activar consumidores.
- Los módulos viejos siguen siendo fuente activa del vivo; no hay escrituras dobles.

### Etapa 2 — Servicio de respuesta con compatibilidad

- Implementar generación y validación dentro de Cuaderno Vivo, conservando la ruta y el contrato que usan los consumidores actuales.
- Confirmar que los mismos contextos, placeholders, nombre, datos factuales, fallback y límites de longitud siguen funcionando.
- Mantener la clave del proveedor solo en el backend y documentar claramente qué contenido se envía.

### Etapa 3 — Cambiar la fuente editable

- Hacer que los paneles de estilo y respuestas lean/escriban a Cuaderno Vivo.
- Convertir los controles antiguos en enlaces o clientes de esa API, o retirarlos después de una transición confirmada.
- No sincronizar mediante escrituras dobles ni mantener dos copias editables de `spotify-vocabulary.json` y `persona.json`.

### Etapa 4 — Memoria del programa y contexto reciente (parcial)

- Ya está implementado el primer tramo de memoria por participante: SQLite aparte, identidad HMAC, administración en dashboard, propuestas desde comentarios públicos y recuperación solo en la simulación elegida.
- El dashboard puede enviar hasta 120 comentarios y respuestas públicas recientes al proveedor de IA configurado. La IA propone, no guarda; la persona operadora revisa y confirma cada recuerdo.
- Los respaldos incluyen juntos la base de memoria y la clave HMAC. Si falta la clave con la base existente, la memoria queda deshabilitada para preservar los vínculos recuperables.
- Incorporar primero los hechos generales aprobados y una nota por emisión.
- Añadir resúmenes por participante usando identidad estable; conservarlos sin vencimiento al principio y permitir edición/borrado.
- Centralizar el filtro del contexto reciente sin mover ni duplicar el archivo original; recuperar lo relacionado en vez de enviar todo el historial.
- Registrar qué tipo de contexto se utilizó, evitando copiar de nuevo el texto completo al archivo permanente.

### Etapa 5 — Conversaciones administrativas y expansión

- Incluir mensajes del chat real de administradores con rol e identidad estables verificados como fuente acotada de memoria; guardar solo hechos o instrucciones duraderos y relevantes, con ámbito, origen y fecha. Las solicitudes explícitas de mejora se atienden en la simulación y cualquier cambio persistente pasa a revisión manual; el chat general no altera personalidad ni entrenamiento.
- Añadir resúmenes posteriores a la emisión y una cola de revisión para datos ambiguos o cambios de personalidad.
- Incorporar una opción independiente de intervenciones espontáneas con límites configurables para que no responda continuamente.
- Dejar como mejora de baja prioridad una consulta de solo lectura para que cada participante pregunte qué recuerda Rulo de esa persona; exigir identidad verificada y reservar corrección/borrado para administradores autorizados. En la simulación, una petición explícita inicia el trabajo de mejora de inmediato; el guardado permanente sigue siendo manual.
- Probar con el modo aislado y casos guardados, sin reproducir Spotify, escribir en el historial real o tocar la Ruleta.

### Etapa 6 — Retirar compatibilidad antigua

Solo después de verificar consumidores, rutas, documentos y un plan de reversión se podrán retirar los campos duplicados y editores antiguos. No borrar datos ni variantes de origen como parte de la primera migración.

## Validación necesaria antes de dar por migrado

- Respuestas de plantilla siguen siendo correctas si el proveedor está apagado o falla.
- La IA conserva nombres, canción, artista, estado y acciones verificadas; si no puede, se usa fallback.
- Progreso, éxito, error y cooldowns se emiten en el contexto correcto.
- En **Simular Streaming en VIVO**, Rulo responde dentro de la conversación aislada con el participante seleccionado; la intervención espontánea del vivo real es independiente, configurable y limitada por frecuencia.
- Los mensajes privados de simulación no aparecen en la memoria duradera, archivo de audiencia, historial normal, Ruleta ni entrenamiento. Una mejora solicitada explícitamente produce una versión revisada dentro de la prueba; solo la propuesta que un administrador guarde manualmente puede persistir.
- Los resúmenes por participante permanecen aunque cierre la emisión; la futura expiración puede activarse sin cambiar la fuente de los datos.
- Respuestas a un comentario no se duplican entre el camino de Spotify y la charla casual de Rulo.
- El aislamiento de pruebas no escribe en el historial de audiencia, el registro normal ni la Ruleta.
- Los resultados de casos repetibles quedan pendientes de revisión humana; no se aprueban ni entrenan automáticamente.
- Ningún token, ID privado, perfil o nota interna llega al navegador o al prompt.
- Una interrupción del servicio nuevo no impide que los módulos emitan sus respuestas de respaldo.

## Restricciones que no deben cambiar

- Conservar el OAuth propio y la cola local serializada de Chat Bot Spotify. No reemplazar la confirmación de reproducción por un HTTP 204 ni por `PUT /me/player/play`.
- No volver a dirigir pedidos nuevos a la cola antigua de SocialStream Ninja.
- No fusionar participantes solo por nombre ni completar `ID_facebook` sin fuente verificada.
- Mantener secretos en el servidor, CORS/WebSocket con orígenes exactos y las rutas autenticadas de Cortex.
- No guardar texto de comentarios, nombres, IDs, URLs de perfil o tokens en telemetría de `/api/event-traces`.
- En simulación histórica, mantener Spotify aislado según el modo seleccionado, lotería estrictamente de solo lectura y entrenamiento siempre manual.

## Referencias para la migración

- [Instrucciones generales](../AGENTS.md)
- [Diseño y contexto del módulo](README.md)
- [README de Rulo](../Rulo/README.md)
- [README de Spotify/Rulo](../Rulo/Spotify/README.md)
- [Simulación y evaluación de Rulo](../Rulo/README-SIMULACION-VIVOS.md)
- [Catálogo de respuestas por contexto](../Control%20Cortex/backend/spotify-responses.js)
- [API y contexto de IA de Cortex](../Control%20Cortex/backend/server.js)
- [Procesamiento y respuesta de Chat Bot Spotify](../Chat%20Bot%20Spotify/src/spotify.js)
