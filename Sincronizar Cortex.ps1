param([switch]$Auto)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Modules = @()
$script:GitExe = $null
$LocalOnly = @{
  '.' = @('Control Cortex/backend/spotify-device-target.json')
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string]$Repo,
    [Parameter(Mandatory = $true)][string[]]$GitArgs,
    [switch]$Silent,
    [switch]$AllowFailure
  )
  $PreviousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $Output = @(& $script:GitExe -C $Repo @GitArgs 2>&1 | ForEach-Object { [string]$_ })
    $Code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
  $script:LastGitExitCode = $Code
  if (-not $Silent -and $Output.Count -gt 0) { $Output | ForEach-Object { Write-Host $_ } }
  if ($Code -ne 0 -and -not $AllowFailure) {
    throw "Falló git $($GitArgs -join ' ') dentro de '$Repo' (código $Code)."
  }
  return ,$Output
}

function Find-Git {
  $Candidates = @()
  $FromPath = Get-Command git -ErrorAction SilentlyContinue
  if ($FromPath -and $FromPath.Source) { $Candidates += $FromPath.Source }
  if ($env:ProgramFiles) { $Candidates += (Join-Path $env:ProgramFiles 'Git/cmd/git.exe') }
  if (${env:ProgramFiles(x86)}) { $Candidates += (Join-Path ${env:ProgramFiles(x86)} 'Git/cmd/git.exe') }
  if ($env:LOCALAPPDATA) { $Candidates += (Join-Path $env:LOCALAPPDATA 'Programs/Git/cmd/git.exe') }

  $WindowsApps = if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'WindowsApps' } else { '' }
  if ($WindowsApps -and (Test-Path -LiteralPath $WindowsApps)) {
    $RuntimeFolders = Get-ChildItem -LiteralPath $WindowsApps -Directory -Filter 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending
    foreach ($Folder in $RuntimeFolders) {
      $Candidates += (Join-Path $Folder.FullName 'dependencies/native/git/cmd/git.exe')
    }
  }

  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path -LiteralPath $Candidate)) { return $Candidate }
  }
  return $null
}

function Get-DirtyPaths {
  param([string]$Repo)
  $Lines = Invoke-Git -Repo $Repo -GitArgs @('status', '--porcelain=v1', '--untracked-files=all') -Silent
  $Paths = @()
  foreach ($Line in $Lines) {
    if ([string]::IsNullOrWhiteSpace($Line) -or $Line.Length -lt 4) { continue }
    $Path = $Line.Substring(3)
    if ($Path.StartsWith('"')) {
      try { $Path = ConvertFrom-Json -InputObject $Path } catch { }
    }
    $Paths += ($Path -replace '\\', '/')
  }
  return $Paths
}

function Get-ExcludedPaths {
  param([string]$RepoKey)
  if ($LocalOnly.ContainsKey($RepoKey)) { return @($LocalOnly[$RepoKey]) }
  return @()
}

function Get-SharedDirtyPaths {
  param([string]$Repo, [string]$RepoKey)
  $Excluded = Get-ExcludedPaths $RepoKey
  $Shared = @()
  foreach ($Path in Get-DirtyPaths $Repo) {
    if (-not [string]::IsNullOrWhiteSpace($Path) -and $Excluded -notcontains $Path) { $Shared += $Path }
  }
  return $Shared
}

function Show-RepoStatus {
  param([string]$Repo, [string]$Label)
  Write-Host "`n--- $Label ---" -ForegroundColor Cyan
  Invoke-Git -Repo $Repo -GitArgs @('status', '--short', '--branch') | Out-Null
}

function Get-BranchName {
  param([string]$Repo)
  $Branch = Invoke-Git -Repo $Repo -GitArgs @('branch', '--show-current') -Silent
  if ($script:LastGitExitCode -ne 0 -or -not $Branch -or -not $Branch[0].Trim()) {
    throw "No se pudo identificar la rama activa en '$Repo'."
  }
  return $Branch[0].Trim()
}

function Ensure-ModuleBranch {
  param([string]$Repo, [string]$RepoKey)
  if ($RepoKey -eq '.') { return (Get-BranchName $Repo) }
  $Configured = Invoke-Git -Repo $Root -GitArgs @('config', '-f', '.gitmodules', '--get', "submodule.$RepoKey.branch") -Silent -AllowFailure
  $Branch = if ($script:LastGitExitCode -eq 0 -and $Configured.Count -gt 0) { $Configured[0].Trim() } else { '' }
  if (-not $Branch) { throw "Falta definir la rama del submódulo '$RepoKey' en .gitmodules." }
  $Current = Invoke-Git -Repo $Repo -GitArgs @('rev-parse', '--abbrev-ref', 'HEAD') -Silent
  if ($script:LastGitExitCode -ne 0) { throw "No se pudo leer la rama de '$RepoKey'." }
  if ($Current[0].Trim() -eq 'HEAD') {
    $LocalExists = Invoke-Git -Repo $Repo -GitArgs @('show-ref', '--verify', "refs/heads/$Branch") -Silent -AllowFailure
    if ($script:LastGitExitCode -eq 0) {
      Invoke-Git -Repo $Repo -GitArgs @('switch', $Branch) | Out-Null
    } else {
      Invoke-Git -Repo $Repo -GitArgs @('switch', '-c', $Branch) | Out-Null
    }
  }
  $CurrentBranch = Get-BranchName $Repo
  if ($CurrentBranch -ne $Branch) { throw "'$RepoKey' quedó en la rama '$CurrentBranch', se esperaba '$Branch'." }
  Invoke-Git -Repo $Repo -GitArgs @('branch', '--set-upstream-to', "origin/$Branch", $Branch) -AllowFailure | Out-Null
  return $Branch
}

function Get-StashRef {
  param([string]$Repo, [string]$RepoKey)
  $Before = Invoke-Git -Repo $Repo -GitArgs @('rev-parse', '-q', '--verify', 'refs/stash') -Silent -AllowFailure
  if ($script:LastGitExitCode -ne 0) { $Before = @('') }
  $StashArgs = @('stash', 'push', '-m', 'Cortex Sync: conservar ajustes locales', '--')
  $StashPaths = Get-ExcludedPaths $RepoKey
  $StashArgs += $StashPaths
  Invoke-Git -Repo $Repo -GitArgs $StashArgs | Out-Null
  $After = Invoke-Git -Repo $Repo -GitArgs @('rev-parse', '-q', '--verify', 'refs/stash') -Silent -AllowFailure
  if ($script:LastGitExitCode -ne 0) { return $null }
  if ($Before.Count -gt 0 -and $Before[0].Trim() -eq $After[0].Trim()) { return $null }
  return 'stash@{0}'
}

function Restore-LocalStash {
  param([string]$Repo, [string]$StashRef)
  if (-not $StashRef) { return }
  Write-Host 'Restaurando los ajustes locales de esta PC...'
  Invoke-Git -Repo $Repo -GitArgs @('stash', 'pop', $StashRef)
}

function Stage-RepoChanges {
  param([string]$Repo, [string]$RepoKey)
  $Excludes = Get-ExcludedPaths $RepoKey
  $Args = @('add', '-A', '--', '.')
  foreach ($Path in $Excludes) { $Args += ":(exclude)$Path" }
  Invoke-Git -Repo $Repo -GitArgs $Args
  foreach ($Path in $Excludes) {
    Invoke-Git -Repo $Repo -GitArgs @('restore', '--staged', '--', $Path) -AllowFailure | Out-Null
  }
}

function Publish-Repo {
  param([string]$Repo, [string]$RepoKey, [string]$Label)
  $SharedChanges = @(Get-SharedDirtyPaths $Repo $RepoKey)
  if ($SharedChanges.Count -gt 0) {
    Stage-RepoChanges $Repo $RepoKey
    $Staged = Invoke-Git -Repo $Repo -GitArgs @('diff', '--cached', '--name-only') -Silent
    if ($Staged.Count -gt 0) {
      $Message = "Sincronizar $Label desde $env:COMPUTERNAME"
      Invoke-Git -Repo $Repo -GitArgs @('commit', '-m', $Message) | Out-Null
    } else {
      Write-Host "No quedaron cambios compartibles para confirmar en $Label." -ForegroundColor DarkYellow
    }
  }

  $StashRef = $null
  $DirtyLocal = @(Get-DirtyPaths $Repo | Where-Object {
    $Candidate = $_
    (Get-ExcludedPaths $RepoKey) -contains $Candidate
  })
  if ($DirtyLocal.Count -gt 0) { $StashRef = Get-StashRef $Repo $RepoKey }
  try {
    $Branch = Ensure-ModuleBranch $Repo $RepoKey
    Invoke-Git -Repo $Repo -GitArgs @('fetch', '--prune', 'origin')
    $AheadCount = 0
    $Upstream = Invoke-Git -Repo $Repo -GitArgs @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') -Silent -AllowFailure
    if ($script:LastGitExitCode -eq 0 -and $Upstream.Count -gt 0) {
      $Counts = Invoke-Git -Repo $Repo -GitArgs @('rev-list', '--left-right', '--count', "$($Upstream[0].Trim())...HEAD") -Silent
      if ($Counts.Count -gt 0) {
        $Parts = $Counts[0].Trim() -split '\s+'
        if ($Parts.Count -gt 1) { $AheadCount = [int]$Parts[1] }
      }
    } else {
      $AheadCount = 1
    }

    if ($AheadCount -gt 0) {
      Invoke-Git -Repo $Repo -GitArgs @('pull', '--rebase', 'origin', $Branch)
      Invoke-Git -Repo $Repo -GitArgs @('push', '--set-upstream', 'origin', $Branch)
    }
  } finally {
    Restore-LocalStash $Repo $StashRef
  }
  return $true
}

function Sync-Down {
  foreach ($Module in $Modules) {
    if (-not (Test-Path -LiteralPath (Join-Path $Module.FullPath '.git'))) { continue }
    $SharedChanges = @(Get-SharedDirtyPaths $Module.FullPath $Module.Path)
    if ($SharedChanges.Count -gt 0) {
      Show-RepoStatus $Module.FullPath $Module.Path
      throw "Hay cambios locales en '$($Module.Path)'. Primero publícalos o guárdalos; no voy a mezclarlos automáticamente."
    }
  }
  $ModuleStashes = @()
  foreach ($Module in $Modules) {
    if (-not (Test-Path -LiteralPath $Module.FullPath)) { continue }
    if (@(Get-DirtyPaths $Module.FullPath | Where-Object { (Get-ExcludedPaths $Module.Path) -contains $_ }).Count -gt 0) {
      $Ref = Get-StashRef $Module.FullPath $Module.Path
      if ($Ref) { $ModuleStashes += [pscustomobject]@{ Repo = $Module.FullPath; Ref = $Ref } }
    }
  }
  $RootStash = $null
  if (@(Get-DirtyPaths $Root | Where-Object { (Get-ExcludedPaths '.') -contains $_ }).Count -gt 0) {
    $RootStash = Get-StashRef $Root '.'
  }
  $RootSharedChanges = @(Get-SharedDirtyPaths $Root '.')
  if ($RootSharedChanges.Count -gt 0) {
    foreach ($Saved in $ModuleStashes) { Restore-LocalStash $Saved.Repo $Saved.Ref }
    Restore-LocalStash $Root $RootStash
    Show-RepoStatus $Root 'Cortex'
    throw 'Hay cambios locales en Cortex. Primero publícalos o guárdalos; no voy a mezclarlos automáticamente.'
  }
  try {
    Invoke-Git -Repo $Root -GitArgs @('pull', '--rebase', 'origin', (Get-BranchName $Root))
    Invoke-Git -Repo $Root -GitArgs @('submodule', 'sync', '--recursive')
    Invoke-Git -Repo $Root -GitArgs @('submodule', 'update', '--init', '--recursive')
  } finally {
    foreach ($Saved in $ModuleStashes) { Restore-LocalStash $Saved.Repo $Saved.Ref }
    Restore-LocalStash $Root $RootStash
  }
  Write-Host "`nCortex y sus módulos quedaron sincronizados con las referencias del repo principal." -ForegroundColor Green
}

function Publish-All {
  $Missing = @($Modules | Where-Object { -not (Test-Path -LiteralPath (Join-Path $_.FullPath '.git')) })
  if ($Missing.Count -gt 0) { throw 'Faltan módulos inicializados; primero sincroniza esta PC desde el repo.' }
  $ChangedRepos = @()
  foreach ($Module in $Modules) {
    if (@(Get-SharedDirtyPaths $Module.FullPath $Module.Path).Count -gt 0) {
      $ChangedRepos += [pscustomobject]@{ Repo = $Module.FullPath; Key = $Module.Path; Label = $Module.Path }
    }
  }
  if (@(Get-SharedDirtyPaths $Root '.').Count -gt 0) {
    $ChangedRepos += [pscustomobject]@{ Repo = $Root; Key = '.'; Label = 'Cortex' }
  }
  if ($ChangedRepos.Count -gt 0) {
    Write-Host "`nCambios compartibles detectados en $($ChangedRepos.Count) repositorio(s):" -ForegroundColor Cyan
    foreach ($Item in $ChangedRepos) { Show-RepoStatus $Item.Repo $Item.Label }
    $Answer = Read-Host '¿Publicar todos esos cambios y sincronizar? (S/N)'
    if ($Answer -notmatch '^(s|si|sí|y|yes)$') {
      Write-Host 'No se publicaron cambios.' -ForegroundColor Yellow
      return $false
    }
  } else {
    Write-Host 'No hay cambios compartibles para publicar; sincronizaré desde GitHub.' -ForegroundColor Cyan
  }
  foreach ($Module in $Modules) {
    [void](Publish-Repo -Repo $Module.FullPath -RepoKey $Module.Path -Label $Module.Path)
  }
  $LocalStashes = @()
  foreach ($Module in $Modules) {
    if (-not (Test-Path -LiteralPath $Module.FullPath)) { continue }
    if (@(Get-DirtyPaths $Module.FullPath | Where-Object { (Get-ExcludedPaths $Module.Path) -contains $_ }).Count -gt 0) {
      $Ref = Get-StashRef $Module.FullPath $Module.Path
      if ($Ref) { $LocalStashes += [pscustomobject]@{ Repo = $Module.FullPath; Ref = $Ref } }
    }
  }
  try {
    [void](Publish-Repo -Repo $Root -RepoKey '.' -Label 'Cortex')
  } finally {
    foreach ($Saved in $LocalStashes) { Restore-LocalStash $Saved.Repo $Saved.Ref }
  }
  Write-Host "`nCambios publicados. Ahora descargaré las referencias y módulos remotos." -ForegroundColor Green
  return $true
}
try {
  $script:GitExe = Find-Git
  if (-not $script:GitExe) {
    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($Winget) {
      Write-Host 'No se encontró Git for Windows. Es necesario para sincronizar con GitHub.' -ForegroundColor Yellow
      $InstallAnswer = Read-Host '¿Quieres instalar Git for Windows en esta PC con winget? (S/N)'
      if ($InstallAnswer -match '^(s|si|sí|y|yes)$') {
        & $Winget.Source install --id Git.Git --exact --scope user --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) { throw 'winget no pudo instalar Git. Instálalo desde https://git-scm.com/download/win y vuelve a abrir el BAT.' }
        $script:GitExe = Find-Git
      }
    } else {
      Write-Host 'Voy a abrir la página oficial para instalar Git for Windows.' -ForegroundColor Yellow
      Start-Process 'https://git-scm.com/download/win'
    }
    if (-not $script:GitExe) { throw 'Git for Windows no está instalado. Instálalo desde https://git-scm.com/download/win y vuelve a abrir el BAT.' }
  }
  $GitRoot = Invoke-Git -Repo $Root -GitArgs @('rev-parse', '--show-toplevel') -Silent
  if ($script:LastGitExitCode -ne 0) { throw 'Esta carpeta no es un repositorio Git.' }
  $GitmodulesPath = Join-Path $Root '.gitmodules'
  if (-not (Test-Path -LiteralPath $GitmodulesPath)) {
    if (@(Get-SharedDirtyPaths $Root '.').Count -gt 0) {
      throw 'Esta copia no tiene .gitmodules y además contiene cambios compartibles. Sincroniza primero una copia limpia para actualizar su estructura.'
    }
    Write-Host 'Esta copia aún no tiene .gitmodules; actualizaré el repo principal primero.' -ForegroundColor Yellow
    $BootstrapStash = $null
    if (@(Get-DirtyPaths $Root | Where-Object { (Get-ExcludedPaths '.') -contains $_ }).Count -gt 0) {
      $BootstrapStash = Get-StashRef $Root '.'
    }
    try {
      Invoke-Git -Repo $Root -GitArgs @('fetch', '--prune', 'origin')
      Invoke-Git -Repo $Root -GitArgs @('pull', '--rebase', 'origin', (Get-BranchName $Root))
    } finally {
      Restore-LocalStash $Root $BootstrapStash
    }
  }
  $CurrentModule = $null
  if (Test-Path -LiteralPath $GitmodulesPath) {
  foreach ($Line in Get-Content -LiteralPath $GitmodulesPath) {
    if ($Line -match '^\s*\[submodule\s+"(.+)"\]\s*$') { $CurrentModule = $Matches[1]; continue }
    if ($CurrentModule -and $Line -match '^\s*path\s*=\s*(.+?)\s*$') {
      $RelativePath = $Matches[1]
      $FullPath = Join-Path $Root $RelativePath
      $Modules += [pscustomobject]@{ Path = $RelativePath.Replace('\', '/'); FullPath = $FullPath }
      if (-not (Test-Path -LiteralPath (Join-Path $FullPath '.git'))) {
        Write-Host "El submódulo '$RelativePath' aún no está inicializado; se descargará al sincronizar." -ForegroundColor DarkYellow
      }
      $CurrentModule = $null
    }
  }
  }

  if ($Auto) {
    if (@($Modules | Where-Object { -not (Test-Path -LiteralPath (Join-Path $_.FullPath '.git')) }).Count -gt 0) { Sync-Down; exit 0 }
    if (Publish-All) { Sync-Down }
    exit 0
  }
  Write-Host 'Sincronización de Cortex con GitHub' -ForegroundColor Cyan
  Write-Host '1) Descargar cambios para esta PC'
  Write-Host '2) Revisar, confirmar y subir cambios de esta PC'
  Write-Host '3) Publicar y luego sincronizar'
  Write-Host '4) Ver estado de todos los repositorios'
  Write-Host '0) Salir'
  $Choice = Read-Host 'Elige una opción'
  switch ($Choice) {
    '1' { Sync-Down }
    '2' { [void](Publish-All) }
    '3' { if (Publish-All) { Sync-Down } }
    '4' {
      Show-RepoStatus $Root 'Cortex'
      foreach ($Module in $Modules) { Show-RepoStatus $Module.FullPath $Module.Path }
    }
    '0' { exit 0 }
    default { Write-Host 'Opción no reconocida.' -ForegroundColor Yellow; exit 1 }
  }
} catch {
  Write-Host "`nNo se completó la sincronización: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Los cambios locales se conservan. Resuelve el mensaje indicado y vuelve a abrir el BAT.' -ForegroundColor Yellow
  exit 1
}
