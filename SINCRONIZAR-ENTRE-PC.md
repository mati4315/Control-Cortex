# Sincronizar Cortex entre dos PC

El proyecto conserva el repositorio principal y los repositorios enlazados de Trigger Studio y comentarios. SocialStream Ninja quedó retirado del conjunto sincronizado y su integración heredada está desactivada por defecto. El archivo `Sincronizar Cortex.bat` coordina los repositorios activos.

## En cada PC

1. Instala Git for Windows e inicia sesión en GitHub si Git lo solicita.
2. Descarga o clona el repo principal. En una copia existente, abre `Sincronizar Cortex.bat`.
3. El BAT analiza los repositorios automáticamente. Si encuentra cambios compartibles, muestra el estado de todos y pregunta una sola vez si quieres publicarlos; crea los commits con mensajes automáticos y luego descarga lo que haya en GitHub.
4. Si no encuentra cambios compartibles, descarga directamente las actualizaciones. Los ajustes locales de Spotify se conservan en esta PC.

El script conserva los cambios locales ante conflictos o errores. No fuerza pushes ni descarta archivos. Si Git detecta un conflicto, detiene la sincronización para que puedas resolverlo.

`Control Cortex/backend/spotify-device-target.json` y `SocialStream Ninja/local-overrides/cortex-base-url.js` son ajustes propios de cada PC y se excluyen de commits. Los adjuntos de Codex y los archivos de respaldo locales también están excluidos por `.gitignore`.
## Reglas de uso

- Antes de empezar a trabajar en la otra PC, descarga los cambios.
- No trabajes simultáneamente en el mismo módulo desde ambas PC. Si Git informa un conflicto, resuélvelo antes de seguir.
- Mantén los repos enlazados en sus ramas indicadas en `.gitmodules`; el repo principal fija la revisión concreta que usa cada copia.
- No sincronices la carpeta de trabajo mediante OneDrive, Dropbox u otro servicio de archivos mientras Git también la modifica.

## Si el BAT avisa que hay cambios locales

Abre el BAT: revisará todos los repositorios y te pedirá una única confirmación antes de publicar. Si no quieres compartir los cambios detectados, responde N y guárdalos o resuélvelos manualmente antes de sincronizar desde otra PC.
