# Respaldos y recuperación de Rulo

Cortex crea un respaldo al iniciar y cada 24 horas. El historial también permite crear uno manual. Se conservan los siete respaldos más recientes en `Control Cortex/backend/backups/rulo-data/`.

Cada carpeta contiene `manifest.json`, la base SQLite `spotify-analytics.db`, `rulo-chat-history.json` y, si existen, los avatares de `profile-avatars/`. Cuando la memoria está inicializada, también contiene `cuaderno-vivo-memory.sqlite` y `cuaderno-vivo-identity-hmac.key`; esos dos archivos deben conservarse y restaurarse juntos para mantener el vínculo protegido entre recuerdos e identidades estables. Los comentarios de modo de pruebas no se incluyen porque viven solo en memoria. Los respaldos contienen datos personales y permanecen fuera de Git. La retención automática de interacciones Spotify y el botón **Vaciar historial activo** operan sobre la base activa; los respaldos existentes mantienen sus copias hasta que se eliminen manualmente o salgan de la rotación de siete copias.

## Recuperar una copia

1. Elige una carpeta de respaldo y confirma en `manifest.json` que incluya los archivos que quieres recuperar.
2. Detén Control Cortex desde el administrador de servicios o su proceso PM2. No reemplaces SQLite mientras Cortex siga abierto.
3. Conserva aparte los archivos actuales antes de reemplazarlos. Incluye `Rulo/Spotify/spotify-analytics.db`, sus archivos `-wal` y `-shm`, `Rulo/rulo-chat-history.json` y `Rulo/profile-avatars/` si existen.
4. Copia `spotify-analytics.db` a `Rulo/Spotify/spotify-analytics.db`, `rulo-chat-history.json` a `Rulo/rulo-chat-history.json` y el contenido de `profile-avatars/` a `Rulo/profile-avatars/`.
5. Si el manifiesto contiene ambos archivos de Cuaderno Vivo, cópialos juntos a `Rulo - Cuaderno Vivo/data/`. No restaures uno sin el otro. Si la clave falta mientras la base ya existe, Cuaderno Vivo permanece desactivado para evitar reemplazarla por una nueva.
6. Inicia Cortex y revisa el historial de Rulo, el estado del archivo de audiencia y la disponibilidad de Cuaderno Vivo antes de salir al aire.

Si un archivo no aparece en el manifiesto, no lo reemplaces. La exportación independiente del archivo permanente de audiencia está en `/api/rulo-audience-comments.csv?dias=30` (se puede cambiar el período hasta 3650 días).
