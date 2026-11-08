import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const launcher = path.join(root, "tools/woolim-pc-worker/bridge-launch.ps1");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const oldFingerprint = "a".repeat(64);
const nextFingerprint = "b".repeat(64);
let powerShell = null;
for (const command of process.platform === "win32" ? ["pwsh", "powershell.exe"] : ["pwsh"]) {
  try {
    await execute(command, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], {
      windowsHide: true, timeout: 15_000,
    });
    powerShell = command;
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const windowsHarness = process.platform === "win32" && Boolean(powerShell);

async function runLaunch(scenario) {
  const temporaryBase = path.join(root, ".codex-tmp");
  await mkdir(temporaryBase, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryBase, "bridge-auto-"));
  try {
    const command = `
      [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$ErrorActionPreference='Stop';
      $tokens=$null;$parseErrors=$null;
      $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(launcher)},[ref]$tokens,[ref]$parseErrors);
      if($parseErrors.Count){throw 'LAUNCHER_PARSE_ERROR'};
      $ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)|ForEach-Object{. ([scriptblock]::Create($_.Extent.Text))};
      $env:LOCALAPPDATA=${quote(temporary)};
      $script:scenario=${quote(scenario)};$script:events=@();$script:messages=@();
      $script:workerRoot=Join-Path $env:LOCALAPPDATA 'WoolimWorker';
      $script:current=[pscustomobject]@{path=(Join-Path $script:workerRoot 'old');fingerprint=${quote(oldFingerprint)};previous=$null};
      $script:target=[pscustomobject]@{path=(Join-Path $script:workerRoot 'new');fingerprint=${quote(nextFingerprint)}};
      $script:config=$script:current;
      $script:launchMutexName='Local\\WoolimMockupBridgeLaunch-Test-'+[guid]::NewGuid().ToString('N');
      function New-Object {param($TypeName,$ArgumentList)
        if($TypeName -eq 'Threading.Mutex'){
          if([string]$ArgumentList[1] -like 'Local\\WoolimMockupBridgeLaunch-*'){
            $ArgumentList=@($ArgumentList[0],$script:launchMutexName)
          }elseif($script:scenario -eq 'busy' -and [string]$ArgumentList[1] -like 'Local\\WoolimBridgeUpdate-*'){
            $mutex=[pscustomobject]@{};
            $mutex|Add-Member -MemberType ScriptMethod -Name WaitOne -Value {param($Timeout)return $false};
            $mutex|Add-Member -MemberType ScriptMethod -Name Dispose -Value {};
            return $mutex
          }
        }
        return Microsoft.PowerShell.Utility\\New-Object -TypeName $TypeName -ArgumentList $ArgumentList
      }
      function Test-BridgeLaunchLock {param($WorkerRoot)return $false}
      function Get-BridgeLaunchRuntime {param($WorkerRoot)return $script:current}
      function Read-BridgeRuntimeConfig {param($WorkerRoot)
        if($script:scenario -eq 'previous-invalid'){throw 'PREPARATION_RUNTIME_CONFIG_INVALID'};
        return $script:current
      }
      function Remove-OldBridgeLogs {param($WorkerRoot)}
      function Write-BridgeRestartNotice {param($WorkerRoot)}
      function Write-BridgeLaunchLog {param($WorkerRoot,$Message)$script:messages+=@($Message)}
      function Get-BridgeLaunchUpdateScript {return {}}
      function Get-BridgeReviewCount {param($WorkerRoot)if($script:scenario -eq 'review'){return 1};return 0}
      function Get-BridgeUpdateContext {
        $script:events+=@('context');
        if($script:scenario -eq 'context-failed'){throw 'PREPARATION_SOURCE_MISSING'};
        return [pscustomobject]@{WorkerRoot=$script:workerRoot;WorkerId=('synthetic-'+[guid]::NewGuid().ToString('N'))}
      }
      function Read-BridgeFetchedApprovals {param($Context)
        $script:events+=@('fetch');if($script:scenario -eq 'fetch-failed'){throw 'PREPARATION_APPROVAL_FETCH_FAILED'};return '{}'
      }
      function Get-BridgeApproval {param($Context,$Approvals,$Arguments)
        if($Arguments[0] -eq '--latest'){
          $value=if($script:scenario -eq 'same'){$script:current.fingerprint}else{$script:target.fingerprint};
          $url=if($script:scenario -eq 'no-url'){$null}else{'https://github.com/WOOLIM0109/woolimhome/releases/download/synthetic/runtime.zip'};
          return [pscustomobject]@{fingerprint=$value;url=$url}
        };return $script:current
      }
      function Get-BridgePreparedRuntime {param($Context,$Approvals,$Approved)
        $script:events+=@('prepare');
        if($script:scenario -eq 'download-failed'){throw 'PREPARATION_ARCHIVE_DOWNLOAD_FAILED'};
        if($script:scenario -eq 'sha-failed'){throw 'PREPARATION_ARCHIVE_SHA_MISMATCH'};
        if($script:scenario -eq 'install-failed'){throw 'PREPARATION_INSTALL_FAILED'};
        return $script:target
      }
      function Invoke-BridgeRuntimeCheck {param($NodePath,$Record)
        $script:events+=@('check:'+$Record.fingerprint);
        if($script:scenario -eq 'check-failed'){throw 'PREPARATION_RUNTIME_CHECK_FAILED'}
      }
      function Write-BridgeRuntimeConfig {param($WorkerRoot,$Config)
        $script:events+=@('config:'+$Config.fingerprint);
        if($script:scenario -eq 'config-failed' -and $Config.fingerprint -ceq $script:target.fingerprint){throw 'SYNTHETIC_PRIVATE_DETAIL'};
        $script:config=$Config
      }
      function Start-BridgeLaunchChild {param($NodePath,$Runtime,$LogRoot)
        $script:events+=@('start:'+$Runtime.fingerprint);
        if($script:scenario -eq 'start-failed' -and $Runtime.fingerprint -ceq $script:target.fingerprint){throw 'SYNTHETIC_PRIVATE_DETAIL'};
        $child=[pscustomobject]@{ExitCode=0;fingerprint=$Runtime.fingerprint};
        $child|Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {};
        $child|Add-Member -MemberType ScriptMethod -Name Dispose -Value {};
        return $child
      }
      function Stop-BridgeLaunchCandidate {param($Child)$script:events+=@('stop:'+$Child.fingerprint)}
      function Wait-BridgeRuntime {param($WorkerRoot,$Fingerprint,$OldProcessId)
        $script:events+=@('wait:'+$Fingerprint);return ($script:scenario -ne 'wait-failed')
      }
      $result=Invoke-BridgeLaunch;
      [pscustomobject]@{exitCode=$result;events=@($script:events);messages=@($script:messages);fingerprint=$script:config.fingerprint;previous=$script:config.previous}|ConvertTo-Json -Depth 6 -Compress
    `;
    const { stdout } = await execute(powerShell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true, timeout: 25_000,
    });
    return JSON.parse(stdout.trim());
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(temporaryBase));
    assert.ok(path.basename(temporary).startsWith("bridge-auto-"));
    await rm(temporary, { recursive: true, force: true });
  }
}

test("launcher starts the existing runtime for unchanged, absent-download, review, and manual-update cases", { skip: !windowsHarness }, async () => {
  for (const scenario of ["same", "no-url", "review", "busy"]) {
    const result = await runLaunch(scenario);
    assert.equal(result.exitCode, 0, scenario);
    assert.equal(result.fingerprint, oldFingerprint, scenario);
    assert.deepEqual(result.events.filter((event) => event.startsWith("start:")), [`start:${oldFingerprint}`], scenario);
    assert.ok(!result.events.includes("prepare"), scenario);
    if (["review", "busy"].includes(scenario)) assert.ok(!result.events.includes("fetch"));
  }
});

test("launcher verifies the downloaded candidate and records a rollback target before starting it", { skip: !windowsHarness }, async () => {
  const result = await runLaunch("update");
  assert.equal(result.exitCode, 0);
  assert.equal(result.fingerprint, nextFingerprint);
  assert.equal(result.previous.fingerprint, oldFingerprint);
  assert.deepEqual(result.events, ["context", "fetch", "prepare", `check:${nextFingerprint}`, `check:${oldFingerprint}`,
    `config:${nextFingerprint}`, `start:${nextFingerprint}`, `wait:${nextFingerprint}`]);
});

test("every failed auto-update stage launches the previous runtime and logs only a diagnostic code", { skip: !windowsHarness }, async () => {
  for (const scenario of ["context-failed", "fetch-failed", "previous-invalid", "download-failed", "sha-failed", "install-failed", "check-failed", "config-failed", "start-failed", "wait-failed"]) {
    const result = await runLaunch(scenario);
    assert.equal(result.exitCode, 0, scenario);
    assert.equal(result.fingerprint, oldFingerprint, scenario);
    assert.equal(result.events.filter((event) => event.startsWith("start:")).at(-1), `start:${oldFingerprint}`, scenario);
    assert.match(result.messages.join("\n"), /PREPARATION_[A-Z_]+/, scenario);
    assert.doesNotMatch(result.messages.join("\n"), /SYNTHETIC_PRIVATE_DETAIL/, scenario);
    if (scenario === "previous-invalid") assert.ok(!result.events.includes("prepare"));
    if (scenario === "wait-failed") {
      assert.ok(result.events.includes(`stop:${nextFingerprint}`));
      assert.ok(result.events.indexOf(`config:${oldFingerprint}`) < result.events.indexOf(`start:${oldFingerprint}`));
    }
  }
});

test("launcher shares verified installation code and does not restart its own scheduled task", async () => {
  const source = await readFile(launcher, "utf8");
  assert.match(source, /\. \(Get-BridgeLaunchUpdateScript\)/);
  assert.match(source, /app\\bridge-update\.ps1/);
  assert.match(source, /\$updateMutex\.WaitOne\(0\)/);
  assert.doesNotMatch(source, /Invoke-BridgeRuntimeSwitch|Restart-BridgeTask|Stop-ScheduledTask/);
  assert.match(source, /Get-BridgePreparedRuntime/);
  assert.match(source, /Wait-BridgeRuntime/);
});

test("launcher reads successful and failed exit codes from real asynchronous Node children", { skip: !windowsHarness }, async () => {
  const temporaryBase = path.join(root, ".codex-tmp");
  await mkdir(temporaryBase, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryBase, "bridge-auto-"));
  try {
    const scripts = path.join(temporary, "scripts");
    await mkdir(scripts);
    for (const exitCode of [0, 9]) {
      await writeFile(path.join(scripts, "run-production-mockup-worker.mjs"), `process.exit(${exitCode});\n`);
      const command = `$ErrorActionPreference='Stop';$tokens=$null;$parseErrors=$null;
        $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(launcher)},[ref]$tokens,[ref]$parseErrors);
        $function=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-BridgeLaunchChild'},$true);
        . ([scriptblock]::Create($function.Extent.Text));
        $child=Start-BridgeLaunchChild -NodePath ${quote(process.execPath)} -Runtime ([pscustomobject]@{path=${quote(temporary)};fingerprint=${quote(oldFingerprint)}}) -LogRoot ${quote(temporary)};
        try{$child.WaitForExit();[int]$child.ExitCode}finally{$child.Dispose()}`;
      const { stdout } = await execute(powerShell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
        windowsHide: true, timeout: 15_000,
      });
      assert.equal(stdout.trim(), String(exitCode));
    }
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(temporaryBase));
    assert.ok(path.basename(temporary).startsWith("bridge-auto-"));
    await rm(temporary, { recursive: true, force: true });
  }
});
