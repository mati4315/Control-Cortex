@echo off
setlocal
cd /d "%~dp0"
title Chat Bot Spotify

rem Si Cortex ya administra este modulo con PM2, reinicia esa instancia en vez
rem de lanzar un segundo servidor que choque con el puerto 9765.
set "PM2_CLI=%~dp0..\Control Cortex\backend\node_modules\.bin\pm2.cmd"
if exist "%PM2_CLI%" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$raw = & '%PM2_CLI%' jlist 2>$null | Out-String; if ($raw -match 'chat-bot-spotify') { exit 0 } else { exit 1 }"
  if not errorlevel 1 (
    echo Reiniciando Chat Bot Spotify administrado por Cortex...
    call "%PM2_CLI%" restart chat-bot-spotify --update-env
    if errorlevel 1 goto :start_standalone
    echo Mostrando logs. Ctrl+C cierra esta vista, no el servicio.
    call "%PM2_CLI%" logs chat-bot-spotify --lines 20
    exit /b
  )
)

:start_standalone
rem En modo independiente, solo cerramos el puerto si el proceso pertenece a
rem este modulo; no terminamos otro programa que use 9765.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ids = @(Get-NetTCPConnection -LocalPort 9765 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($id in $ids) { $p = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $id }; $parent = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $p.ParentProcessId }; $sameModule = ($p.CommandLine -match '(?i)Chat Bot Spotify[\\/]+server\.js') -or (($p.CommandLine -match '(?i)node(\.exe)?\s+.*server\.js') -and ($parent.CommandLine -match '(?i)iniciar-Chat-Bot-Spotify\.bat')); if (-not $sameModule) { Write-Output ('El puerto 9765 pertenece a otro proceso (PID ' + $id + '). No se cerró.'); exit 2 }; Stop-Process -Id $id -Force -ErrorAction Stop }; Start-Sleep -Milliseconds 800; if (Get-NetTCPConnection -LocalPort 9765 -State Listen -ErrorAction SilentlyContinue) { Write-Output 'El puerto 9765 sigue ocupado después del cierre.'; exit 3 }"
if errorlevel 1 (
  echo No se pudo liberar el puerto 9765 con seguridad. Revisa el proceso que lo ocupa.
  pause
  exit /b 1
)

node "%~dp0server.js"
if errorlevel 1 pause
