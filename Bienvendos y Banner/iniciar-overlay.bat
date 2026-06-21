@echo off
title Overlay "Empezamos Pronto" - Puerto 9344
color 0B

echo.
echo  =====================================================
echo   OVERLAY STARTING SOON  ^|  Puerto 9344
echo  =====================================================
echo.

:: Ir al directorio del bat
cd /d "%~dp0"

:: ---- 1. Liberar el puerto 9344 si esta en uso ----
echo  [1/4] Verificando si el puerto 9344 esta en uso...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":9344 " ^| findstr "LISTENING"') do (
    echo  [!] Proceso encontrado con PID: %%a  ^> Cerrando...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 /nobreak >nul
    echo  [OK] Proceso terminado.
)
echo  [OK] Puerto 9344 libre.
echo.

:: ---- 2. Instalar dependencias si faltan ----
echo  [2/4] Instalando dependencias (si es necesario)...
call npm install --quiet 2>nul
echo  [OK] Dependencias listas.
echo.

:: ---- 3. Iniciar el servidor en segundo plano ----
echo  [3/4] Iniciando servidor en el puerto 9344...
set PORT=9344
start "" /B node server.js

:: Esperar a que el servidor arranque (3 segundos)
timeout /t 3 /nobreak >nul

:: ---- 4. Abrir el dashboard en el navegador ----
echo  [4/4] Abriendo el Dashboard en el navegador...
start "" "http://127.0.0.1:9344/banner/dashboard"
start "" "http://127.0.0.1:9344/banner"

echo.
echo  =====================================================
echo   Servidor corriendo en http://127.0.0.1:9344
echo.
echo   DASHBOARD : http://127.0.0.1:9344/banner/dashboard
echo   OVERLAY   : http://127.0.0.1:9344/banner
echo               (usar en OBS)
echo  =====================================================
echo.
echo  Presiona cualquier tecla para DETENER el servidor.
pause >nul

:: Detener el servidor al cerrar la ventana
echo  Deteniendo servidor...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":9344 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo  Servidor detenido. Hasta luego!
timeout /t 2 /nobreak >nul
