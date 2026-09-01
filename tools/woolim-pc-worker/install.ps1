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

# 어느 폴더에서 설치했는지 남깁니다.
# 워커는 이 경로를 보고 스스로 최신인지 확인합니다.
# 이 기록이 없으면 저장소에서 git pull 을 해도 돌고 있는 워커는 그대로였습니다.
if (-not [System.IO.Path]::GetFullPath($PSScriptRoot).StartsWith(
  [System.IO.Path]::GetFullPath($InstallRoot), [StringComparison]::OrdinalIgnoreCase)) {
  if ($PSCmdlet.ShouldProcess("Current Windows user", "Remember the worker source folder")) {
    [Environment]::SetEnvironmentVariable("WOOLIM_WORKER_SOURCE", $PSScriptRoot, "User")
    [Environment]::SetEnvironmentVariable("WOOLIM_WORKER_SOURCE", $PSScriptRoot, "Process")
  }
}

if ($PSCmdlet.ShouldProcess($InstallRoot, "Install Woolim worker files")) {
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  foreach ($fileName in @(
    "worker.ps1", "install.ps1", "uninstall.ps1", "setup.ps1", "diagnose.ps1", "README.md",
    # 바탕화면에서 더블클릭으로 켜고 끄는 파일들.
    "worker-control.ps1", "worker-on.cmd", "worker-off.cmd", "worker-status.cmd"
  )) {
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

# The worker drives PowerPoint through COM, so it must run in the interactive
# session and its console window stays visible. A visible window eventually gets
# closed, and closing it is a normal exit, so RestartCount never fires: the
# worker then stayed down until the next logon. One office PC sat offline for a
# whole working day that way.
#
# Repeating the logon trigger every 5 minutes fixes that. MultipleInstances is
# IgnoreNew, so a running worker is left alone and a closed one comes back
# within 5 minutes on its own.
#
# This has to happen AFTER Register-ScheduledTask. Setting .Repetition on the
# trigger that New-ScheduledTaskTrigger -AtLogOn returns looks like it works --
# no exception, no warning -- and Register-ScheduledTask then drops it. The
# office PC was installed that way on 2026-08-26 and reported success while the
# registered task had no repetition at all. Do not move this back up.
#
# So: read the task back and check the value. An exception is not the failure
# mode here; a silent no-op is.
function Set-WorkerSelfHeal {
  param([Parameter(Mandatory = $true)][string]$TaskName)

  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if (-not $task.Triggers -or $task.Triggers.Count -lt 1) {
      Write-Warning "Self-heal: the registered task has no trigger; the worker will only start at logon."
      return
    }
    $task.Triggers[0].Repetition = New-CimInstance `
      -ClassName MSFT_TaskRepetitionPattern `
      -Namespace Root/Microsoft/Windows/TaskScheduler `
      -ClientOnly `
      -Property @{ Interval = "PT5M"; StopAtDurationEnd = $false }
    Set-ScheduledTask -InputObject $task -ErrorAction Stop | Out-Null

    $applied = (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).Triggers[0].Repetition.Interval
    if ($applied -eq "PT5M") {
      Write-Host "Self-heal: the worker restarts within 5 minutes if its window is closed."
    } else {
      Write-Warning "Self-heal: Windows did not keep the 5-minute repetition; the worker will only start at logon."
    }
  } catch {
    # Losing self-healing is bad, but not installing at all is worse.
    Write-Warning "Self-heal: could not add the 5-minute repetition; the worker will only start at logon. $($_.Exception.Message)"
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

    Set-WorkerSelfHeal -TaskName $TaskName
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

<#
  바탕화면에 켜기·끄기 바로가기를 놓습니다.

  워커를 켜고 끄려면 지금까지 PowerShell 을 열어 명령을 쳐야 했습니다.
  급할 때 그 명령이 기억나지 않고, 실수로 Disable 까지 걸면 5 분마다 도는
  자동 되살리기마저 멈춰 다시 켤 때까지 아무 일도 일어나지 않습니다.
  더블클릭 하나로 끝나야 그런 일이 안 생깁니다.

  바로가기를 못 만들어도 설치는 끝난 것이므로 막지 않습니다.
#>
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  if ($desktop -and (Test-Path -LiteralPath $desktop)) {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($item in @(
      @{ File = "worker-on.cmd"; Label = "PC 워커 켜기" },
      @{ File = "worker-off.cmd"; Label = "PC 워커 끄기" }
    )) {
      $target = Join-Path $InstallRoot $item.File
      if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { continue }
      $link = $shell.CreateShortcut((Join-Path $desktop ($item.Label + ".lnk")))
      $link.TargetPath = $target
      $link.WorkingDirectory = $InstallRoot
      $link.Description = "울림 문서 변환 워커"
      $link.Save()
    }
    Write-Host "Desktop shortcuts: PC 워커 켜기 / PC 워커 끄기"
  }
} catch {
  Write-Host "Could not create desktop shortcuts: $($_.Exception.Message)"
}

Write-Host "Installed Woolim worker '$WorkerId' in $InstallRoot"
if ($NoAutoStart) {
  Write-Host "Autostart was not registered."
} else {
  Write-Host "Autostart task: $TaskName"
}
Write-Host "No secret was written to the script or scheduled-task arguments."
$recordedSource = [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_SOURCE", "User")
if ($recordedSource) {
  Write-Host "Update source: $recordedSource"
  Write-Host "The worker checks this folder at startup and installs a newer version by itself."
}
