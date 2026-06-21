@echo off
setlocal
title Lanzador de Overlays OBS (Clima + Luces)

set "ROOT=%~dp0"
set "CLIMA_DIR=%ROOT%..\modulo de tiempo y clima"
set "LUCES_DIR=%ROOT%"

echo ==========================================================
echo  Buscando y cerrando procesos activos en puertos 3757 y 3758...
echo ==========================================================

powershell -Command "Get-NetTCPConnection -LocalPort 3757 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
powershell -Command "Get-NetTCPConnection -LocalPort 3758 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3757" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3758" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul

echo ==========================================================
echo  Iniciando Servidores de Overlays...
echo ==========================================================

start "Servidor de Clima (3757)" cmd /c "cd /d ""%CLIMA_DIR%"" && node server.js"
start "Servidor de Luces (3758)" cmd /c "cd /d ""%LUCES_DIR%"" && node server.js"

echo.
echo  Abriendo paneles de control en el navegador...
start "" "http://localhost:3757/dashboard.html"
start "" "http://localhost:3758/dashboard.html"

echo ==========================================================
echo  ¡Servidores iniciados con éxito!
echo  Esta ventana se cerrará automáticamente en 5 segundos.
echo ==========================================================
timeout /t 5 /nobreak >nul
endlocal
