@echo off
setlocal EnableExtensions
title Control Cortex
color 0A

set "CORTEX_ROOT=%~dp0"
set "BACKEND=%CORTEX_ROOT%backend"
set "PANEL_TARGET=%CORTEX_ROOT%frontend\home.html"
set "PANEL_URL=http://127.0.0.1:4000/"

echo.
echo  ============================================
echo   Control Cortex - OBS Microservices Panel
echo  ============================================
echo.

echo  [1/4] Verificando los archivos de Cortex...
if not exist "%BACKEND%\server.js" (
    echo  [ERROR] No se encontro "%BACKEND%\server.js".
    echo  Coloca este lanzador junto a la carpeta backend.
    pause
    exit /b 1
)
if not exist "%PANEL_TARGET%" (
    echo  [ERROR] No se encontro la pagina de inicio de Cortex:
    echo          "%PANEL_TARGET%"
    pause
    exit /b 1
)
findstr /C:view-home "%PANEL_TARGET%" >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] La pagina no parece ser el Inicio de Cortex.
    echo  Revisa la version de "%PANEL_TARGET%".
    pause
    exit /b 1
)

echo  [2/4] Revisando si Cortex ya esta activo...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $cortexStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/cortex-base-url' -TimeoutSec 2; $cortexPage = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4000/' -TimeoutSec 2; if ($cortexStatus.success -eq $true -and $cortexPage.Content.Contains('view-home')) { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo  [INFO] Cortex ya esta respondiendo. Se reutilizara la instancia activa.
    goto :open_panel
)

echo  [3/4] Comprobando el puerto 4000...
set "PORT_PID="
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4000 " ^| findstr "LISTENING"') do set "PORT_PID=%%a"
if defined PORT_PID (
    echo  [ERROR] El puerto 4000 esta ocupado, pero no respondio como Control Cortex.
    echo          No se cerro ningun proceso automaticamente.
    echo  [INFO] Cierra el proceso que ocupa el puerto o verifica que Cortex responda.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js no esta instalado o no esta agregado al PATH.
    pause
    exit /b 1
)

echo  [INFO] Iniciando Control Cortex...
start "" /min cmd /c "cd /d ""%BACKEND%"" && node server.js"

echo  [INFO] Esperando que el servidor responda (hasta 30 segundos)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $cortexDeadline = [DateTime]::UtcNow.AddSeconds(30); do { try { $cortexStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/cortex-base-url' -TimeoutSec 2; $cortexPage = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4000/' -TimeoutSec 2; if ($cortexStatus.success -eq $true -and $cortexPage.Content.Contains('view-home')) { exit 0 } } catch { }; Start-Sleep -Milliseconds 500 } while ([DateTime]::UtcNow -lt $cortexDeadline); exit 1" >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Cortex o el panel actualizado no respondio en 30 segundos.
    echo  Revisa la ventana minimizada de Control Cortex.
    pause
    exit /b 1
)

:open_panel
echo  [4/4] Abriendo Inicio de Cortex...
start "" "%PANEL_URL%"
echo.
echo  Inicio: %PANEL_URL%
echo  Si necesitas reiniciar una instancia activa, usa Control de servicios en Cortex.
echo.
endlocal
