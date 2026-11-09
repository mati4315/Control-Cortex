# Sincronizar Cortex entre dos PC

El proyecto conserva el repositorio principal y los repositorios enlazados de SocialStream Ninja, Trigger Studio y comentarios. El archivo `Sincronizar Cortex.bat` coordina ese conjunto.

## En cada PC

1. Instala Git for Windows e inicia sesión en GitHub si Git lo solicita.
2. Descarga o clona el repo principal. En una copia existente, abre `Sincronizar Cortex.bat` y elige **Descargar cambios**.
3. Al terminar una sesión de trabajo, abre el mismo BAT y elige **Revisar, confirmar y subir cambios**. Revisa cada lista y confirma solo los cambios que quieras compartir.
4. Para hacer ambas acciones en una sola ejecución, elige **Publicar y luego sincronizar**.

El script conserva los cambios locales si detecta conflictos o errores. No fuerza pushes ni descarta archivos. Antes de crear cada commit muestra el estado y pide confirmación; también pide un mensaje para cada repositorio que vaya a guardar.

`Control Cortex/backend/spotify-device-target.json` y `SocialStream Ninja/local-overrides/cortex-base-url.js` son ajustes propios de cada PC y el script los excluye de commits. Los adjuntos de Codex y los archivos de respaldo locales también están excluidos por `.gitignore`.

## Reglas de uso

- Antes de empezar a trabajar en la otra PC, descarga los cambios.
- No trabajes simultáneamente en el mismo módulo desde ambas PC. Si Git informa un conflicto, resuélvelo antes de seguir.
- Mantén los repos enlazados en sus ramas indicadas en `.gitmodules`; el repo principal fija la revisión concreta que usa cada copia.
- No sincronices la carpeta de trabajo mediante OneDrive, Dropbox u otro servicio de archivos mientras Git también la modifica.

## Si el BAT avisa que hay cambios locales

Usa primero **Revisar, confirmar y subir cambios**. Si no quieres compartir un cambio, no lo confirmes; guarda o resuelve ese archivo manualmente antes de descargar cambios remotos.
