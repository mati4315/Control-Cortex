# canciones automatic — biblioteca local, letras y análisis

Esta carpeta es el punto de partida del sistema de **biblioteca musical local** de Rulo
(canciones offline, `start_at`/`end_at`, letras y análisis automático).

**Estado (19-sep-2026): las Fases 1 a 5 están implementadas y probadas** (la Fase 6 y la
reproducción local quedan pendientes). Lo que ya funciona:

```text
Base única aplicada a spotify-analytics.db (biblioteca + letras + historial + analítica)
Scanner de la biblioteca      (Control Cortex/backend/biblioteca/scanner.js)
Análisis de inicio/final      (biblioteca/analisis.js)  -> 0,5 s por canción con ffmpeg
Letras con caché en SQLite    (biblioteca/letras.js + lrclib.js) -> 1 consulta por canción
Modo automático y ciclo diario(biblioteca/auto.js)
Dashboard: sección "Biblioteca local" (carpeta, interruptores, Escanear, Analizar, Probar)
Overlay de OBS: pide las letras a Cortex y si no, a LRCLIB
```

Cómo se usa: en el dashboard → **Biblioteca local** → ponés la carpeta de música, apretás
**Escanear carpeta**, después **Analizar 10** (mide inicio/final) y **Probar: elegir al azar**.
El modo automático se activa con su casilla.

**Fases 1 a 5 completas.** El modo automático cierra el circuito: el backend elige y encola la
canción (con su `start_at`/`end_at`), el módulo **v32** la reproduce por URI y corta en el final
lógico, avisando al backend para que ponga la siguiente sin huecos.

**Para que la parte de reproducción funcione hay que recargar la extensión** en `brave://extensions`
(cambió el módulo a v32; el backend ya actualizó la copia y el loader).

Lo que falta: el lector de la caché local de Spotify (opcional, apagado) y el reproductor local
(decisión abierta, ver §7.3 de la guía).

## Archivos

| Archivo | Qué es | Estado |
| --- | --- | --- |
| `GUIA-RULO-SPOTIFY.md` | **La guía maestra**, adaptada a tu proyecto: qué existe hoy, decisiones tomadas, optimizaciones medidas, fases, pruebas y despliegue | Lista para leer |
| `esquema-music.sql` | Las 4 tablas nuevas (`tracks`, `lyrics`, `play_history`, `analysis_jobs`) + índices + 2 vistas | Probado (idempotente) |
| `aplicar-esquema.js` | Aplica ese esquema a tu base real, **con copia de seguridad previa** | Probado |
| `consultas-clave.sql` | Las consultas del bot, el scanner y el dashboard, con el índice que usa cada una | Probado |
| `probar-esquema.js` | Corre el esquema sobre una base temporal, carga 3.000 canciones de prueba y mide los tiempos | **18/18 OK** |
| `guia-actualizada-rulo-spotify.md` | La guía genérica original (se conserva como referencia) | — |

Módulos implementados (fuera de esta carpeta): `Control Cortex/backend/biblioteca/` +
`Control Cortex/backend/db.js`, con sus pruebas en `Rulo/tests/biblioteca-*-test.js`.

## Orden de uso

```bash
# 1. Ver que el esquema funciona y cuánto tarda (NO toca tus datos)
node "Rulo/Spotify/canciones automatic/probar-esquema.js"

# 2. Leer la guía (empezar por la sección 0: qué cambia respecto de la original)
#    Rulo/Spotify/canciones automatic/GUIA-RULO-SPOTIFY.md

# 3. Cuando quieras arrancar la Fase 1, aplicar las tablas a la base real
node "Rulo/Spotify/canciones automatic/aplicar-esquema.js"
```

## Decisiones que ya están tomadas (y por qué)

- **Una sola base**: las tablas nuevas van en `Rulo\Spotify\spotify-analytics.db`, la misma
  que ya guarda las interacciones del chat. Un archivo, una conexión, un backup.
- **Las letras van a SQLite, no a RAM**: 5,9 KB por canción → 3.000 canciones ≈ 17 MB en
  disco y 0 KB de RAM permanente (medido).
- **Una fila por canción** en `lyrics` con las líneas en JSON: una lectura por tema
  (0,005 ms medido), sin `JOIN`.
- **El scanner compara tamaño y fecha**; hashea sólo si el archivo cambió.
- **El análisis usa ffmpeg sólo en los bordes** (15 s iniciales y 15 s finales): 0,7 s por
  canción medido → ~35 minutos para 3.000, en segundo plano.
- **La regla "en automático no se repite el mismo día" la garantiza la base**
  (índice único parcial), no el código del bot.

## Decisiones pendientes (están en la guía, §15.3)

1. Quién reproduce el audio local (Spotify sigue siendo el reproductor, o un player propio).
2. La carpeta definitiva de la biblioteca (`musicLibraryPath`).
3. Ajustar los umbrales de análisis con tus enganchados reales.
4. Activar o no la lectura de la caché de letras de Spotify (opcional, apagada por defecto).
