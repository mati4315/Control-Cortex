# Tunel de ngrok: muestra (y copia) la URL publica de solo lectura del historial.
# Cortex levanta el tunel seguro al puerto 4001; el panel y sus APIs no se exponen.
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
Write-Host '   Tunel ngrok - historial publico de lectura' -ForegroundColor Cyan
Write-Host '  ============================================' -ForegroundColor Cyan
Write-Host ''

$ngrok = Buscar-Ngrok
if (-not $ngrok) {
  Write-Host '  [!] No encontre ngrok.exe.' -ForegroundColor Red
  Write-Host '      Instalalo con:  winget install Ngrok.Ngrok' -ForegroundColor Gray
  Read-Host '  Enter para salir'
  exit 1
}

# --- 1) Pedir a Cortex que inicie el tunel de solo lectura ---
Write-Host '  [1/3] Iniciando el tunel seguro desde Cortex...' -ForegroundColor Yellow
try {
  $inicio = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/cortex-home/prepare' -Method Post -ContentType 'application/json' -Body '{"services":[],"ngrok":true}' -TimeoutSec 25
  $fallo = $inicio.results | Where-Object { $_.id -eq 'ngrok' -and -not $_.ok } | Select-Object -First 1
  if ($fallo) { throw $fallo.error }
} catch {
  Write-Host '  [!] No se pudo iniciar Cortex/ngrok: ' $_.Exception.Message -ForegroundColor Red
  Write-Host '      Inicia Control Cortex y vuelve a abrir este acceso directo.' -ForegroundColor Gray
  Read-Host '  Enter para salir'
  exit 1
}

# --- 2) Leer la direccion publica desde la API local de ngrok ---
Write-Host '  [2/3] Leyendo la direccion publica...' -ForegroundColor Yellow
$publica = $null
for ($i = 0; $i -lt 10 -and -not $publica; $i++) {
  try {
    $datos = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 6
    $publica = ($datos.tunnels | Where-Object { $_.public_url -like 'https*' -and $_.config.addr -match '(:4001(?:/|$))' } | Select-Object -First 1).public_url
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

# --- 3) Compartir solo la pagina publica de lectura del historial ---
$full = "$publica/history"
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
