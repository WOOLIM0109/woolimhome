# Dot-sourced functions only. Loading this file never reads worker settings or starts a task.

function ConvertTo-BridgeNativeArgument {
  param([AllowEmptyString()][string]$Value)
  # Windows CommandLineToArgvW quoting, including backslashes before quotes/end.
  return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-BridgeCommand {
  param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory,
    [string]$InputText, [string]$FailureCode = 'PREPARATION_COMMAND_FAILED')
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $FilePath
  $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-BridgeNativeArgument $_ }) -join ' ')
  $start.WorkingDirectory = $WorkingDirectory
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.RedirectStandardInput = $true
  $start.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $start.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
  $child = New-Object System.Diagnostics.Process
  $child.StartInfo = $start
  try {
    if (-not $child.Start()) { throw $FailureCode }
    $output = $child.StandardOutput.ReadToEndAsync()
    $errors = $child.StandardError.ReadToEndAsync()
    if ($InputText) {
      $inputBytes = (New-Object Text.UTF8Encoding($false)).GetBytes($InputText)
      $child.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
      $child.StandardInput.BaseStream.Flush()
    }
    $child.StandardInput.Close()
    $child.WaitForExit()
    $stdout = $output.GetAwaiter().GetResult()
    $stderr = $errors.GetAwaiter().GetResult()
    if ($child.ExitCode -ne 0) {
      # Never echo child output. Only known-shaped diagnostic codes may cross this boundary.
      $code = @($stderr -split '\r?\n' | Where-Object { $_ -cmatch '^(PREPARATION|MOCKUP_BRIDGE)_[A-Z0-9_]+(?::[^\r\n]*)?$' } | Select-Object -Last 1)
      if ($code.Count) { throw (($code[0] -split ':', 2)[0]) }
      throw $FailureCode
    }
    return $stdout
  } finally { $child.Dispose() }
}

function Assert-BridgeRuntimeRecord {
  param([object]$Record, [string]$WorkerRoot)
  if (-not $Record -or $Record.fingerprint -isnot [string] -or
    $Record.fingerprint -cnotmatch '^[a-fA-F0-9]{64}$' -or $Record.path -isnot [string]) {
    throw 'PREPARATION_RUNTIME_CONFIG_INVALID'
  }
  $expected = Join-Path (Join-Path $WorkerRoot 'preparation-runtimes') ('1.0.0-' + $Record.fingerprint)
  if (-not [IO.Path]::IsPathRooted([string]$Record.path) -or
    -not [string]::Equals([IO.Path]::GetFullPath($Record.path), [IO.Path]::GetFullPath($expected), [StringComparison]::OrdinalIgnoreCase) -or
    -not [string]::Equals((Split-Path $Record.path -Leaf), ('1.0.0-' + $Record.fingerprint), [StringComparison]::Ordinal)) {
    throw 'PREPARATION_RUNTIME_CONFIG_INVALID'
  }
  return [pscustomobject]@{ path = [IO.Path]::GetFullPath($expected); fingerprint = [string]$Record.fingerprint }
}

function Read-BridgeRuntimeConfig {
  param([string]$WorkerRoot)
  $configPath = Join-Path $WorkerRoot 'bridge-runtime.json'
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $null }
  try {
    $config = Get-Content -LiteralPath $configPath -Encoding UTF8 -Raw | ConvertFrom-Json
    $current = Assert-BridgeRuntimeRecord -Record $config -WorkerRoot $WorkerRoot
    $previous = if ($config.previous) { Assert-BridgeRuntimeRecord -Record $config.previous -WorkerRoot $WorkerRoot } else { $null }
    return [pscustomobject]@{ path = $current.path; fingerprint = $current.fingerprint; previous = $previous }
  } catch { throw 'PREPARATION_RUNTIME_CONFIG_INVALID' }
}

function Write-BridgeRuntimeConfig {
  param([string]$WorkerRoot, [object]$Config)
  $null = Assert-BridgeRuntimeRecord -Record $Config -WorkerRoot $WorkerRoot
  if ($Config.previous) { $null = Assert-BridgeRuntimeRecord -Record $Config.previous -WorkerRoot $WorkerRoot }
  $target = Join-Path $WorkerRoot 'bridge-runtime.json'
  $temporary = Join-Path $WorkerRoot ('bridge-runtime.' + [guid]::NewGuid().ToString('N') + '.tmp')
  [IO.File]::WriteAllText($temporary, ($Config | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $target -PathType Leaf) { [IO.File]::Replace($temporary, $target, [NullString]::Value) }
  else { [IO.File]::Move($temporary, $target) }
}

function Get-BridgeLockedProcess {
  param([string]$WorkerRoot)
  $lockPath = Join-Path $WorkerRoot 'p\mockup-bridge.lock'
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { return $null }
  try {
    $info = Get-Item -LiteralPath $lockPath
    if ($info.Length -gt 256 -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'invalid' }
    $record = Get-Content -LiteralPath $lockPath -Encoding UTF8 -Raw | ConvertFrom-Json
    $number = 0
    if (-not [int]::TryParse([string]$record.pid, [ref]$number) -or $number -lt 1) { throw 'invalid' }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $number" -ErrorAction Stop
    if (-not $process) { return $null }
    if ($process.Name -ine 'node.exe' -or $process.CommandLine -notmatch '(?i)(?:^|[\\/\s"])run-production-mockup-worker\.mjs(?:"|\s|$)') {
      throw 'invalid'
    }
    return $process
  } catch { throw 'PREPARATION_BRIDGE_LOCK_INVALID' }
}

function Get-BridgeProcessFingerprint {
  param([object]$Process)
  if ($Process -and $Process.CommandLine -cmatch '(?:^|\s)--expected-fingerprint\s+(?:"(?<quoted>[a-fA-F0-9]{64})"|(?<plain>[a-fA-F0-9]{64}))(?=\s|$)') {
    if ($Matches.quoted) { return $Matches.quoted }
    return $Matches.plain
  }
  return $null
}

function Restart-BridgeTask {
  param([string]$TaskName, [string]$WorkerRoot)
  $before = Get-BridgeLockedProcess -WorkerRoot $WorkerRoot
  $oldProcessId = if ($before) { [int]$before.ProcessId } else { 0 }
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  # Stop-ScheduledTask can leave the Node grandchild alive. Re-read the lock AND
  # command line immediately before stopping; never kill other Node processes.
  $remaining = Get-BridgeLockedProcess -WorkerRoot $WorkerRoot
  if ($remaining) { Stop-Process -Id $remaining.ProcessId -ErrorAction Stop }
  Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  return $oldProcessId
}

function Wait-BridgeRuntime {
  param([string]$WorkerRoot, [string]$Fingerprint, [int]$OldProcessId)
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    try {
      $running = Get-BridgeLockedProcess -WorkerRoot $WorkerRoot
      if ($running -and $running.ProcessId -ne $OldProcessId -and
        [string]::Equals((Get-BridgeProcessFingerprint -Process $running), $Fingerprint, [StringComparison]::Ordinal)) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

function Invoke-BridgeRuntimeCheck {
  param([string]$NodePath, [object]$Record)
  $raw = Invoke-BridgeCommand -FilePath $NodePath -Arguments @('--experimental-strip-types',
    (Join-Path $Record.path 'scripts\run-production-mockup-worker.mjs'), '--expected-fingerprint', $Record.fingerprint, '--check') `
    -WorkingDirectory $Record.path -FailureCode 'PREPARATION_RUNTIME_CHECK_FAILED'
  try { $result = $raw | ConvertFrom-Json } catch { throw 'PREPARATION_RUNTIME_CHECK_FAILED' }
  # Whitelist the entire response shape. Never relay raw child output or settings.
  $allowed = @('ready', 'started', 'bridgeVersion', 'workerVersion', 'fingerprint')
  if (@($result.PSObject.Properties.Name | Where-Object { $_ -notin $allowed }).Count -or
    $result.ready -isnot [bool] -or $result.started -isnot [bool] -or
    $result.ready -cne $true -or $result.started -cne $false -or
    $result.bridgeVersion -cne 'mockup-bridge-1' -or $result.workerVersion -cnotmatch '^\d+\.\d+\.\d+$' -or
    -not [string]::Equals($result.fingerprint, $Record.fingerprint, [StringComparison]::Ordinal)) {
    throw 'PREPARATION_RUNTIME_CHECK_FAILED'
  }
}

function Invoke-BridgeRuntimeSwitch {
  param([string]$WorkerRoot, [string]$TaskName, [object]$Target, [object]$Current)
  $next = [pscustomobject]@{ path = $Target.path; fingerprint = $Target.fingerprint; previous = $null }
  if ($Current) { $next.previous = [pscustomobject]@{ path = $Current.path; fingerprint = $Current.fingerprint } }
  # If the same runtime is reinstalled, retain the useful rollback target.
  if ($Current -and $Current.fingerprint -ceq $Target.fingerprint) { $next.previous = $Current.previous }
  Write-BridgeRuntimeConfig -WorkerRoot $WorkerRoot -Config $next
  try {
    $oldId = Restart-BridgeTask -TaskName $TaskName -WorkerRoot $WorkerRoot
    if (-not (Wait-BridgeRuntime -WorkerRoot $WorkerRoot -Fingerprint $Target.fingerprint -OldProcessId $oldId)) {
      throw 'PREPARATION_BRIDGE_START_TIMEOUT'
    }
  } catch {
    $failure = $_.Exception.Message
    if ($Current) {
      Write-BridgeRuntimeConfig -WorkerRoot $WorkerRoot -Config $Current
      try {
        $oldId = Restart-BridgeTask -TaskName $TaskName -WorkerRoot $WorkerRoot
        if (-not (Wait-BridgeRuntime -WorkerRoot $WorkerRoot -Fingerprint $Current.fingerprint -OldProcessId $oldId)) {
          throw 'PREPARATION_BRIDGE_RESTORE_FAILED'
        }
      } catch { throw 'PREPARATION_BRIDGE_RESTORE_FAILED' }
      Write-Host '되돌렸습니다. 이유: 새 편집 연결의 실행을 확인하지 못했습니다.' -ForegroundColor Yellow
    } else {
      # First install has no previous config. Preserve the failed file by rename.
      $failedConfig = Join-Path $WorkerRoot ('bridge-runtime.failed.' + [guid]::NewGuid().ToString('N') + '.json')
      [IO.File]::Move((Join-Path $WorkerRoot 'bridge-runtime.json'), $failedConfig)
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      $remaining = Get-BridgeLockedProcess -WorkerRoot $WorkerRoot
      if ($remaining) { Stop-Process -Id $remaining.ProcessId -ErrorAction Stop }
      Write-Host '이전 설치 기록이 없어 전환을 취소했습니다. 개발 담당에게 알려 주세요.' -ForegroundColor Yellow
    }
    # An unsuccessful switch must remain a failing command even after recovery.
    if ($failure -cmatch '^PREPARATION_[A-Z_]+$') { throw $failure }
    throw 'PREPARATION_BRIDGE_RESTART_FAILED'
  }
}
