@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Control Cortex - estado de SocialStream Ninja
echo.
echo Revisando que este todo aplicado. No modifica nada.
echo.
node "tools\migrar-ssn.js" estado
echo.
pause
