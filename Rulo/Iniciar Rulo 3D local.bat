@echo off
setlocal EnableExtensions
title Rulo 3D - Vista previa local
color 0B

set "PANEL_DIR=%~dp0"
set "CORTEX_ROOT=D:\Compartida\al fin"
set "BACKEND=%CORTEX_ROOT%\backend"
set "WORKSPACE_ROOT=D:\Compartida"
set "RULO_DIR=%WORKSPACE_ROOT%\Rulo"
set "RULO_PACKAGE_DIR=D:\Codot Model Rulo\FORMATO WINDOWS\RULO 3D protegido"
set "RULO_EXE=%RULO_PACKAGE_DIR%\RULO.exe"
set "RULO_KEY=%RULO_PACKAGE_DIR%\clave-rulo-3d.txt"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "PREVIEW_LOG=%BACKEND%\rulo-local-preview.log"

if /I "%~1"=="--backend" goto :runBackend

echo.
echo  ============================================
echo   Rulo 3D - Vista previa en esta PC
echo  ============================================
echo.

if not exist "%BACKEND%\server.js" (
    echo [ERROR] No se encontro Cortex local en "%BACKEND%".
    pause
    exit /b 1
)
if not exist "%RULO_DIR%\." (
    echo [ERROR] Falta la copia aislada "%RULO_DIR%".
    pause
    exit /b 1
)
if not exist "%PANEL_DIR%rulo-mascota.html" (
    echo [ERROR] Falta rulo-mascota.html junto a este lanzador.
    pause
    exit /b 1
)
if not exist "%RULO_DIR%\rulo-mascota.html" (
    echo [ERROR] Falta el panel destino "%RULO_DIR%\rulo-mascota.html".
    pause
    exit /b 1
)
if not exist "%PANEL_DIR%rulo-library.html" (
    echo [ERROR] Falta rulo-library.html junto a este lanzador.
    pause
    exit /b 1
)
if not exist "%RULO_DIR%\rulo-library.html" (
    echo [ERROR] Falta la biblioteca destino "%RULO_DIR%\rulo-library.html".
    pause
    exit /b 1
)

echo [1/4] Copiando los paneles que estas editando a la copia local de Cortex...
copy /Y "%PANEL_DIR%rulo-mascota.html" "%RULO_DIR%\rulo-mascota.html" >nul
copy /Y "%PANEL_DIR%rulo-library.html" "%RULO_DIR%\rulo-library.html" >nul
if errorlevel 1 (
    echo [ERROR] No se pudo sincronizar el panel.
    pause
    exit /b 1
)
echo [OK] Panel actualizado.

if not exist "%RULO_KEY%" (
    echo [ERROR] Falta la clave compartida: "%RULO_KEY%".
    pause
    exit /b 1
)
set /p "RULO_CONTROL_TOKEN="<"%RULO_KEY%"
if "%RULO_CONTROL_TOKEN:~63,1%"=="" (
    echo [ERROR] La clave compartida debe contener 64 caracteres.
    pause
    exit /b 1
)
if not "%RULO_CONTROL_TOKEN:~64,1%"=="" (
    echo [ERROR] La clave compartida tiene un formato incorrecto.
    pause
    exit /b 1
)
if not exist "%NODE_EXE%" (
    where node >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] No se encontro Node.js.
        pause
        exit /b 1
    )
    set "NODE_EXE=node"
)

echo [2/4] Cerrando las instancias de Cortex abiertas por este lanzador...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$helpers=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*Iniciar Rulo 3D local.bat*' -and $_.CommandLine -like '*--backend*' }); foreach($helper in $helpers){ $children=Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $helper.ProcessId) -ErrorAction SilentlyContinue; Stop-Process -Id $helper.ProcessId -Force -ErrorAction SilentlyContinue; foreach($child in $children){ if($child.Name -eq 'node.exe' -and $child.CommandLine -match 'server\.js'){ Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue } } }" >nul 2>&1
ping 127.0.0.1 -n 3 >nul
set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /C:":4001 " ^| findstr /C:"LISTENING"') do set "PORT_PID=%%P"
if defined PORT_PID (
    echo [ERROR] El puerto 4001 sigue ocupado por PID %PORT_PID%.
    echo No se cerro porque no pertenece a este lanzador.
    pause
    exit /b 1
)
echo [3/4] Iniciando Cortex local en 127.0.0.1:4001...
start "Rulo Cortex local 4001" "%ComSpec%" /d /c ""%~f0" --backend"

echo [INFO] Esperando la API local...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(25); do { try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:4001/api/cortex-install-status' -TimeoutSec 2; if ($r.baseUrl -eq 'http://127.0.0.1:4001') { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Cortex local no respondio en el puerto 4001.
    echo Registro del backend local:
    if exist "%PREVIEW_LOG%" type "%PREVIEW_LOG%"
    pause
    exit /b 1
)
echo [OK] Cortex local listo en 127.0.0.1:4001.

echo [4/4] Reiniciando el RULO.exe protegido y abriendo el panel local...
if not exist "%RULO_EXE%" (
    echo [ERROR] Falta el nuevo ejecutable protegido: "%RULO_EXE%".
    echo Exporta primero el proyecto Godot con los cambios de seguridad.
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$oldPath=[IO.Path]::GetFullPath('%RULO_EXE%'); $newPath=[IO.Path]::GetFullPath('%RULO_EXE%'); $all=Get-CimInstance Win32_Process; foreach($p in ($all | Where-Object { $_.ExecutablePath -eq $oldPath })){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 700; $all=Get-CimInstance Win32_Process; if (-not ($all | Where-Object { $_.ExecutablePath -eq $newPath })) { Start-Process -FilePath $newPath }" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] No se pudo iniciar RULO.exe protegido.
    pause
    exit /b 1
)
start "" "http://127.0.0.1:4001/rulo-mascota.html?ruloMode=exe3d&ruloHost=127.0.0.1&ruloToken=%RULO_CONTROL_TOKEN%"
echo.
echo  Edita este panel en:
echo  "%PANEL_DIR%rulo-mascota.html"
echo.
echo  Si vuelves a ejecutar este .bat, reinicia Cortex local.
echo  La copia del Cortex de red en la PC .100 no se modifica.
echo.
exit /b 0

:runBackend
title Rulo Cortex local 4001
if not exist "%NODE_EXE%" set "NODE_EXE=node"
set "PORT=4001"
set "CORTEX_HOST=127.0.0.1"
set "CORTEX_BASE_URL=http://127.0.0.1:4001"
set "CORTEX_SKIP_SSN_PATCHER=1"
set "CORTEX_LOCAL_PREVIEW=1"
set "OBS_WS_URL=ws://127.0.0.1:65534"
set "OBS_WS_PASSWORD= "
set "OPENAI_API_KEY= "
set "GEMINI_API_KEY= "
set "GOOGLE_API_KEY= "
set "SPOTIFY_AI_API_KEY= "
set "SPOTIFY_AI_KEY= "
cd /d "%BACKEND%" || exit /b 1
type nul > "%PREVIEW_LOG%"
echo [INFO] Registro: "%PREVIEW_LOG%"
"%NODE_EXE%" server.js >> "%PREVIEW_LOG%" 2>&1
if errorlevel 1 echo [ERROR] Node.js cerro Cortex. El registro esta en "%PREVIEW_LOG%".