@echo off
setlocal
title Loteria - Servidor WS + Watcher
cd /d "%~dp0"

:: ── Token (definilo en .env o como variable de entorno) ──
if "%WS_TOKEN%"=="" (
  echo [WARN] WS_TOKEN no definido. El servidor WS no validara tokens.
  echo        Definila en .env o con: set WS_TOKEN=tu-token
  echo.
)

:: ── Node.js check ─────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no instalado.
  pause & exit /b 1
)

:: ── Dependencias ──────────────────────────────────
if not exist node_modules\ws (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install fallo.
    pause & exit /b 1
  )
)

:: ── Iniciar watcher en background (misma ventana) ──
if exist "service-account.json" (
  echo [OK] Iniciando watcher de entradas...
  start /b node observe-entries.js
) else (
  echo [SKIP] Watcher omitido (falta service-account.json)
)

:: ── Iniciar servidor WS (foreground) ─────────────
echo [OK] Iniciando servidor WebSocket...
echo.
echo =============================================
echo   Servidor corriendo en ws://localhost:688
echo   Cerra esta ventana para detener todo.
echo =============================================
echo.

call node server-ws.js

echo.
echo Servidor detenido.
pause
