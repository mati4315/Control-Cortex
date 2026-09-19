@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Control Cortex - respaldo
echo.
echo Guardando loader.js, manifest.json y local-overrides en Control Cortexackups
echo.
node "tools\migrar-ssn.js" backup
echo.
pause
