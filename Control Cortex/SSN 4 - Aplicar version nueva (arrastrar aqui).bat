@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Control Cortex - aplicar version nueva
if "%~1"=="" goto ayuda
node "tools\migrar-ssn.js" desde "%~1"
echo.
pause
exit /b

:ayuda
echo.
echo Arrastra sobre este archivo la CARPETA de la version nueva de SocialStream Ninja,
echo ya descomprimida, y soltala. Ejemplo de carpeta: D:\Descargas\SocialStreamNinja
echo.
echo Tambien podes usar la opcion 3 para actualizar con git.
echo.
pause
