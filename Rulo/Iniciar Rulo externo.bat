@echo off
setlocal
title Iniciar Rulo externo
color 0B

set "BACKEND=%~dp0..\Control Cortex\backend"
set "REMOTE_CORTEX=http://192.168.4.100:4000"
if not "%~1"=="" set "REMOTE_CORTEX=%~1"
if "%REMOTE_CORTEX:~-1%"=="/" set "REMOTE_CORTEX=%REMOTE_CORTEX:~0,-1%"
set "LOCAL_CORTEX=http://127.0.0.1:4000"

echo.
echo  ============================================
echo   Rulo - Inicio externo
echo  ============================================
echo.

echo [1/2] Comprobando Control Cortex en %REMOTE_CORTEX%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 '%REMOTE_CORTEX%/api/cortex-base-url'; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [OK] Control Cortex responde por red.
    set "DASHBOARD=%REMOTE_CORTEX%/rulo-mascota.html"
    goto :open_panel
)

echo [INFO] No se pudo contactar a %REMOTE_CORTEX%.
if not exist "%BACKEND%\server.js" (
    echo.
    echo [ERROR] No hay Control Cortex local y el servidor de red no responde.
    echo.
    echo Revisa que el equipo servidor este encendido y que esta URL abra:
    echo   %REMOTE_CORTEX%/rulo-mascota.html
    echo Si la IP cambio, puedes pasar la URL base como argumento:
    echo   "Iniciar Rulo externo.bat" http://192.168.4.100:4000
    echo.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado o no esta agregado al PATH.
    echo Instala Node.js o usa la instancia de Cortex por red.
    pause
    exit /b 1
)

echo [INFO] Se encontro un backend local. Iniciando Control Cortex...
start "Rulo - servidor Cortex" /min "%ComSpec%" /k "cd /d ""%BACKEND%"" && node server.js"

echo [INFO] Esperando que el servidor local quede disponible...
set "CORTEX_READY="
for /l %%i in (1,1,20) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%LOCAL_CORTEX%/api/cortex-base-url'; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 set "CORTEX_READY=1"
    if defined CORTEX_READY goto :open_local_panel
    timeout /t 1 /nobreak >nul
)

echo [ERROR] Cortex no respondio en 20 segundos.
echo Revisa la ventana minimizada "Rulo - servidor Cortex" para ver el error.
pause
exit /b 1

:open_local_panel
set "DASHBOARD=%LOCAL_CORTEX%/rulo-mascota.html"
goto :open_panel

:open_panel
echo [2/2] Abriendo el panel de Rulo...
start "" "%DASHBOARD%"
echo.
echo Panel: %DASHBOARD%
echo.
pause
endlocal
