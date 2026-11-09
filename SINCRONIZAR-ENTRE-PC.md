# Sincronizar Cortex entre dos PC

El proyecto conserva el repositorio principal y los repositorios enlazados de Trigger Studio y comentarios. SocialStream Ninja quedó retirado del conjunto sincronizado y su integración heredada está desactivada por defecto. El archivo `Sincronizar Cortex.bat` coordina los repositorios activos.

## En cada PC

1. Instala Git for Windows e inicia sesión en GitHub si Git lo solicita.
2. Descarga o clona el repo principal. En una copia existente, abre `Sincronizar Cortex.bat`.
3. El BAT consulta primero GitHub. Si esta PC está atrasada, no ofrece publicar: guarda los cambios locales de forma recuperable en stashes, actualiza Cortex y sus módulos y conserva el ajuste local de Spotify. Si las ramas ya están al día y hay cambios compartibles, muestra el estado y pregunta una sola vez antes de publicarlos.
4. Si no encuentra cambios compartibles, descarga directamente las actualizaciones. Los ajustes locales de Spotify se conservan en esta PC.

Cuando una PC está atrasada, los cambios previos quedan guardados en los stashes de cada repositorio y no se aplican encima de las versiones nuevas. El BAT muestra sus identificadores para poder revisarlos después. No fuerza pushes ni descarta esos cambios. Si las ramas divergen por commits locales y remotos, se detiene sin ofrecer publicarlos.

`Control Cortex/backend/spotify-device-target.json` y `SocialStream Ninja/local-overrides/cortex-base-url.js` son ajustes propios de cada PC y se excluyen de commits. Los adjuntos de Codex y los archivos de respaldo locales también están excluidos por `.gitignore`.
## Reglas de uso

- Antes de empezar a trabajar en la otra PC, descarga los cambios.
- No trabajes simultáneamente en el mismo módulo desde ambas PC. Si Git informa un conflicto, resuélvelo antes de seguir.
- Mantén los repos enlazados en sus ramas indicadas en `.gitmodules`; el repo principal fija la revisión concreta que usa cada copia.
- No sincronices la carpeta de trabajo mediante OneDrive, Dropbox u otro servicio de archivos mientras Git también la modifica.

## Si el BAT avisa que hay cambios locales

El BAT consulta primero si esta PC está atrasada. En ese caso actualiza y guarda los cambios locales en stashes sin pedir permiso para publicarlos. Si las ramas están al día, te pide una sola confirmación antes de publicar.
