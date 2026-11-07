@echo off
setlocal EnableExtensions
title Agente remoto de RULO 3D
color 0B

set "AGENT_DIR=%~dp0"
set "RULO_3D_PACKAGE_DIR=D:\Codot Model Rulo\FORMATO WINDOWS\RULO 3D protegido"
set "RULO_CORTEX_IP=192.168.4.100"
set "RULO_CORTEX_ORIGIN=http://192.168.4.100:4000"
set "RULO_REMOTE_LAUNCH_PORT=4102"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not exist "%RULO_3D_PACKAGE_DIR%\clave-rulo-3d.txt" (
    echo [ERROR] No se encontro la clave del paquete protegido:
    echo         "%RULO_3D_PACKAGE_DIR%\clave-rulo-3d.txt"
    pause
    exit /b 1
)
if not exist "%RULO_3D_PACKAGE_DIR%\RULO.exe" (
    echo [ERROR] No se encontro RULO.exe en "%RULO_3D_PACKAGE_DIR%".
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

echo [INFO] Agente limitado al panel %RULO_CORTEX_IP% y al puerto TCP 4102.
echo [INFO] RULO.exe solo se iniciara desde el paquete protegido de esta PC.
"%NODE_EXE%" "%AGENT_DIR%rulo-exe-launch-agent.js"
if errorlevel 1 (
    echo [ERROR] El agente remoto se cerro.
    pause
)
