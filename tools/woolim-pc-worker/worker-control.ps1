<#
.SYNOPSIS
  회사 PC 의 문서 변환 워커를 켜고 끕니다.

.DESCRIPTION
  워커를 켜고 끄려면 지금까지 PowerShell 을 열어 명령을 직접 쳐야 했습니다.
  급할 때 그 명령을 기억하기 어렵고, 실수로 Disable 까지 걸면 5 분마다 도는
  자동 되살리기까지 멈춰서 다시 켤 때까지 아무 일도 일어나지 않았습니다.

  그래서 옆의 worker-on.cmd / worker-off.cmd 를 더블클릭하면 이 스크립트가
  대신 실행됩니다. 관리자 권한은 필요 없습니다. 워커 작업은 로그인한 사용자
  이름으로 등록되어 있어, 그 사용자가 자기 작업을 켜고 끄는 것뿐입니다.

.PARAMETER Action
  On  : 자동 시작을 되살리고 지금 바로 실행합니다.
  Off : 지금 실행 중인 것을 멈추고 자동 시작도 멈춥니다.
  Status : 지금 상태만 보여 줍니다.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("On", "Off", "Status")]
  [string]$Action
)

$ErrorActionPreference = "Stop"
$TaskFilter = "Woolim Worker - *"

<#
  창 제목은 여기서 붙입니다.

  .cmd 파일은 cmd.exe 가 OEM 코드페이지로 읽기 때문에 한글을 넣으면 깨집니다.
  이 파일은 BOM 이 붙은 UTF-8 이라 PowerShell 이 제대로 읽습니다.
  제목이 안 붙어도 하려던 일은 그대로 되므로 실패는 삼킵니다.
#>
try {
  $Host.UI.RawUI.WindowTitle = switch ($Action) {
    "On" { "워커 켜기" }
    "Off" { "워커 끄기" }
    default { "워커 상태 보기" }
  }
} catch {}

function Get-WorkerTasks {
  $tasks = @(Get-ScheduledTask -TaskName $TaskFilter -ErrorAction SilentlyContinue)
  if (-not $tasks.Count) {
    Write-Host ""
    Write-Host "  워커가 이 PC 에 설치되어 있지 않습니다." -ForegroundColor Yellow
    Write-Host "  install.ps1 로 먼저 설치해 주세요." -ForegroundColor Yellow
    Write-Host ""
    return @()
  }
  return $tasks
}

function Show-WorkerStatus {
  param([object[]]$Tasks)
  foreach ($task in $Tasks) {
    $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -ErrorAction SilentlyContinue
    # Disabled 는 '꺼짐' 이 아니라 '자동으로 다시 켜지지도 않음' 입니다.
    # 이 둘을 구분해 주지 않으면 왜 안 살아나는지 알 수가 없습니다.
    $auto = if ($task.State -eq "Disabled") { "꺼짐 (자동 시작 안 함)" } else { "켜짐 (5분마다 자동 확인)" }
    $running = if ($task.State -eq "Running") { "실행 중" } else { "멈춤" }
    Write-Host ""
    Write-Host "  $($task.TaskName)"
    Write-Host "    자동 시작 : $auto"
    Write-Host "    지금 상태 : $running"
    if ($info -and $info.LastRunTime) {
      Write-Host "    마지막 실행 : $($info.LastRunTime)"
    }
  }
  Write-Host ""
}

$tasks = Get-WorkerTasks
if (-not $tasks.Count) { exit 1 }

switch ($Action) {
  "On" {
    Write-Host ""
    Write-Host "  워커를 켭니다..." -ForegroundColor Cyan
    $failed = 0
    foreach ($task in $tasks) {
      try {
        # Enable 을 먼저 합니다. Disabled 상태에서는 Start 가 조용히 무시됩니다.
        Enable-ScheduledTask -TaskName $task.TaskName | Out-Null
        Start-ScheduledTask -TaskName $task.TaskName
      } catch {
        # 한 대가 실패해도 나머지는 켭니다. 그리고 왜 실패했는지 한글로 알려 줍니다.
        $failed += 1
        Write-Host ""
        Write-Host "  $($task.TaskName) 를 켜지 못했습니다." -ForegroundColor Red
        Write-Host "  이유: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  이 워커를 만든 Windows 사용자로 로그인했는지 확인해 주세요." -ForegroundColor Yellow
      }
    }
    Start-Sleep -Seconds 2
    if ($failed -lt $tasks.Count) {
      Write-Host "  켰습니다." -ForegroundColor Green
    }
    Show-WorkerStatus -Tasks (Get-WorkerTasks)
    Write-Host "  관리자 화면에서 '온라인'으로 바뀌기까지 1분쯤 걸립니다."
    Write-Host ""
  }
  "Off" {
    Write-Host ""
    Write-Host "  워커를 끕니다..." -ForegroundColor Cyan
    $failed = 0
    foreach ($task in $tasks) {
      try {
        Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue
        Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
      } catch {
        $failed += 1
        Write-Host ""
        Write-Host "  $($task.TaskName) 를 끄지 못했습니다." -ForegroundColor Red
        Write-Host "  이유: $($_.Exception.Message)" -ForegroundColor Red
      }
    }
    if ($failed -lt $tasks.Count) {
      Write-Host "  껐습니다. PowerPoint 가 더 이상 저절로 열리지 않습니다." -ForegroundColor Green
    }
    Show-WorkerStatus -Tasks (Get-WorkerTasks)
    Write-Host "  주의: 서버에 쌓인 변환 대기 작업은 그대로 남아 있습니다."
    Write-Host "        다시 켜면 그것부터 처리합니다. 필요 없는 작업은"
    Write-Host "        관리자 화면에서 먼저 지워 주세요."
    Write-Host ""
  }
  "Status" {
    Show-WorkerStatus -Tasks $tasks
  }
}
