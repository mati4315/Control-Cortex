# Diagnostico de Spotify y del bot de Rulo
# Uso: doble clic en "Diagnostico Spotify.bat", o:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "diagnostico-spotify.ps1"
#
# Solo LEE: no cambia nada de Spotify ni del bot.

$ErrorActionPreference = 'SilentlyContinue'

function Titulo($t) { Write-Output ''; Write-Output ("=== " + $t + " ===") }

# ---------- 1) La app ----------
Titulo 'La app de Spotify'
$procesos = Get-Process Spotify
if (-not $procesos) {
  Write-Output '  NO ESTA CORRIENDO. Abrila y reproducí algo una vez para que aparezca como dispositivo.'
} else {
  $procesos | Select-Object Id, Responding, @{n='MB';e={[math]::Round($_.WorkingSet64/1MB)}}, MainWindowTitle |
    Format-Table -AutoSize | Out-String | Write-Output
  $vivos = ($procesos | Where-Object { $_.Responding -eq $false }).Count
  if ($vivos -gt 0) { Write-Output ("  OJO: " + $vivos + " proceso(s) NO responden (la app parece colgada).") }
  else { Write-Output '  Todos los procesos responden (la app esta viva).' }

  $a = ($procesos.TotalProcessorTime | Measure-Object -Sum).Sum
  Start-Sleep -Seconds 3
  $c = (Get-Process Spotify | ForEach-Object { $_.TotalProcessorTime } | Measure-Object -Sum).Sum
  Write-Output ("  CPU en 3 s: {0:N1} %  (si esta cerca de 100 %, esta trabajando/migrando)" -f (($c - $a).TotalMilliseconds / 3000 * 100))
}

$pkg = "$env:LOCALAPPDATA\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0"
$appx = Get-AppxPackage -Name SpotifyAB.SpotifyMusic
if ($appx) { Write-Output ("  Version instalada (Microsoft Store): " + $appx.Version) }
if (Test-Path "$env:LOCALAPPDATA\Spotify") { Write-Output '  Hay TAMBIEN un Spotify del instalador clasico.' }

# ---------- 2) Donde guarda la musica ----------
Titulo 'Carpeta donde Spotify guarda sus descargas'
$prefs = Join-Path $pkg 'LocalState\Spotify\prefs'
if (Test-Path $prefs) {
  foreach ($clave in @('storage.location', 'storage.last-location')) {
    $linea = Select-String -Path $prefs -Pattern ([regex]::Escape($clave)) | Select-Object -First 1
    if ($linea) { Write-Output ("  " + $clave + " = " + ($linea.Line -replace '^[^=]+=', '').Trim('"')) }
  }
  Write-Output '  (OJO: esa carpeta NO es una biblioteca de musica: son archivos cifrados de Spotify)'
} else { Write-Output '  no encontre el archivo de preferencias' }

# ---------- 3) Cuelgues registrados ----------
Titulo 'Cuelgues / errores de Spotify en Windows (ultimas 8 horas)'
$eventos = Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddHours(-8)} |
  Where-Object { $_.Message -match 'Spotify' }
if (-not $eventos) { Write-Output '  ninguno (si la app "se congela" y no hay eventos, no es un cuelgue real)' }
else { $eventos | Select-Object -First 10 | ForEach-Object { Write-Output ("  " + $_.TimeCreated + " | " + $_.ProviderName + " | " + (($_.Message -split "`r?`n")[0])) } }

$reportes = Join-Path $pkg 'LocalCache\Spotify\Crashpad\reports'
if (Test-Path $reportes) {
  $d = Get-ChildItem $reportes | Sort-Object LastWriteTime -Descending | Select-Object -First 3
  if ($d) { Write-Output '  Informes de cuelgue de la app:'; $d | ForEach-Object { Write-Output ("    " + $_.LastWriteTime) } }
  else { Write-Output '  Sin informes de cuelgue.' }
}

# ---------- 4) El bot ----------
Titulo 'El bot (backend de Cortex en el puerto 4000)'
try {
  $estado = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/spotify-status' -TimeoutSec 6
  $cliente = $estado.client
  Write-Output ("  Extension conectada: " + $cliente.connected + " | version que reporta: " + $cliente.version)
  Write-Output ("  Comandos pendientes: " + $estado.pendingCommands)
  Write-Output '  Ultimos pedidos:'
  $estado.log | Select-Object -First 6 | ForEach-Object {
    $hora = [DateTimeOffset]::FromUnixTimeMilliseconds($_.timestamp).ToLocalTime().ToString('HH:mm:ss')
    Write-Output ("    " + $hora + " [" + $_.source + "] ok=" + $_.ok + " -> " + ([string]$_.message).Substring(0, [Math]::Min(90, ([string]$_.message).Length)))
  }
  $dev = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/spotify-devices' -TimeoutSec 6
  Write-Output ("  Dispositivos: " + (($dev.devices | ForEach-Object { $_.name + $(if ($_.isActive) { ' (activo)' } else { '' }) }) -join ' | '))
  $obj = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/spotify-device-target' -TimeoutSec 6
  Write-Output ("  Dispositivo configurado: " + $obj.deviceName + "  <- tiene que ser uno de la lista de arriba")
} catch {
  Write-Output '  El backend NO responde en http://127.0.0.1:4000 (arrancalo con "Iniciar Control Cortex.bat")'
}

Write-Output ''
Write-Output 'Listo.'
