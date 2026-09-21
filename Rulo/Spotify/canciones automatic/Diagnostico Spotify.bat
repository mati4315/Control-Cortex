@echo off
title Diagnostico de Spotify y del bot de Rulo
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostico-spotify.ps1"
echo.
pause
