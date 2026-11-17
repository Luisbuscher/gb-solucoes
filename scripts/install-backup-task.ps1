param([string]$TaskName = 'GB Clareza - Backup diario')
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe).Source
$backupScript = Join-Path $projectDir 'backend\scripts\backup.mjs'
$taskAction = New-ScheduledTaskAction -Execute $nodePath -Argument ('"' + $backupScript + '"') -WorkingDirectory (Join-Path $projectDir 'backend')
$taskTrigger = New-ScheduledTaskTrigger -Daily -At '03:00'
$saoPauloToday = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'E. South America Standard Time').ToString('yyyy-MM-dd')
$taskTrigger.StartBoundary = $saoPauloToday + 'T03:00:00-03:00'
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U -RunLevel Limited
try {
  Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $taskPrincipal -Description 'Backup cifrado do PostgreSQL externo da GB Clareza, diariamente às 03:00 America/Sao_Paulo.' -Force -ErrorAction Stop | Select-Object TaskName,State
} catch {
  # The current Windows account may not have permission to register S4U tasks.
  # Install a per-user startup runner without changing privileges or security policy.
  $startupDir = [Environment]::GetFolderPath('Startup')
  $runnerScript = Join-Path $PSScriptRoot 'backup-user-runner.ps1'
  $windowsShell = New-Object -ComObject WScript.Shell
  $shortcut = $windowsShell.CreateShortcut((Join-Path $startupDir 'GB Clareza - Backup.lnk'))
  $shortcut.TargetPath = (Get-Command powershell.exe).Source
  $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -File "' + $runnerScript + '"'
  $shortcut.WorkingDirectory = $projectDir
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Backup GB Clareza às 03:00 de São Paulo ou na próxima sessão ativa.'
  $shortcut.Save()
  Start-Process -FilePath $shortcut.TargetPath -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-File',('"'+$runnerScript+'"')) -WindowStyle Hidden
  Write-Output 'Instalado no modo usuário: backup diário às 03:00 de São Paulo enquanto a sessão estiver ativa; recupera execução pendente ao entrar no Windows.'
}
