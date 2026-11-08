[CmdletBinding()]
param()

# 이 파일과 예전 이름(mockup-bridge-launch.ps1)은 같은 설정 파일을 봅니다.
# 실행 중인 Node의 잠금은 Node만 만들고 회수합니다.
function Write-BridgeLaunchLog {
  param([string]$WorkerRoot, [string]$Message)
  Add-Content -LiteralPath (Join-Path $WorkerRoot "bridge-launch.log") `
    -Value ("{0} {1}" -f [DateTime]::UtcNow.ToString("o"), $Message) -Encoding UTF8
}

function Get-BridgeLaunchRuntime {
  param([string]$WorkerRoot)
  $config = Get-Content -LiteralPath (Join-Path $WorkerRoot "bridge-runtime.json") -Encoding UTF8 -Raw | ConvertFrom-Json
  if ($config.fingerprint -isnot [string] -or $config.fingerprint -cnotmatch '^[0-9a-fA-F]{64}$' -or
      $config.path -isnot [string] -or -not [IO.Path]::IsPathRooted($config.path)) {
    throw "BRIDGE_RUNTIME_INVALID"
  }
  $expected = Join-Path (Join-Path $WorkerRoot "preparation-runtimes") ("1.0.0-" + $config.fingerprint)
  # 대소문자까지 같은 지문을 폴더 이름에 요구합니다. 상대 경로와 다른 폴더는 거부합니다.
  if (-not [string]::Equals([IO.Path]::GetFullPath($config.path), $expected, [StringComparison]::Ordinal) -or
      -not (Test-Path -LiteralPath $expected -PathType Container)) { throw "BRIDGE_RUNTIME_INVALID" }
  foreach ($directory in @($WorkerRoot, (Join-Path $WorkerRoot "preparation-runtimes"), $expected)) {
    if ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "BRIDGE_RUNTIME_INVALID"
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $expected "scripts\run-production-mockup-worker.mjs") -PathType Leaf)) {
    throw "BRIDGE_RUNTIME_INVALID"
  }
  return $config
}

function Test-BridgeLaunchLock {
  param([string]$WorkerRoot)
  $lockPath = Join-Path $WorkerRoot "p\mockup-bridge.lock"
  if (-not (Test-Path -LiteralPath $lockPath)) { return $false }
  $item = Get-Item -LiteralPath $lockPath
  if ($item.PSIsContainer -or $item.Length -gt 256 -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "BRIDGE_LOCK_INVALID" }
  $record = Get-Content -LiteralPath $lockPath -Encoding UTF8 -Raw | ConvertFrom-Json
  $processId = 0
  if (-not [int]::TryParse([string]$record.pid, [ref]$processId) -or $processId -lt 1) {
    throw "BRIDGE_LOCK_INVALID"
  }
  # 다른 프로그램으로 재사용된 PID라도 잠금을 지우거나 그 프로그램을 끄지 않습니다.
  return [bool](Get-Process -Id $processId -ErrorAction SilentlyContinue)
}

function Remove-OldBridgeLogs {
  param([string]$WorkerRoot)
  $logRoot = Join-Path $WorkerRoot "mockup-bridge-logs"
  if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) { return }
  if ((Get-Item -LiteralPath $logRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { return }
  $resolvedRoot = [IO.Path]::GetFullPath($logRoot).TrimEnd('\') + '\'
  $cutoff = [DateTime]::UtcNow.AddDays(-14)
  foreach ($item in @(Get-ChildItem -LiteralPath $logRoot -Filter "*.log" -File)) {
    $resolvedFile = [IO.Path]::GetFullPath($item.FullName)
    if ($resolvedFile.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetDirectoryName($resolvedFile) -eq $resolvedRoot.TrimEnd('\') -and
        -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.LastWriteTimeUtc -lt $cutoff) {
      Remove-Item -LiteralPath $resolvedFile
    }
  }
}

function Write-BridgeRestartNotice {
  param([string]$WorkerRoot)
  $historyPath = Join-Path $WorkerRoot "bridge-launch-history.json"
  $now = [DateTime]::UtcNow
  $history = @()
  if (Test-Path -LiteralPath $historyPath -PathType Leaf) {
    try {
      # Windows PowerShell 5.1은 ConvertFrom-Json 배열을 다음 파이프에 한 객체로 넘깁니다.
      # 배열을 명시적으로 순회해야 이전 실행 기록이 파싱 오류로 사라지지 않습니다.
      $savedHistory = Get-Content -LiteralPath $historyPath -Encoding UTF8 -Raw | ConvertFrom-Json
      foreach ($entry in @($savedHistory)) {
        if ([DateTime]::Parse([string]$entry).ToUniversalTime() -ge $now.AddMinutes(-10)) {
          $history += [string]$entry
        }
      }
    } catch { $history = @() }
  }
  $history = @($history) + @($now.ToString("o"))
  ConvertTo-Json -InputObject $history -Compress | Set-Content -LiteralPath $historyPath -Encoding UTF8
  if ($history.Count -ge 3) {
    Write-BridgeLaunchLog -WorkerRoot $WorkerRoot -Message ("10분 안에 {0}번 재시작했습니다. 반복되면 개발 담당에게 알려 주세요." -f $history.Count)
  }
}

function Start-BridgeLaunchChild {
  param([string]$NodePath, [object]$Runtime, [string]$LogRoot)
  $entryPoint = Join-Path $Runtime.path 'scripts\run-production-mockup-worker.mjs'
  $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N')
  $child = Start-Process -FilePath $NodePath -WorkingDirectory $Runtime.path `
    -ArgumentList ("--experimental-strip-types `"{0}`" --expected-fingerprint {1}" -f $entryPoint, $Runtime.fingerprint) `
    -RedirectStandardOutput (Join-Path $LogRoot ($stamp + '.stdout.log')) `
    -RedirectStandardError (Join-Path $LogRoot ($stamp + '.stderr.log')) `
    -WindowStyle Hidden -PassThru
  # Keep the process handle available for ExitCode after WaitForExit on PS 5.1.
  $null = $child.Handle
  return $child
}

function Stop-BridgeLaunchCandidate {
  param([object]$Child)
  # This is the handle returned by our own Start-Process, never a discovered PID.
  try {
    $Child.Refresh()
    if (-not $Child.HasExited) { $Child.Kill(); $Child.WaitForExit() }
  } finally { $Child.Dispose() }
}

function Get-BridgeLaunchUpdateScript {
  # The legacy launcher is installed one directory above the app helpers.
  $updater = Join-Path $PSScriptRoot 'bridge-update.ps1'
  if (-not (Test-Path -LiteralPath $updater -PathType Leaf)) {
    $updater = Join-Path $PSScriptRoot 'app\bridge-update.ps1'
  }
  return $updater
}

function Invoke-BridgeLaunchAutoUpdate {
  param([string]$WorkerRoot, [object]$Current, [string]$NodePath, [string]$LogRoot)
  $updateMutex = $null
  $ownsUpdateMutex = $false
  $changed = $false
  $candidate = $null
  try {
    # Load helpers within the failure boundary, so even a missing helper falls
    # back to the current runtime. Dot-sourcing never starts an explicit update.
    . (Get-BridgeLaunchUpdateScript)
    if ((Get-BridgeReviewCount -WorkerRoot $WorkerRoot) -gt 0) {
      Write-BridgeLaunchLog -WorkerRoot $WorkerRoot -Message '편집 중인 요청이 있어 자동 업데이트를 다음 실행으로 미룹니다.'
      return $null
    }
    $context = Get-BridgeUpdateContext
    if (-not [string]::Equals($context.WorkerRoot, $WorkerRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'PREPARATION_RUNTIME_CONFIG_INVALID'
    }
    $updateMutex = New-Object Threading.Mutex($false, ('Local\WoolimBridgeUpdate-' + $context.WorkerId))
    try { $ownsUpdateMutex = $updateMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsUpdateMutex = $true }
    # A manual update starts this launcher while it still holds the update mutex.
    # Use the runtime it selected immediately, without fetching or waiting on it.
    if (-not $ownsUpdateMutex) { return $null }
    $approvals = Read-BridgeFetchedApprovals -Context $context
    $approved = Get-BridgeApproval -Context $context -Approvals $approvals -Arguments @('--latest')
    if ([string]::Equals($approved.fingerprint, $Current.fingerprint, [StringComparison]::Ordinal) -or -not $approved.url) {
      return $null
    }
    # Validate the complete saved rollback record before a change. A malformed
    # previous field must not make restoration fail after starting a candidate.
    $null = Read-BridgeRuntimeConfig -WorkerRoot $WorkerRoot
    $target = Get-BridgePreparedRuntime -Context $context -Approvals $approvals -Approved $approved
    Invoke-BridgeRuntimeCheck -NodePath $NodePath -Record $target
    $null = Get-BridgeApproval -Context $context -Approvals $approvals -Arguments @('--rollback-fingerprint', $Current.fingerprint)
    Invoke-BridgeRuntimeCheck -NodePath $NodePath -Record $Current
    if ((Get-BridgeReviewCount -WorkerRoot $WorkerRoot) -gt 0) {
      Write-BridgeLaunchLog -WorkerRoot $WorkerRoot -Message '편집 중인 요청이 있어 자동 업데이트를 다음 실행으로 미룹니다.'
      return $null
    }
    $next = [pscustomobject]@{ path = $target.path; fingerprint = $target.fingerprint;
      previous = [pscustomobject]@{ path = $Current.path; fingerprint = $Current.fingerprint } }
    Write-BridgeRuntimeConfig -WorkerRoot $WorkerRoot -Config $next
    $changed = $true
    $candidate = Start-BridgeLaunchChild -NodePath $NodePath -Runtime $target -LogRoot $LogRoot
    if (-not (Wait-BridgeRuntime -WorkerRoot $WorkerRoot -Fingerprint $target.fingerprint -OldProcessId 0)) {
      throw 'PREPARATION_BRIDGE_START_TIMEOUT'
    }
    Write-BridgeLaunchLog -WorkerRoot $WorkerRoot -Message ('승인된 편집 연결로 자동 업데이트했습니다. 지문: ' + $target.fingerprint)
    return $candidate
  } catch {
    $code = $_.Exception.Message
    if ($code -cnotmatch '^PREPARATION_[A-Z0-9_]+$') { $code = 'PREPARATION_AUTO_UPDATE_FAILED' }
    if ($candidate) {
      try { Stop-BridgeLaunchCandidate -Child $candidate }
      catch { $code = 'PREPARATION_BRIDGE_RESTORE_FAILED' }
    }
    if ($changed) {
      try { Write-BridgeRuntimeConfig -WorkerRoot $WorkerRoot -Config $Current }
      catch { $code = 'PREPARATION_BRIDGE_RESTORE_FAILED' }
    }
    # Update failure must not prevent the existing runtime from starting.
    try { Write-BridgeLaunchLog -WorkerRoot $WorkerRoot -Message ('자동 업데이트를 마치지 못해 기존 편집 연결을 시작합니다. 기술 코드: ' + $code) }
    catch { }
    return $null
  } finally {
    if ($ownsUpdateMutex) { $updateMutex.ReleaseMutex() }
    if ($updateMutex) { $updateMutex.Dispose() }
  }
}

function Invoke-BridgeLaunch {
  $ErrorActionPreference = "Stop"
  $workerRoot = $null
  $mutex = $null
  $ownsMutex = $false
  try {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA) -or -not [IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
      return 1
    }
    $workerRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "WoolimWorker"))
    New-Item -ItemType Directory -Path $workerRoot -Force | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mutex = New-Object Threading.Mutex($false, ("Local\WoolimMockupBridgeLaunch-" + $sid))
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { return 0 }
    if (Test-BridgeLaunchLock -WorkerRoot $workerRoot) { return 0 }
    $runtime = Get-BridgeLaunchRuntime -WorkerRoot $workerRoot
    Remove-OldBridgeLogs -WorkerRoot $workerRoot
    $logRoot = Join-Path $workerRoot "mockup-bridge-logs"
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    if ((Get-Item -LiteralPath $logRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "BRIDGE_LOG_ROOT_INVALID"
    }
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    Write-BridgeRestartNotice -WorkerRoot $workerRoot
    Write-BridgeLaunchLog -WorkerRoot $workerRoot -Message "편집 연결을 시작합니다."
    $child = Invoke-BridgeLaunchAutoUpdate -WorkerRoot $workerRoot -Current $runtime -NodePath $node -LogRoot $logRoot
    if (-not $child) { $child = Start-BridgeLaunchChild -NodePath $node -Runtime $runtime -LogRoot $logRoot }
    try { $child.WaitForExit(); $exitCode = $child.ExitCode }
    finally { $child.Dispose() }
    if ($exitCode -ne 0) {
      Write-BridgeLaunchLog -WorkerRoot $workerRoot -Message "편집 연결이 멈췄습니다. PC 편집 연결 업데이트를 실행하거나 개발 담당에게 알려 주세요."
      return 1
    }
    return 0
  } catch {
    if ($workerRoot) {
      $message = if ($_.Exception.Message -eq "BRIDGE_LOCK_INVALID") {
        "실행 잠금 파일을 확인할 수 없어 시작하지 않았습니다. 개발 담당에게 알려 주세요."
      } elseif ($_.Exception.Message -eq "BRIDGE_RUNTIME_INVALID" -or $_.Exception -is [IO.FileNotFoundException] -or
          $_.Exception -is [Management.Automation.ItemNotFoundException]) {
        "설치 경로 또는 지문이 올바르지 않아 시작하지 않았습니다. PC 편집 연결 업데이트를 실행해 주세요."
      } else {
        "편집 연결을 시작하지 못했습니다. 설치 경로와 설정을 개발 담당에게 확인해 주세요."
      }
      Write-BridgeLaunchLog -WorkerRoot $workerRoot -Message $message
    }
    return 1
  } finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
  }
}

if ($MyInvocation.InvocationName -ne ".") { exit (Invoke-BridgeLaunch) }
