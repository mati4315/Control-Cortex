@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Control Cortex - actualizar con git
echo.
echo Se descargan los cambios de SocialStream Ninja con git.
echo Primero se hace un respaldo y al final se re-aplica el parcheo de Cortex.
echo.
pause
node "tools\migrar-ssn.js" git
echo.
pause
