[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = "Stop"
$workerId = [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_ID", "User")
if ([string]::IsNullOrWhiteSpace($workerId) -or $workerId -notmatch '^[a-z0-9][a-z0-9._-]{1,63}$') {
  throw "이 Windows 사용자에게 워커가 설정되지 않았습니다. setup.ps1로 먼저 설정해 주세요."
}
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA) -or -not [IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
  throw "현재 Windows 사용자의 설치 폴더를 확인할 수 없습니다. 워커를 설정한 사용자로 로그인해 주세요."
}
if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
  throw "Windows 10/11의 Windows PowerShell 5.1에서 실행해 주세요. 예약 작업 기능이 필요합니다."
}
$workerRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "WoolimWorker"))
$installRoot = Join-Path $workerRoot "app"
$taskName = "Woolim Mockup Bridge - $workerId"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentUser = $identity.Name
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Principal.UserId) {
  try {
    $existingUserId = [string]$existing.Principal.UserId
    if ($existingUserId -match '^S-1-') {
      $existingUserSid = [Security.Principal.SecurityIdentifier]::new($existingUserId).Value
    } else {
      $existingUserSid = [Security.Principal.NTAccount]::new($existingUserId).Translate([Security.Principal.SecurityIdentifier]).Value
    }
  } catch {
    $existingUserSid = $null
  }
  if ($existingUserSid -ne $identity.User.Value) {
    throw "다른 Windows 사용자의 편집 연결 작업입니다. 워커를 설정한 사용자로 로그인해 주세요."
  }
}

# 원래 설치 파일과 손으로 만든 실행 파일을 지우지 않습니다. 덮어쓰기 전에 복사합니다.
$backupRoot = Join-Path (Join-Path $workerRoot "_replaced") (Get-Date -Format "yyyyMMdd-HHmmss-fffffff")
function Copy-BridgeInstallFile {
  param([string]$Source, [string]$Destination, [string]$BackupName)
  if ([string]::Equals([IO.Path]::GetFullPath($Source), [IO.Path]::GetFullPath($Destination), [StringComparison]::OrdinalIgnoreCase)) { return }
  if ($PSCmdlet.ShouldProcess($Destination, "기존 파일을 보관하고 편집 연결 파일 복사")) {
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
      $backupPath = Join-Path $backupRoot $BackupName
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($backupPath)) -Force | Out-Null
      Copy-Item -LiteralPath $Destination -Destination $backupPath
    }
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($Destination)) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  }
}

$fileNames = @("bridge-launch.ps1", "bridge-install.ps1", "bridge-runtime.ps1", "bridge-update.ps1",
  "bridge-update.cmd", "bridge-rollback.cmd", "launch-hidden.vbs", "approved-preparation-runtimes.json", "approved-runtime.mjs")
foreach ($name in $fileNames) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) {
    throw "필요한 설치 파일이 없습니다. 저장소에서 최신 파일을 받은 뒤 다시 실행해 주세요."
  }
}
foreach ($name in $fileNames) {
  Copy-BridgeInstallFile -Source (Join-Path $PSScriptRoot $name) -Destination (Join-Path $installRoot $name) -BackupName ("app\" + $name)
}
# 예전 작업이 가리키던 두 이름도 유지합니다. 이미 돌아가는 프로세스에는 손대지 않습니다.
Copy-BridgeInstallFile -Source (Join-Path $PSScriptRoot "launch-hidden.vbs") -Destination (Join-Path $workerRoot "launch-hidden.vbs") -BackupName "launch-hidden.vbs"
Copy-BridgeInstallFile -Source (Join-Path $PSScriptRoot "bridge-launch.ps1") -Destination (Join-Path $workerRoot "mockup-bridge-launch.ps1") -BackupName "mockup-bridge-launch.ps1"

function Register-BridgeTask {
  param([string]$InstallRoot, [string]$TaskName, [string]$UserName)
  $destinationLauncher = Join-Path $InstallRoot "bridge-launch.ps1"
  $actionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$destinationLauncher`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArguments -WorkingDirectory $InstallRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserName
  $principal = New-ScheduledTaskPrincipal -UserId $UserName -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Description "울림 PC 장표·가림 편집 연결" -Force | Out-Null
  # Register 전에 넣으면 Windows가 반복값을 조용히 버립니다. 등록 뒤 변경하고 다시 읽습니다.
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if (-not $task.Triggers -or $task.Triggers.Count -lt 1) {
    throw "편집 연결의 로그온 자동 시작을 등록하지 못했습니다. 개발 담당에게 알려 주세요."
  }
  $task.Triggers[0].Repetition = New-CimInstance -ClassName MSFT_TaskRepetitionPattern `
    -Namespace Root/Microsoft/Windows/TaskScheduler -ClientOnly `
    -Property @{ Interval = "PT5M"; StopAtDurationEnd = $false }
  Set-ScheduledTask -InputObject $task -ErrorAction Stop | Out-Null
  $applied = (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).Triggers[0].Repetition.Interval
  if ($applied -ne "PT5M") {
    throw "5분마다 자동 확인하는 설정이 적용되지 않았습니다. 개발 담당에게 알려 주세요."
  }
  Write-Host "편집 연결 자동 시작 · 5분마다 확인 (PT5M 확인됨)"
}
if ($PSCmdlet.ShouldProcess($taskName, "현재 사용자의 편집 연결 로그온 작업 등록")) {
  Register-BridgeTask -InstallRoot $installRoot -TaskName $taskName -UserName $currentUser
}

function New-BridgeShortcuts {
  param([string]$InstallRoot, [string]$Desktop)
  if ($Desktop -and (Test-Path -LiteralPath $Desktop -PathType Container)) {
    foreach ($item in @(
      @{ File = "bridge-update.cmd"; Label = "PC 편집 연결 업데이트" },
      @{ File = "bridge-rollback.cmd"; Label = "PC 편집 연결 되돌리기" }
    )) {
      if ($PSCmdlet.ShouldProcess($item.Label, "바탕화면 바로가기 만들기")) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut((Join-Path $Desktop ($item.Label + ".lnk")))
        $shortcut.TargetPath = Join-Path $InstallRoot $item.File
        $shortcut.WorkingDirectory = $InstallRoot
        $shortcut.Description = "울림 PC 장표·가림 편집 연결"
        $shortcut.Save()
      }
    }
  }
}
try {
  New-BridgeShortcuts -InstallRoot $installRoot -Desktop ([Environment]::GetFolderPath("Desktop"))
} catch {
  Write-Warning "바탕화면 바로가기를 만들지 못했지만 설치는 계속합니다. app 폴더의 bridge-update.cmd로 실행할 수 있습니다."
}
Write-Host "편집 연결 설치 완료. 실행 중인 편집 연결은 그대로 두었습니다."
Write-Host "PC 편집 연결 업데이트를 실행하면 승인된 런타임을 확인하고 연결합니다."
