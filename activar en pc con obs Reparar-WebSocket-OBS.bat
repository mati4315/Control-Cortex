@echo off
setlocal
title Reparar WebSocket de OBS

REM Ejecutar en la PC donde esta OBS.
REM Actualiza CORTEX_IP si cambia la direccion LAN de Control Cortex.
set "CORTEX_IP=192.168.4.100"
set "RULE_NAME=Cortex OBS WebSocket 4455"

fltmc >nul 2>&1
if errorlevel 1 (
    echo Este archivo necesita permisos de Administrador.
    echo Cierra esta ventana y vuelve a abrirlo con clic derecho ^> Ejecutar como administrador.
    pause
    exit /b 1
)

echo Configurando el Firewall de Windows para OBS WebSocket...
echo Puerto: TCP 4455
echo Origen permitido: %CORTEX_IP%

REM Reemplaza solo la regla con este nombre para no crear duplicados.
netsh advfirewall firewall delete rule name="%RULE_NAME%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE_NAME%" dir=in action=allow protocol=TCP localport=4455 remoteip=%CORTEX_IP% profile=any
if errorlevel 1 (
    echo.
    echo No se pudo crear la regla. Ejecuta este archivo como Administrador.
    pause
    exit /b 1
)

echo.
echo Regla aplicada. En OBS confirma que el servidor WebSocket este habilitado
echo en Herramientas ^> Ajustes del servidor WebSocket, puerto 4455.
echo El Firewall no activa el servidor de OBS; solo permite la conexion desde Cortex.
pause
endlocal
