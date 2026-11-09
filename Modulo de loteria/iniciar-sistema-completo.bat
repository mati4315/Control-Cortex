@echo off
setlocal
title Loteria - Servidor WS + Watcher
cd /d "%~dp0"

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

:: ── Iniciar servidor WS y watcher supervisado ───
echo [OK] Iniciando servidor WebSocket...
echo [INFO] El servidor inicia y supervisa el watcher de entradas.
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
