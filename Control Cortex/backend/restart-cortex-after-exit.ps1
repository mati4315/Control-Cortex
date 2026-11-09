param(
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$ServerPath,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [int]$Port = 4000,
  [string]$ReadyFile = ''
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $env:TEMP 'cortex-restart-helper.log'
function Write-RestartLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message`r`n"
  [System.IO.File]::AppendAllText($logPath, $line, [System.Text.UTF8Encoding]::new($false))
}

try {
  if ($ReadyFile) {
    [System.IO.File]::WriteAllText($ReadyFile, 'ready', [System.Text.UTF8Encoding]::new($false))
  }
  Write-RestartLog "Waiting for Cortex PID $ParentPid to exit."
  while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
    Start-Sleep -Milliseconds 250
  }

  $portDeadline = [DateTime]::UtcNow.AddSeconds(12)
  do {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { break }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $portDeadline)
  if ($listener) { throw "Port $Port stayed occupied by PID $($listener.OwningProcess) after Cortex exited." }

  $serverArgument = '"{0}"' -f $ServerPath
  $process = Start-Process -FilePath $NodePath -ArgumentList $serverArgument -WorkingDirectory $WorkingDirectory -WindowStyle Minimized -PassThru
  Write-RestartLog "Started Node PID $($process.Id) with entry point $ServerPath."

  $deadline = [DateTime]::UtcNow.AddSeconds(40)
  do {
    Start-Sleep -Milliseconds 500
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      if ($listener.OwningProcess -ne $process.Id) { throw "Port $Port was claimed by unexpected PID $($listener.OwningProcess)." }
      Write-RestartLog "Cortex is listening on port $Port with PID $($listener.OwningProcess)."
      exit 0
    }
    $process.Refresh()
    if ($process.HasExited) {
      throw "Node process $($process.Id) exited with code $($process.ExitCode) before opening port $Port."
    }
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Node process $($process.Id) did not open port $Port within 40 seconds."
} catch {
  Write-RestartLog "Restart failed: $($_.Exception.Message)"
  exit 1
}
