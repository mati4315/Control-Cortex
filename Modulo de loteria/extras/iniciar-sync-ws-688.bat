@echo off
setlocal
title Loteria Sync WS (Puerto 688)
cd /d "%~dp0\.."

echo =========================================
echo   Loteria Sync WS - Inicio rapido
echo   Puerto: ws://localhost:688
echo =========================================
echo.

set "PORT=688"
set "PORT_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "PORT_PID=%%p"
  goto :port_found
)
goto :port_free

:port_found
echo [INFO] Puerto %PORT% en uso por PID %PORT_PID%. Cerrando proceso...
taskkill /F /PID %PORT_PID% >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se pudo cerrar el PID %PORT_PID%.
  echo Cierra ese proceso manualmente e intenta de nuevo.
  echo.
  pause
  exit /b 1
)
echo [OK] Puerto %PORT% liberado.
echo.

:port_free

:: Token (definilo en .env o variable de entorno, NO hardcodeado)
if "%WS_TOKEN%"=="" (
  echo [WARN] WS_TOKEN no definido. El servidor WS no validara tokens.
  echo        Definila con: set WS_TOKEN=tu-token
  echo.
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en PATH.
  echo Instala Node.js y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules\ws (
  echo Instalando dependencias ^(primera vez^)...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Fallo npm install.
    pause
    exit /b 1
  )
)

echo Iniciando servidor WebSocket...
echo.
call node server-ws.js

echo.
echo El servidor se detuvo.
pause
