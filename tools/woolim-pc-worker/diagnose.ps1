[CmdletBinding()]
param(
  [switch]$TestServer
)

$ErrorActionPreference = "Stop"
$WorkerRoot = Join-Path $env:LOCALAPPDATA "WoolimWorker"
$InstalledWorker = Join-Path $WorkerRoot "app\worker.ps1"
$WorkerScript = if (Test-Path -LiteralPath $InstalledWorker) {
  $InstalledWorker
} else {
  Join-Path $PSScriptRoot "worker.ps1"
}

if (-not (Test-Path -LiteralPath $WorkerScript -PathType Leaf)) {
  throw "worker.ps1 was not found."
}

Write-Host "=== Local configuration and dependency check ==="
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WorkerScript -Check
$localExitCode = $LASTEXITCODE

$WorkerId = [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_ID", "User")
if ($WorkerId) {
  $TaskName = "Woolim Worker - $WorkerId"
  if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
      $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
      Write-Host "Autostart: registered ($($task.State)); last result $($taskInfo.LastTaskResult)"
    } else {
      Write-Warning "Autostart: scheduled task is not registered."
    }
  } else {
    Write-Warning "Autostart: Windows Scheduled Tasks cmdlets are unavailable."
  }
}

if ($TestServer) {
  Write-Host "=== Live heartbeat authentication check ==="
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WorkerScript -HeartbeatOnly
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($localExitCode -ne 0) { exit $localExitCode }
