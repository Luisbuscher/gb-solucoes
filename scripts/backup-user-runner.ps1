$ErrorActionPreference = 'Stop'
$runnerMutex = New-Object System.Threading.Mutex($false, 'Local\GBClarezaBackupUser')
if (-not $runnerMutex.WaitOne(0)) { exit 0 }
$projectDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $env:LOCALAPPDATA 'GBClareza'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$stateFile = Join-Path $stateDir 'last-scheduled-backup.txt'
$statusFile = Join-Path $stateDir 'backup-status.log'
$nodePath = (Get-Command node.exe).Source
try {
  while ($true) {
    $nowSaoPaulo = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'E. South America Standard Time')
    $today = $nowSaoPaulo.ToString('yyyy-MM-dd')
    $lastRun = if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw } else { '' }
    if ($nowSaoPaulo.Hour -ge 3 -and $lastRun.Trim() -ne $today) {
      $backupOutput = & $nodePath (Join-Path $projectDir 'backend\scripts\backup.mjs') 2>&1
      $backupExitCode = $LASTEXITCODE
      Add-Content -LiteralPath $statusFile -Value ($nowSaoPaulo.ToString('o') + ' exit=' + $backupExitCode + ' ' + ($backupOutput -join ' '))
      if ($backupExitCode -eq 0) { Set-Content -LiteralPath $stateFile -Value $today -NoNewline }
    }
    Start-Sleep -Seconds 300
  }
} finally { $runnerMutex.ReleaseMutex(); $runnerMutex.Dispose() }
