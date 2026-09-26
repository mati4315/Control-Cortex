# Tunel de ngrok: muestra (y copia) la URL publica para compartir el historial.
# La levanta sola si no esta andando.
#
# La direccion CAMBIA en cada reinicio del tunel, por eso conviene abrir este
# acceso directo en vez de guardar la URL en algun lado.
#
# OJO: sin acentos a proposito. Windows PowerShell 5.1 lee este archivo como ANSI
# si no tiene BOM, y los acentos saldrian mal.

$ErrorActionPreference = 'SilentlyContinue'

function Buscar-Ngrok {
  $rutas = @(
    (Join-Path $env:LOCALAPPDATA 'ngrok\ngrok.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ngrok.exe'),
    'C:\Program Files\ngrok\ngrok.exe'
  )
  foreach ($ruta in $rutas) { if (Test-Path $ruta) { return $ruta } }
  return $null
}

Write-Host ''
Write-Host '  ============================================' -ForegroundColor Cyan
Write-Host '   Tunel ngrok - acceso remoto al historial'   -ForegroundColor Cyan
Write-Host '  ============================================' -ForegroundColor Cyan
Write-Host ''

$ngrok = Buscar-Ngrok
if (-not $ngrok) {
  Write-Host '  [!] No encontre ngrok.exe.' -ForegroundColor Red
  Write-Host '      Instalalo con:  winget install Ngrok.Ngrok' -ForegroundColor Gray
  Read-Host '  Enter para salir'
  exit 1
}

# --- 1) Levantar el tunel si no esta andando ---
if (Get-Process -Name ngrok) {
  Write-Host '  [1/3] El tunel ya estaba andando.' -ForegroundColor Green
} else {
  Write-Host '  [1/3] Levantando el tunel...' -ForegroundColor Yellow
  Start-Process -FilePath $ngrok -ArgumentList 'http', '4000' -WindowStyle Minimized
  Start-Sleep -Seconds 9
}

# --- 2) Leer la direccion publica desde la API local de ngrok ---
Write-Host '  [2/3] Leyendo la direccion publica...' -ForegroundColor Yellow
$publica = $null
for ($i = 0; $i -lt 10 -and -not $publica; $i++) {
  try {
    $datos = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 6
    $publica = ($datos.tunnels | Where-Object { $_.public_url -like 'https*' } | Select-Object -First 1).public_url
  } catch { }
  if (-not $publica) { Start-Sleep -Seconds 2 }
}

if (-not $publica) {
  Write-Host ''
  Write-Host '  [!] No pude leer la direccion.' -ForegroundColor Red
  Write-Host '      Abri el panel y mirala ahi:  http://127.0.0.1:4040' -ForegroundColor Gray
  Start-Process 'http://127.0.0.1:4040'
  Read-Host '  Enter para salir'
  exit 1
}

# --- 3) Armar la URL del historial con el Session ID real del backend ---
$session = 'XJ9hQ2JDHH'
try {
  $session = (Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/cortex-base-url' -TimeoutSec 5).sessionId
} catch { }

$full = "$publica/rulo-chat-historial.html?session=$session"
Set-Clipboard -Value $full

Write-Host '  [3/3] Listo.' -ForegroundColor Green
Write-Host ''
Write-Host '  ============================================' -ForegroundColor Cyan
Write-Host '   URL PARA COMPARTIR (ya copiada):'          -ForegroundColor Cyan
Write-Host ''
Write-Host "   $full" -ForegroundColor White
Write-Host '  ============================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Esta en el portapapeles: pegala y mandala.'        -ForegroundColor Gray
Write-Host '  Para cortar el acceso: cerra la ventana de ngrok.' -ForegroundColor Gray
Write-Host ''
Read-Host '  Enter para cerrar'
