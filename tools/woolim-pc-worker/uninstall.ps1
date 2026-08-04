[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [string]$WorkerId,
  [switch]$ClearConfiguration,
  [switch]$RemoveLocalData
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($WorkerId)) {
  $WorkerId = [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_ID", "User")
}
if ([string]::IsNullOrWhiteSpace($WorkerId) -or $WorkerId -notmatch '^[a-z0-9][a-z0-9._-]{1,63}$') {
  throw "WorkerId is missing or invalid. Pass -WorkerId explicitly if the user setting was removed."
}

$TaskName = "Woolim Worker - $WorkerId"
if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task -and $PSCmdlet.ShouldProcess($TaskName, "Stop and unregister scheduled task")) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
}

$WorkerRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "WoolimWorker"))
$InstallRoot = [System.IO.Path]::GetFullPath((Join-Path $WorkerRoot "app"))
$LocalAppDataRoot = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd("\") + "\"
if (-not $InstallRoot.StartsWith($LocalAppDataRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to remove a path outside LOCALAPPDATA."
}
if ((Test-Path -LiteralPath $InstallRoot) -and $PSCmdlet.ShouldProcess($InstallRoot, "Remove installed worker files")) {
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}

if ($ClearConfiguration) {
  foreach ($name in @(
    "WOOLIM_WORKER_ID",
    "WOOLIM_WORKER_NAME",
    "WOOLIM_WORKER_SERVER_URL",
    "WOOLIM_PC_WORKER_SECRET",
    "WOOLIM_PDFTOPPM_PATH"
  )) {
    if ($PSCmdlet.ShouldProcess("Current Windows user", "Clear $name")) {
      [Environment]::SetEnvironmentVariable($name, $null, "User")
      [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
  }
}

if ($RemoveLocalData) {
  if (-not $WorkerRoot.StartsWith($LocalAppDataRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a path outside LOCALAPPDATA."
  }
  if ((Test-Path -LiteralPath $WorkerRoot) -and $PSCmdlet.ShouldProcess($WorkerRoot, "Remove logs and local job files")) {
    Remove-Item -LiteralPath $WorkerRoot -Recurse -Force
  }
}

if ($WhatIfPreference) {
  Write-Host "What if: uninstall Woolim worker '$WorkerId'."
} else {
  Write-Host "Uninstalled Woolim worker '$WorkerId'."
}
if (-not $ClearConfiguration) { Write-Host "Per-user settings were preserved." }
if (-not $RemoveLocalData) { Write-Host "Logs and local data were preserved in $WorkerRoot." }
