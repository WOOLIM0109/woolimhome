[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$NoAutoStart,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$WorkerId = [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_ID", "User")
$WorkerName = [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_NAME", "User")
$WorkerSecret = [Environment]::GetEnvironmentVariable("WOOLIM_PC_WORKER_SECRET", "User")
$ServerUrl = [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_SERVER_URL", "User")

if ([string]::IsNullOrWhiteSpace($WorkerId) -or $WorkerId -notmatch '^[a-z0-9][a-z0-9._-]{1,63}$') {
  throw "Run setup.ps1 first. WOOLIM_WORKER_ID is missing or invalid."
}
if ([string]::IsNullOrWhiteSpace($WorkerName)) {
  throw "Run setup.ps1 first. WOOLIM_WORKER_NAME is missing."
}
if ([string]::IsNullOrWhiteSpace($WorkerSecret)) {
  throw "Run setup.ps1 first. WOOLIM_PC_WORKER_SECRET is missing."
}
if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
  throw "Run setup.ps1 first. WOOLIM_WORKER_SERVER_URL is missing."
}

$WorkerRoot = Join-Path $env:LOCALAPPDATA "WoolimWorker"
$InstallRoot = Join-Path $WorkerRoot "app"
$DestinationWorker = Join-Path $InstallRoot "worker.ps1"
$TaskName = "Woolim Worker - $WorkerId"
$actionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$DestinationWorker`""

if ($PSCmdlet.ShouldProcess($InstallRoot, "Install Woolim worker files")) {
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  foreach ($fileName in @("worker.ps1", "install.ps1", "uninstall.ps1", "setup.ps1", "diagnose.ps1", "README.md")) {
    $sourcePath = Join-Path $PSScriptRoot $fileName
    $destinationPath = Join-Path $InstallRoot $fileName
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
    if (-not [string]::Equals(
      [System.IO.Path]::GetFullPath($sourcePath),
      [System.IO.Path]::GetFullPath($destinationPath),
      [StringComparison]::OrdinalIgnoreCase
    )) {
      Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }
  }
}

if ($NoAutoStart) {
  if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask -and $PSCmdlet.ShouldProcess($TaskName, "Remove existing autostart task")) {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
  }
} else {
  if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
    throw "Windows Scheduled Tasks cmdlets are unavailable. Run on Windows 10/11 PowerShell 5.1 or use -NoAutoStart."
  }
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArguments -WorkingDirectory $InstallRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
    -MultipleInstances IgnoreNew

  if ($PSCmdlet.ShouldProcess($TaskName, "Register per-user logon task")) {
    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $trigger `
      -Principal $principal `
      -Settings $settings `
      -Description "Woolim document conversion worker ($WorkerName)" `
      -Force | Out-Null
  }
}

if ($StartNow) {
  if ($NoAutoStart) {
    if ($PSCmdlet.ShouldProcess($DestinationWorker, "Start worker process")) {
      Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList $actionArguments `
        -WindowStyle Hidden | Out-Null
    }
  } elseif ($PSCmdlet.ShouldProcess($TaskName, "Start scheduled task")) {
    Start-ScheduledTask -TaskName $TaskName
  }
}

Write-Host "Installed Woolim worker '$WorkerId' in $InstallRoot"
if ($NoAutoStart) {
  Write-Host "Autostart was not registered."
} else {
  Write-Host "Autostart task: $TaskName"
}
Write-Host "No secret was written to the script or scheduled-task arguments."
