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

      # "registered" alone used to be the whole report, and it looked healthy even
      # when the 5-minute repetition was missing -- which is what actually keeps
      # the worker alive after someone closes its window. One office PC ran for
      # days in exactly that state and this check would not have caught it.
      $repeat = $null
      if ($task.Triggers -and $task.Triggers.Count -ge 1 -and $task.Triggers[0].Repetition) {
        $repeat = $task.Triggers[0].Repetition.Interval
      }
      if ($repeat) {
        Write-Host "Self-heal: restarts within $repeat if the window is closed"
      } else {
        Write-Warning "Self-heal: not set. The worker only starts at logon, so closing its window keeps it down until the next login. Re-run install.ps1."
      }
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
