@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Control Cortex - subir Rulo a GitHub
echo.
echo Subiendo la carpeta Rulo al repo:
echo https://github.com/mati4315/Control-Cortex---rulo-spotify
echo.
echo No sube: historial de chat, registro de pedidos, devices, node_modules ni .env.
echo.
node "tools\subir-rulo.js" %*
echo.
pause
