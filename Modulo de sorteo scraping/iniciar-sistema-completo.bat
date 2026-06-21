@echo off
setlocal
cd /d "%~dp0"
title IAFAS - API + Dashboard

:: ─────────────────────────────────────────────
:: Puerto de la aplicacion
:: ─────────────────────────────────────────────
set PORT=8872

:: ─────────────────────────────────────────────
:: Liberar el puerto si ya esta en uso
:: ─────────────────────────────────────────────
echo Verificando puerto %PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo [INFO] Puerto %PORT% ocupado por PID %%P. Cerrando...
  taskkill /PID %%P /F >nul 2>&1
  timeout /t 1 /nobreak >nul
)
echo [OK] Puerto %PORT% libre.

:: ─────────────────────────────────────────────
:: Verificar .env
:: ─────────────────────────────────────────────
if not exist .env (
  if exist .env.example (
    copy /Y .env.example .env >nul
    echo [OK] Se creo .env desde .env.example
  )
)

:: ─────────────────────────────────────────────
:: Verificar Node.js
:: ─────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado.
  pause
  exit /b 1
)

:: ─────────────────────────────────────────────
:: Instalar dependencias si hace falta
:: ─────────────────────────────────────────────
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install fallo.
    pause
    exit /b 1
  )
)

echo.
echo ===============================================
echo   IAFAS API corriendo en http://localhost:%PORT%
echo   Dashboard: http://localhost:%PORT%/dashboard.html
echo ===============================================
echo.

set PORT=%PORT%
call npm start

pause
