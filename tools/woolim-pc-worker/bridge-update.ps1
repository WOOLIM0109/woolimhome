[CmdletBinding()]
param([switch]$CheckOnly, [switch]$Rollback)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'bridge-runtime.ps1')

function Assert-BridgeTaskUser {
  param([object]$Task)
  if (-not $Task) { return }
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $owner = [string]$Task.Principal.UserId
    if ($owner -match '^S-1-') { $ownerSid = $owner }
    else { $ownerSid = (New-Object Security.Principal.NTAccount($owner)).Translate([Security.Principal.SecurityIdentifier]).Value }
    if ($ownerSid -ne $identity.User.Value) { throw 'different user' }
  } catch { throw 'PREPARATION_WINDOWS_USER_MISMATCH' }
}

function Get-BridgeUpdateContext {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'PREPARATION_WINDOWS_REQUIRED' }
  $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
  if (-not $node) { throw 'PREPARATION_NODE_22_6_REQUIRED' }
  $versionText = (Invoke-BridgeCommand -FilePath $node.Source -Arguments @('--version') -WorkingDirectory $PSScriptRoot).Trim()
  if ($versionText -notmatch '^v(\d+)\.(\d+)\.\d+$' -or [int]$Matches[1] -lt 22 -or
    ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 6)) {
    if ($versionText -match '^v\d+\.\d+\.\d+$') { Write-Host "이 PC의 Node.js: $versionText" }
    throw 'PREPARATION_NODE_22_6_REQUIRED'
  }
  $source = [Environment]::GetEnvironmentVariable('WOOLIM_WORKER_SOURCE', 'User')
  if (-not $source -or -not (Test-Path -LiteralPath $source -PathType Container)) { throw 'PREPARATION_SOURCE_MISSING' }
  $git = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue
  if (-not $git) { throw 'PREPARATION_GIT_REQUIRED' }
  # install.ps1 remembers tools/woolim-pc-worker, not necessarily the repo root.
  $repository = (Invoke-BridgeCommand -FilePath $git.Source -Arguments @('-C', $source, 'rev-parse', '--show-toplevel') `
    -WorkingDirectory $source -FailureCode 'PREPARATION_SOURCE_MISSING').Trim()
  if (-not (Test-Path -LiteralPath (Join-Path $repository 'scripts\package-preparation-runtime.mjs') -PathType Leaf)) {
    throw 'PREPARATION_SOURCE_MISSING'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $repository 'node_modules') -PathType Container)) { throw 'PREPARATION_DEPENDENCY_MISSING' }
  if (-not $env:LOCALAPPDATA -or -not [IO.Path]::IsPathRooted($env:LOCALAPPDATA)) { throw 'PREPARATION_PRIVATE_ROOT_INVALID' }
  $workerRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'WoolimWorker'))
  $repositoryPath = [IO.Path]::GetFullPath($repository).TrimEnd('\')
  if ([string]::Equals($workerRoot.TrimEnd('\'), $repositoryPath, [StringComparison]::OrdinalIgnoreCase) -or
    $workerRoot.StartsWith($repositoryPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'PREPARATION_STAGING_INSIDE_REPOSITORY'
  }
  $workerId = [Environment]::GetEnvironmentVariable('WOOLIM_WORKER_ID', 'User')
  if ($workerId -notmatch '^[a-z0-9][a-z0-9._-]{1,63}$') { throw 'PREPARATION_WORKER_ID_INVALID' }
  $taskName = "Woolim Mockup Bridge - $workerId"
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Assert-BridgeTaskUser -Task $task
  return [pscustomobject]@{ NodePath = $node.Source; GitPath = $git.Source; Repository = $repository;
    WorkerRoot = $workerRoot; WorkerId = $workerId; TaskName = $taskName; Task = $task }
}

function Get-BridgeReviewCount {
  param([string]$WorkerRoot)
  $privateRoot = Join-Path $WorkerRoot 'p'
  if (-not (Test-Path -LiteralPath $privateRoot -PathType Container)) { return 0 }
  $count = 0
  foreach ($directory in @(Get-ChildItem -LiteralPath $privateRoot -Directory)) {
    $sessionPath = Join-Path $directory.FullName 'bridge-session.json'
    if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf)) { continue }
    try { $session = Get-Content -LiteralPath $sessionPath -Encoding UTF8 -Raw | ConvertFrom-Json }
    catch { throw 'PREPARATION_SESSION_STATE_INVALID' }
    if ($session.state -ceq 'review') { $count++ }
  }
  return $count
}

function Get-BridgeLegacyRuntime {
  param([string]$WorkerRoot)
  $running = Get-BridgeLockedProcess -WorkerRoot $WorkerRoot
  if (-not $running) { return $null }
  $fingerprint = Get-BridgeProcessFingerprint -Process $running
  # This recovers a rollback target from the old live daemon without reading its
  # handwritten launcher or its settings. It must still pass the runtime check.
  if ($running.CommandLine -notmatch '(?i)(?:"(?<quoted>[^"\r\n]+[\\/]scripts[\\/]run-production-mockup-worker\.mjs)"|(?<plain>[^\s"]+[\\/]scripts[\\/]run-production-mockup-worker\.mjs))') {
    throw 'PREPARATION_RUNTIME_CONFIG_INVALID'
  }
  $scriptPath = if ($Matches.quoted) { $Matches.quoted } else { $Matches.plain }
  $record = Assert-BridgeRuntimeRecord -WorkerRoot $WorkerRoot -Record ([pscustomobject]@{
    path = Split-Path (Split-Path $scriptPath -Parent) -Parent; fingerprint = $fingerprint })
  return [pscustomobject]@{ path = $record.path; fingerprint = $record.fingerprint; previous = $null }
}

function Read-BridgeFetchedApprovals {
  param([object]$Context)
  $null = Invoke-BridgeCommand -FilePath $Context.GitPath -Arguments @('fetch', 'origin', 'main') `
    -WorkingDirectory $Context.Repository -FailureCode 'PREPARATION_APPROVAL_FETCH_FAILED'
  return Invoke-BridgeCommand -FilePath $Context.GitPath `
    -Arguments @('show', 'origin/main:tools/woolim-pc-worker/approved-preparation-runtimes.json') `
    -WorkingDirectory $Context.Repository -FailureCode 'PREPARATION_APPROVAL_FETCH_FAILED'
}

function Get-BridgeApproval {
  param([object]$Context, [string]$Approvals, [string[]]$Arguments)
  $raw = Invoke-BridgeCommand -FilePath $Context.NodePath `
    -Arguments (@((Join-Path $PSScriptRoot 'approved-runtime.mjs')) + $Arguments) `
    -InputText $Approvals -WorkingDirectory $Context.Repository -FailureCode 'PREPARATION_APPROVAL_LIST_INVALID'
  try { return $raw | ConvertFrom-Json } catch { throw 'PREPARATION_APPROVAL_LIST_INVALID' }
}

function Invoke-BridgeUpdate {
  param([switch]$CheckOnly, [switch]$Rollback)
  $context = Get-BridgeUpdateContext
  $mutex = New-Object Threading.Mutex($false, ('Local\WoolimBridgeUpdate-' + $context.WorkerId))
  $held = $false
  try {
    try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'PREPARATION_UPDATE_ALREADY_RUNNING' }
    $current = Read-BridgeRuntimeConfig -WorkerRoot $context.WorkerRoot
    if (-not $current) { $current = Get-BridgeLegacyRuntime -WorkerRoot $context.WorkerRoot }
    if (-not $CheckOnly) {
      $reviewCount = Get-BridgeReviewCount -WorkerRoot $context.WorkerRoot
      if ($reviewCount -gt 0) {
        $answer = Read-Host "지금 편집 중이거나 열려 있는 요청이 $reviewCount`건 있습니다. 업데이트하면 열린 편집 화면이 닫힙니다. 계속할까요? (Y/N)"
        if ($answer -cne 'Y' -and $answer -cne 'y') { Write-Host '취소했습니다. 이전 상태를 그대로 유지합니다.'; return }
      }
    }
    $approvals = Read-BridgeFetchedApprovals -Context $context
    $null = Get-BridgeApproval -Context $context -Approvals $approvals -Arguments @('--latest')
    if ($Rollback) {
      if (-not $current -or -not $current.previous) { throw 'PREPARATION_ROLLBACK_MISSING' }
      $target = Assert-BridgeRuntimeRecord -Record $current.previous -WorkerRoot $context.WorkerRoot
      $approved = Get-BridgeApproval -Context $context -Approvals $approvals -Arguments @('--rollback-fingerprint', $target.fingerprint)
    } else {
      New-Item -ItemType Directory -Path $context.WorkerRoot -Force | Out-Null
      $staging = Join-Path (Join-Path $context.WorkerRoot 'staging') ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $staging | Out-Null
      Write-Host '설치 파일을 만들고 승인된 지문과 대조합니다...'
      $raw = Invoke-BridgeCommand -FilePath $context.NodePath -WorkingDirectory $context.Repository `
        -Arguments @('scripts/package-preparation-runtime.mjs', '--output', $staging) -FailureCode 'PREPARATION_PACKAGE_FAILED'
      try { $package = $raw | ConvertFrom-Json } catch { throw 'PREPARATION_PACKAGE_FAILED' }
      $approved = Get-BridgeApproval -Context $context -Approvals $approvals -Arguments @('--fingerprint', $package.fingerprint)
      $raw = Invoke-BridgeCommand -FilePath $context.NodePath -WorkingDirectory $context.Repository `
        -Arguments @('scripts/install-preparation-runtime.mjs', '--package', $staging, '--runtime-root',
          (Join-Path $context.WorkerRoot 'preparation-runtimes'), '--expected-fingerprint', $approved.fingerprint) `
        -FailureCode 'PREPARATION_INSTALL_FAILED'
      try { $installed = $raw | ConvertFrom-Json } catch { throw 'PREPARATION_INSTALL_FAILED' }
      $target = Assert-BridgeRuntimeRecord -Record ([pscustomobject]@{ path = $installed.runtimeRoot; fingerprint = $approved.fingerprint }) `
        -WorkerRoot $context.WorkerRoot
      if (-not [string]::Equals($installed.fingerprint, $approved.fingerprint, [StringComparison]::Ordinal) -or
        $installed.activated -isnot [bool] -or $installed.activated -ne $false) { throw 'PREPARATION_INSTALL_FAILED' }
    }
    Invoke-BridgeRuntimeCheck -NodePath $context.NodePath -Record $target
    if ($CheckOnly) {
      Write-Host "확인 완료 · 버전 $($approved.version) · 지문 $($approved.fingerprint) (승인됨). 전환·재시작하지 않았습니다." -ForegroundColor Green
      return
    }
    if (-not $context.Task) { throw 'PREPARATION_BRIDGE_TASK_MISSING' }
    if ($current -and $current.fingerprint -cne $target.fingerprint) {
      # A failed switch may only return to a verified, trusted previous runtime.
      $null = Get-BridgeApproval -Context $context -Approvals $approvals -Arguments @('--rollback-fingerprint', $current.fingerprint)
      Invoke-BridgeRuntimeCheck -NodePath $context.NodePath -Record $current
    }
    Invoke-BridgeRuntimeSwitch -WorkerRoot $context.WorkerRoot -TaskName $context.TaskName -Target $target -Current $current
    $label = if ($Rollback) { '되돌리기 완료' } else { '업데이트 완료' }
    Write-Host "$label · 버전 $($approved.version) · 지문 $($approved.fingerprint) (승인됨)" -ForegroundColor Green
  } finally { if ($held) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}

function Show-BridgeUpdateError {
  param([string]$Code)
  $message = switch -Regex ($Code) {
    '^PREPARATION_NODE_22_6_REQUIRED$' { 'Node.js 22.6 이상이 필요합니다. 개발 담당에게 설치를 요청해 주세요.'; break }
    '^PREPARATION_DEPENDENCY_MISSING$' { '필요한 부품 폴더(node_modules)가 없습니다. 개발 담당에게 알려 주세요. 자동으로 내려받지 않습니다.'; break }
    '^PREPARATION_FINGERPRINT_NOT_APPROVED$' { '이 PC의 파일이 승인된 버전과 다릅니다. 설치하지 않았습니다. (원인 후보: 아직 최신 코드를 받지 않음 / 승인되지 않은 수정). 개발 담당에게 git pull과 승인 목록 확인을 요청해 주세요.'; break }
    '^PREPARATION_PACKAGE_(FILE|MANIFEST|SOURCE|EXTRA)' { '설치 파일이 중간에 바뀌었거나 깨졌습니다. 설치하지 않았습니다. 개발 담당에게 파일을 다시 받아 달라고 요청해 주세요.'; break }
    '^PREPARATION_APPROVAL_' { '최신 승인 목록을 원격 main에서 읽지 못했습니다. 설치하지 않았습니다. 인터넷 연결과 저장소 접근 권한을 확인해 주세요.'; break }
    '^PREPARATION_WINDOWS_USER_MISMATCH$' { '이 편집 연결을 설치한 Windows 사용자로 로그인해서 다시 실행해 주세요.'; break }
    '^PREPARATION_SOURCE_MISSING$' { '저장소 위치를 찾지 못했습니다. 개발 담당에게 WOOLIM_WORKER_SOURCE 설정을 확인해 달라고 요청해 주세요.'; break }
    '^PREPARATION_ROLLBACK_MISSING$' { '되돌릴 이전 설치 기록이 없습니다. 현재 버전을 유지합니다.'; break }
    '^PREPARATION_BRIDGE_TASK_MISSING$' { '편집 연결 작업이 없습니다. 개발 담당에게 bridge-install.ps1로 먼저 설치해 달라고 요청해 주세요.'; break }
    '^PREPARATION_BRIDGE_RESTORE_FAILED$' { '이전 설정으로 되돌렸지만 실행을 확인하지 못했습니다. 개발 담당에게 편집 연결 작업과 로그 확인을 요청해 주세요.'; break }
    '^PREPARATION_(RUNTIME_CHECK_FAILED|RUNTIME_CONFIG_INVALID|BRIDGE_LOCK_INVALID)$' { '편집 연결 설치 기록 또는 실행 검사가 맞지 않습니다. 전환하지 않았습니다. 개발 담당에게 설정과 설치 파일 확인을 요청해 주세요.'; break }
    '^PREPARATION_SESSION_STATE_INVALID$' { '열린 편집 요청의 상태를 읽지 못했습니다. 이전 상태를 유지합니다. 개발 담당에게 상태 기록 확인을 요청해 주세요.'; break }
    '^PREPARATION_UPDATE_ALREADY_RUNNING$' { '이미 업데이트가 실행 중입니다. 먼저 열린 업데이트 창이 끝난 뒤 다시 실행해 주세요.'; break }
    default { '편집 연결 업데이트를 마치지 못했습니다. 개발 담당에게 아래 기술 코드와 로그 확인을 요청해 주세요.' }
  }
  Write-Host $message -ForegroundColor Yellow
  if ($Code -cnotmatch '^(PREPARATION|MOCKUP_BRIDGE)_[A-Z0-9_]+$') { $Code = 'PREPARATION_UPDATE_FAILED' }
  Write-Host "기술 코드: $Code" -ForegroundColor DarkGray
}

try { Invoke-BridgeUpdate -CheckOnly:$CheckOnly -Rollback:$Rollback }
catch { Show-BridgeUpdateError -Code $_.Exception.Message; exit 1 }
