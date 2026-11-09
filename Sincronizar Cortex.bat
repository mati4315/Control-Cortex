@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "SYNC_SCRIPT=%~dp0Sincronizar Cortex.ps1"
if not exist "%SYNC_SCRIPT%" (
  echo No se encontro: "%SYNC_SCRIPT%"
  pause
  exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SYNC_SCRIPT%" -Auto
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo La sincronizacion termino con errores. Revisa el mensaje anterior.
pause
exit /b %RESULT%
