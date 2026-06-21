@echo off
title Control Cortex - Iniciando...
color 0A
echo.
echo  ============================================
echo   Control Cortex - OBS Microservices Panel
echo  ============================================
echo.

:: --- Verificar si el puerto 4000 esta ocupado ---
echo  [1/3] Verificando puerto 4000...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4000 " ^| findstr "LISTENING"') do (
    set PID=%%a
)

if defined PID (
    echo  [!] Puerto 4000 ocupado por proceso PID %PID%. Cerrando...
    taskkill /PID %PID% /F >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo  [OK] Proceso cerrado.
) else (
    echo  [OK] Puerto 4000 libre.
)

:: --- Iniciar el servidor ---
echo.
echo  [2/3] Iniciando servidor Control Cortex...
cd /d "%~dp0backend"
start "" /min cmd /c "node server.js"
timeout /t 3 /nobreak >nul

:: --- Abrir el navegador ---
echo  [3/3] Abriendo dashboard en el navegador...
start "" "http://localhost:4000"

echo.
echo  ============================================
echo   Dashboard disponible en:
echo   http://localhost:4000
echo  ============================================
echo.
echo  El servidor corre en segundo plano.
echo  Puedes cerrar esta ventana.
echo.
pause
