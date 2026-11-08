import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { PREPARATION_RUNTIME_SOURCE_FILES } from "../../scripts/preparation-runtime-package.mjs";
import {
  assertApprovedFingerprint,
  getApprovedRollbackRuntime,
  getLatestApprovedRuntime,
} from "../../tools/woolim-pc-worker/approved-runtime.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const toolsRoot = path.join(root, "tools/woolim-pc-worker");
const fingerprint = "0dd37af3825d72c564dfe28846a5282cfeba41b15b624fbf43e47d42425020cd";
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const readTool = (name) => readFile(path.join(toolsRoot, name), "utf8");
const entry = (value, extra = {}) => ({
  fingerprint: value, version: "1.0.0", platform: "win32", arch: "x64", note: "synthetic test", ...extra,
});

async function findPowerShell() {
  for (const command of process.platform === "win32" ? ["pwsh", "powershell.exe"] : ["pwsh"]) {
    try {
      await execute(command, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], {
        windowsHide: true, timeout: 15_000,
      });
      return command;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

const powerShell = await findPowerShell();
const canRunWindowsHarness = process.platform === "win32" && Boolean(powerShell);

async function runPowerShell(command) {
  const { stdout } = await execute(powerShell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
    `[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$ErrorActionPreference='Stop';${command}`], {
    windowsHide: true, timeout: 25_000,
  });
  return stdout.trim();
}

async function withSyntheticWorker(action) {
  const temporaryBase = path.join(root, ".codex-tmp");
  await mkdir(temporaryBase, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryBase, "bridge-test-"));
  const workerRoot = path.join(temporary, "WoolimWorker");
  await mkdir(workerRoot);
  try { return await action(workerRoot); }
  finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(temporaryBase));
    assert.ok(path.basename(temporary).startsWith("bridge-test-"));
    await rm(temporary, { recursive: true, force: true });
  }
}

const common = `. ${quote(path.join(toolsRoot, "bridge-runtime.ps1"))};`;
const installerAst = `$tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(path.join(toolsRoot, "bridge-install.ps1"))},[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count){throw 'INSTALLER_PARSE_ERROR'};`;
const installerFunctions = `${installerAst}$ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)|ForEach-Object{. ([scriptblock]::Create($_.Extent.Text))};`;
const installerUserGuard = `${installerAst}$guards=@($ast.EndBlock.Statements|Where-Object{$_ -is [System.Management.Automation.Language.IfStatementAst] -and $_.Extent.Text.StartsWith('if ($existing -and $existing.Principal.UserId')});if($guards.Count -ne 1){throw 'INSTALLER_USER_GUARD_NOT_FOUND'};$userGuard=[scriptblock]::Create($guards[0].Extent.Text);$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$currentUser=$identity.Name;`;
const updaterFunctions = `$tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(path.join(toolsRoot, "bridge-update.ps1"))},[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count){throw 'UPDATER_PARSE_ERROR'};$ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)|ForEach-Object{. ([scriptblock]::Create($_.Extent.Text.Replace('$PSScriptRoot',${quote(quote(toolsRoot))})))};`;

function syntheticUpdateHarness(workerRoot, packageFingerprint = fingerprint) {
  const target = path.join(workerRoot, "preparation-runtimes", `1.0.0-${fingerprint}`);
  return `${common}${updaterFunctions}
    $script:context=[pscustomobject]@{NodePath=${quote(process.execPath)};GitPath='synthetic-git';Repository=${quote(root)};WorkerRoot=${quote(workerRoot)};WorkerId=('synthetic-'+[guid]::NewGuid().ToString('N'));TaskName='Synthetic bridge';Task=[pscustomobject]@{}};
    $script:approvals=${quote(JSON.stringify([entry("a".repeat(64)), entry(fingerprint)]))};
    $script:calls=@();$script:checks=@();$script:restarts=0;$script:nativeTransport=\${function:Invoke-BridgeCommand};
    function Get-BridgeUpdateContext {return $script:context}
    function Invoke-BridgeCommand {param($FilePath,$Arguments,$WorkingDirectory,$InputText,$FailureCode)
      $script:calls+=@($Arguments[0]);
      if($Arguments[0] -eq 'fetch'){return ''}
      if($Arguments[0] -eq 'show'){return $script:approvals}
      if($Arguments[0] -eq 'scripts/package-preparation-runtime.mjs'){return ${quote(JSON.stringify({ fingerprint: packageFingerprint, privateFilename: "SYNTHETIC_FILENAME_NEVER_SHOWN" }))}}
      if($Arguments[0] -eq 'scripts/install-preparation-runtime.mjs'){return ${quote(JSON.stringify({ runtimeRoot: target, fingerprint, activated: false }))}}
      return & $script:nativeTransport @PSBoundParameters
    }
    function Invoke-BridgeRuntimeCheck {param($NodePath,$Record)$script:checks+=@($Record.fingerprint)}
    function Restart-BridgeTask {param($TaskName,$WorkerRoot)$script:restarts++;return 100}
    function Wait-BridgeRuntime {param($WorkerRoot,$Fingerprint,$OldProcessId)return $true}
    function Read-Host {throw 'UNEXPECTED_CONFIRMATION'};
  `;
}

test("approval list contains unique, complete SHA256 approvals and the requested Windows release", async () => {
  const approvals = JSON.parse(await readTool("approved-preparation-runtimes.json"));
  assert.ok(Array.isArray(approvals) && approvals.length > 0);
  const seen = new Set();
  for (const approved of approvals) {
    assert.match(approved.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(approved.version, "1.0.0");
    assert.ok(typeof approved.platform === "string" && approved.platform);
    assert.ok(typeof approved.arch === "string" && approved.arch);
    assert.ok(typeof approved.note === "string" && approved.note);
    const key = `${approved.platform}/${approved.arch}/${approved.fingerprint}`;
    assert.ok(!seen.has(key), `duplicate approval: ${key}`);
    seen.add(key);
  }
  assert.equal(getLatestApprovedRuntime(approvals, "win32", "x64").fingerprint, fingerprint);
});

test("only the latest approval for the selected platform and CPU is used", () => {
  const old = entry("1".repeat(64));
  const current = entry(fingerprint);
  const otherArch = entry("2".repeat(64), { arch: "arm64" });
  const otherPlatform = entry("3".repeat(64), { platform: "linux" });
  assert.deepEqual(getLatestApprovedRuntime([old, otherArch, current, otherPlatform], "win32", "x64"), current);
  assert.throws(() => getLatestApprovedRuntime([otherArch, otherPlatform], "win32", "x64"));
});

test("approval comparison requires every character to match, including case", () => {
  const approved = entry(fingerprint);
  assert.doesNotThrow(() => assertApprovedFingerprint(fingerprint, approved));
  for (const actual of [
    fingerprint.toUpperCase(), `${fingerprint} `, ` ${fingerprint}`, `${fingerprint}\n`,
    fingerprint.slice(0, -1), `${fingerprint}0`, "f".repeat(64), null, undefined,
  ]) {
    assert.throws(() => assertApprovedFingerprint(actual, approved), /PREPARATION_FINGERPRINT_NOT_APPROVED/);
  }
});

test("manual rollback accepts a historical approval only for the fetched Windows platform", () => {
  const old = entry("a".repeat(64));
  const approvals = [old, entry(fingerprint), entry("b".repeat(64), { platform: "linux" })];
  assert.deepEqual(getApprovedRollbackRuntime(approvals, old.fingerprint), old);
  assert.throws(() => getApprovedRollbackRuntime(approvals, "b".repeat(64)), /PREPARATION_FINGERPRINT_NOT_APPROVED/);
  assert.throws(() => getApprovedRollbackRuntime(approvals, old.fingerprint.toUpperCase()), /PREPARATION_FINGERPRINT_NOT_APPROVED/);
});

test("approval CLI reads stdin and rejects a mismatched fingerprint without echoing untrusted JSON", async () => {
  const helper = path.join(toolsRoot, "approved-runtime.mjs");
  const approvals = [entry("a".repeat(64)), entry(fingerprint)];
  const invoke = (argument, input = JSON.stringify(approvals)) => new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [helper, "--fingerprint", argument], {
      windowsHide: true, timeout: 15_000,
    }, (error, stdout, stderr) => {
      if (error && error.code !== 1) reject(error);
      else resolve({ code: error?.code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.stdin.end(input);
  });
  const accepted = await invoke(fingerprint);
  assert.equal(accepted.code, 0);
  assert.deepEqual(JSON.parse(accepted.stdout), approvals[1]);
  const rejected = await invoke("a".repeat(64));
  assert.deepEqual(rejected, { code: 1, stdout: "", stderr: "PREPARATION_FINGERPRINT_NOT_APPROVED" });
  const malformed = await invoke(fingerprint, "SYNTHETIC_INVALID_JSON_NEVER_SHOWN");
  assert.deepEqual(malformed, { code: 1, stdout: "", stderr: "PREPARATION_APPROVAL_LIST_INVALID" });
});

test("installation tools stay outside the frozen preparation runtime package", async () => {
  const names = (await readdir(toolsRoot)).filter((name) => /^(?:bridge-|approved-|launch-hidden)/.test(name));
  for (const name of names) {
    assert.ok(!PREPARATION_RUNTIME_SOURCE_FILES.includes(`tools/woolim-pc-worker/${name}`), name);
  }
  assert.ok(!PREPARATION_RUNTIME_SOURCE_FILES.includes("lib/pc-worker/bridge-installation.test.mjs"));
});

test("double-click commands contain ASCII only, use UTF8 PowerShell output and pause", async () => {
  for (const [name, argument] of [["bridge-update.cmd", ""], ["bridge-rollback.cmd", "-Rollback"]]) {
    const bytes = await readFile(path.join(toolsRoot, name));
    assert.ok(bytes.every((value) => value < 128), `${name} must contain ASCII only`);
    const source = bytes.toString("ascii");
    assert.match(source, /chcp 65001\s*>\s*nul/i);
    assert.match(source, /powershell\.exe\s+.*-ExecutionPolicy Bypass\s+.*-File "%~dp0bridge-update\.ps1"/i);
    if (argument) assert.ok(source.includes(argument));
    assert.match(source.trim(), /pause$/i);
  }
});

test("new PowerShell scripts have a BOM and parse, or receive mandatory static safety checks", async () => {
  const names = (await readdir(toolsRoot)).filter((name) => /^bridge-.*\.ps1$/.test(name));
  assert.ok(names.includes("bridge-launch.ps1") && names.includes("bridge-install.ps1") && names.includes("bridge-update.ps1"));
  for (const name of names) {
    const bytes = await readFile(path.join(toolsRoot, name));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} must be UTF8 with BOM for PowerShell 5.1`);
    const source = bytes.toString("utf8");
    assert.doesNotMatch(source, /WOOLIM_PC_WORKER_SECRET/i, `${name} must never read or display the secret`);
    assert.doesNotMatch(source, /-(?:SkipVerify|Trust)\b/i, `${name} must not bypass fingerprint verification`);
    assert.doesNotMatch(source, /Remove-Item[^\r\n]*-Recurse/i, `${name} must not recursively delete files`);
    assert.doesNotMatch(source, /(?:Get-ChildItem|dir)\s+[^\r\n]*Env:/i, `${name} must not enumerate environment values`);
    if (powerShell) {
      const command = `$parseErrors=$null;$tokens=$null;[System.Management.Automation.Language.Parser]::ParseFile(${quote(path.join(toolsRoot, name))},[ref]$tokens,[ref]$parseErrors)|Out-Null;if($parseErrors.Count){$parseErrors|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1}`;
      await execute(powerShell, ["-NoProfile", "-NonInteractive", "-Command", command], {
        windowsHide: true, timeout: 15_000,
      });
    } else {
      // Linux CI still enforces safety rules when PowerShell is unavailable.
      assert.doesNotMatch(source, /Invoke-Expression|\bexit\s*\(\s*0\s*\)|DownloadString|EncodedCommand/i);
      assert.doesNotMatch(source, /(?:cmd(?:\.exe)?\s+\/c|powershell[^\r\n]*-Command)[^\r\n]*(?:del|rmdir)/i);
    }
  }
});

test("installer registers a limited interactive task before adding and verifying PT5M repetition", async () => {
  const source = await readTool("bridge-install.ps1");
  assert.match(source, /Woolim Mockup Bridge - /);
  assert.match(source, /New-ScheduledTaskTrigger\s+-AtLogOn/);
  assert.match(source, /-LogonType Interactive\s+-RunLevel Limited/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.match(source, /Interval\s*=\s*["']PT5M["']/);
  assert.match(source, /Get-ScheduledTask[\s\S]*\.Repetition\.Interval/);
  assert.doesNotMatch(source, /Stop-(?:ScheduledTask|Process)|Unregister-ScheduledTask/);
  assert.match(source, /_replaced/);
  assert.match(source, /Copy-Item/);
});

for (const [label, userId] of [
  ["bare account name", String.raw`($identity.Name -split '\\')[-1]`],
  ["computer-qualified account name", "$identity.Name"],
  ["SID string", "$identity.User.Value"],
  ["empty UserId", "''"],
  ["null UserId", "$null"],
]) {
  test(`installer accepts the current user with ${label}`, { skip: !canRunWindowsHarness }, async () => {
    const output = await runPowerShell(`${installerUserGuard}
      $existing=[pscustomobject]@{Principal=[pscustomobject]@{UserId=${userId}}};
      . $userGuard;[Console]::WriteLine('ACCEPTED')`);
    assert.equal(output, "ACCEPTED");
  });
}

test("installer accepts no existing task", { skip: !canRunWindowsHarness }, async () => {
  const output = await runPowerShell(`${installerUserGuard}$existing=$null;. $userGuard;[Console]::WriteLine('ACCEPTED')`);
  assert.equal(output, "ACCEPTED");
});

for (const [label, userId] of [
  ["a different user's SID", "$otherSid.Value"],
  ["a different user's account name", "$otherSid.Translate([Security.Principal.NTAccount]).Value"],
  ["an unresolvable account name", "('missing-'+[guid]::NewGuid().ToString('N'))"],
  ["a malformed SID", "'S-1-5-not-a-sid'"],
]) {
  test(`installer rejects ${label} with the existing Korean message`, { skip: !canRunWindowsHarness }, async () => {
    const output = await runPowerShell(`${installerUserGuard}
      $otherSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18');
      if($otherSid.Value -eq $identity.User.Value){$otherSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-19')}
      $existing=[pscustomobject]@{Principal=[pscustomobject]@{UserId=${userId}}};
      $caught='';try{. $userGuard}catch{$caught=$_.Exception.Message};[Console]::WriteLine($caught)`);
    assert.equal(output, "다른 Windows 사용자의 편집 연결 작업입니다. 워커를 설정한 사용자로 로그인해 주세요.");
  });
}

test("task registration applies PT5M after register and reads it back with synthetic Task Scheduler objects", { skip: !canRunWindowsHarness }, async () => {
  const output = await runPowerShell(`${installerFunctions}$script:events=@();$script:task=[pscustomobject]@{Triggers=@([pscustomobject]@{Repetition=$null})};
    function New-ScheduledTaskAction {param($Execute,$Argument,$WorkingDirectory)$script:action=[pscustomobject]@{execute=$Execute;arguments=$Argument;workingDirectory=$WorkingDirectory};return $script:action}
    function New-ScheduledTaskTrigger {param([switch]$AtLogOn,$User)return [pscustomobject]@{atLogOn=[bool]$AtLogOn;user=$User}}
    function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel)$script:principal=[pscustomobject]@{user=$UserId;logon=$LogonType;level=$RunLevel};return $script:principal}
    function New-ScheduledTaskSettingsSet {param([switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,[switch]$StartWhenAvailable,$RestartCount,$RestartInterval,$ExecutionTimeLimit,$MultipleInstances)$script:multiple=$MultipleInstances;return [pscustomobject]@{}}
    function Register-ScheduledTask {param($TaskName,$Action,$Trigger,$Principal,$Settings,$Description,[switch]$Force)$script:events+=@('register')}
    function Get-ScheduledTask {param($TaskName)$script:events+=@('get');return $script:task}
    function New-CimInstance {param($ClassName,$Namespace,[switch]$ClientOnly,$Property)return [pscustomobject]$Property}
    function Set-ScheduledTask {param($InputObject)$script:events+=@('set');$script:task=$InputObject}
    Register-BridgeTask -InstallRoot ${quote(toolsRoot)} -TaskName 'Synthetic bridge' -UserName 'synthetic-user';
    @{events=$script:events;interval=$script:task.Triggers[0].Repetition.Interval;principal=$script:principal;multiple=$script:multiple;action=$script:action}|ConvertTo-Json -Depth 5 -Compress`);
  const result = JSON.parse(output.split(/\r?\n/).at(-1));
  assert.deepEqual(result.events, ["register", "get", "set", "get"]);
  assert.equal(result.interval, "PT5M");
  assert.deepEqual(result.principal, { user: "synthetic-user", logon: "Interactive", level: "Limited" });
  assert.equal(result.multiple, "IgnoreNew");
  assert.equal(result.action.execute, "powershell.exe");
  assert.match(result.action.arguments, /-WindowStyle Hidden/);
  assert.match(result.action.arguments, /bridge-launch\.ps1/);
  assert.doesNotMatch(result.action.arguments, /fingerprint|SECRET/i);
});

test("installer backs up overwritten files and generates update and rollback shortcuts using synthetic COM", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const destination = path.join(workerRoot, "mockup-bridge-launch.ps1");
    const source = path.join(workerRoot, "new-launcher.ps1");
    const desktop = path.join(workerRoot, "synthetic-desktop");
    const backupRoot = path.join(workerRoot, "_replaced", "synthetic-timestamp");
    await mkdir(desktop);
    await writeFile(destination, "old launcher");
    await writeFile(source, "new launcher");
    const output = await runPowerShell(`function Invoke-SyntheticInstall {[CmdletBinding(SupportsShouldProcess=$true)]param();${installerFunctions}$backupRoot=${quote(backupRoot)};
      Copy-BridgeInstallFile -Source ${quote(source)} -Destination ${quote(destination)} -BackupName 'mockup-bridge-launch.ps1';
      $script:saved=@();$script:shell=[pscustomobject]@{};
      $script:shell|Add-Member ScriptMethod CreateShortcut {param($linkPath)$shortcut=[pscustomobject]@{TargetPath='';WorkingDirectory='';Description='';linkPath=$linkPath};$shortcut|Add-Member ScriptMethod Save {$script:saved+=@([pscustomobject]@{target=$this.TargetPath;directory=$this.WorkingDirectory;link=$this.linkPath})};return $shortcut};
      function New-Object {param($ComObject)if($ComObject -ne 'WScript.Shell'){throw 'UNEXPECTED_COM_OBJECT'};return $script:shell}
      New-BridgeShortcuts -InstallRoot ${quote(toolsRoot)} -Desktop ${quote(desktop)};
      ConvertTo-Json -InputObject $script:saved -Compress};Invoke-SyntheticInstall`);
    assert.equal(await readFile(destination, "utf8"), "new launcher");
    assert.equal(await readFile(path.join(backupRoot, "mockup-bridge-launch.ps1"), "utf8"), "old launcher");
    const shortcuts = JSON.parse(output);
    assert.deepEqual(shortcuts.map((shortcut) => path.basename(shortcut.target)), ["bridge-update.cmd", "bridge-rollback.cmd"]);
    assert.deepEqual(shortcuts.map((shortcut) => path.basename(shortcut.link)), ["PC 편집 연결 업데이트.lnk", "PC 편집 연결 되돌리기.lnk"]);
  });
});

test("updates take approvals from fetched origin main and keep check-only before activation", async () => {
  const source = await readTool("bridge-update.ps1");
  assert.match(source, /CheckOnly/);
  assert.match(source, /Rollback/);
  assert.match(source, /fetch["']?\s*,?\s*["']?origin["']?\s*,?\s*["']?main/i);
  assert.match(source, /origin\/main:tools\/woolim-pc-worker\/approved-preparation-runtimes\.json/);
  assert.match(source, /package-preparation-runtime\.mjs/);
  assert.match(source, /install-preparation-runtime\.mjs/);
  assert.match(source, /--expected-fingerprint/);
  const runtime = await readTool("bridge-runtime.ps1");
  assert.match(source, /Invoke-BridgeRuntimeCheck/);
  assert.match(runtime, /--check/);
  assert.match(runtime, /ready/);
  assert.match(source, /지금 편집 중이거나 열려 있는 요청이/);
  assert.match(source, /업데이트하면 열린 편집 화면이 닫힙니다/);
  assert.match(source, /계속할까요\? \(Y\/N\)/);
});

test("CheckOnly executes package, approval, install and check without switching or restarting", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const current = { path: path.join(workerRoot, "preparation-runtimes", `1.0.0-${"a".repeat(64)}`), fingerprint: "a".repeat(64), previous: null };
    const configText = JSON.stringify(current);
    await writeFile(path.join(workerRoot, "bridge-runtime.json"), configText);
    const output = await runPowerShell(`${syntheticUpdateHarness(workerRoot)}Invoke-BridgeUpdate -CheckOnly;@{calls=$script:calls;checks=$script:checks;restarts=$script:restarts}|ConvertTo-Json -Compress`);
    assert.ok(output.includes("확인 완료"));
    assert.ok(!output.includes("SYNTHETIC_FILENAME_NEVER_SHOWN"));
    const result = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.equal(result.restarts, 0);
    assert.deepEqual(result.checks, [fingerprint]);
    assert.deepEqual(result.calls.map((call) => path.basename(call)), [
      "fetch", "show", "approved-runtime.mjs", "package-preparation-runtime.mjs", "approved-runtime.mjs", "install-preparation-runtime.mjs",
    ]);
    assert.equal(await readFile(path.join(workerRoot, "bridge-runtime.json"), "utf8"), configText);
  });
});

test("unapproved synthetic package stops before install, config replacement or restart", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const current = { path: path.join(workerRoot, "preparation-runtimes", `1.0.0-${fingerprint}`), fingerprint, previous: null };
    const configText = JSON.stringify(current);
    await writeFile(path.join(workerRoot, "bridge-runtime.json"), configText);
    const output = await runPowerShell(`${syntheticUpdateHarness(workerRoot, "b".repeat(64))}$caught='';try{Invoke-BridgeUpdate -CheckOnly}catch{$caught=$_.Exception.Message;Show-BridgeUpdateError -Code $caught};@{caught=$caught;calls=$script:calls;checks=$script:checks;restarts=$script:restarts}|ConvertTo-Json -Compress`);
    assert.ok(output.includes("이 PC의 파일이 승인된 버전과 다릅니다. 설치하지 않았습니다."));
    const result = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.equal(result.caught, "PREPARATION_FINGERPRINT_NOT_APPROVED");
    assert.ok(!result.calls.includes("scripts/install-preparation-runtime.mjs"));
    assert.deepEqual(result.checks, []);
    assert.equal(result.restarts, 0);
    assert.equal(await readFile(path.join(workerRoot, "bridge-runtime.json"), "utf8"), configText);
  });
});

test("manual rollback switches to an approved synthetic previous runtime and retains the current version", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const old = { path: path.join(workerRoot, "preparation-runtimes", `1.0.0-${"a".repeat(64)}`), fingerprint: "a".repeat(64) };
    const current = { path: path.join(workerRoot, "preparation-runtimes", `1.0.0-${fingerprint}`), fingerprint, previous: old };
    await writeFile(path.join(workerRoot, "bridge-runtime.json"), JSON.stringify(current));
    const output = await runPowerShell(`${syntheticUpdateHarness(workerRoot)}Invoke-BridgeUpdate -Rollback;@{checks=$script:checks;restarts=$script:restarts}|ConvertTo-Json -Compress`);
    assert.ok(output.includes("되돌리기 완료"));
    assert.deepEqual(JSON.parse(output.split(/\r?\n/).at(-1)), { checks: [old.fingerprint, fingerprint], restarts: 1 });
    assert.deepEqual(JSON.parse(await readFile(path.join(workerRoot, "bridge-runtime.json"), "utf8")), { ...old, previous: { path: current.path, fingerprint } });
  });
});

test("an empty response to the open-review warning cancels before fetching or changing anything", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const current = { path: path.join(workerRoot, "preparation-runtimes", `1.0.0-${fingerprint}`), fingerprint, previous: null };
    const configText = JSON.stringify(current);
    await writeFile(path.join(workerRoot, "bridge-runtime.json"), configText);
    const sessionDirectory = path.join(workerRoot, "p", "synthetic-review");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(path.join(sessionDirectory, "bridge-session.json"), JSON.stringify({ state: "review", title: "SYNTHETIC_TITLE_NEVER_SHOWN" }));
    const output = await runPowerShell(`${syntheticUpdateHarness(workerRoot)}function Read-Host {param($Prompt)[Console]::WriteLine($Prompt);return ''};Invoke-BridgeUpdate;@{calls=$script:calls;restarts=$script:restarts}|ConvertTo-Json -Compress`);
    assert.ok(output.includes("1건 있습니다"));
    assert.ok(output.includes("계속할까요? (Y/N)"));
    assert.ok(output.includes("취소했습니다"));
    assert.ok(!output.includes("SYNTHETIC_TITLE_NEVER_SHOWN"));
    assert.deepEqual(JSON.parse(output.split(/\r?\n/).at(-1)), { calls: [], restarts: 0 });
    assert.equal(await readFile(path.join(workerRoot, "bridge-runtime.json"), "utf8"), configText);
  });
});

test("runtime records reject relative, outside-root and mismatched fingerprint paths", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const command = `${common}$workerRoot=${quote(workerRoot)};$fingerprint=${quote(fingerprint)};
      $valid=Join-Path (Join-Path $workerRoot 'preparation-runtimes') ('1.0.0-'+$fingerprint);
      $record=[pscustomobject]@{path=$valid;fingerprint=$fingerprint};
      $accepted=Assert-BridgeRuntimeRecord -Record $record -WorkerRoot $workerRoot;
      $rejected=0;
      foreach($bad in @(
        @{path='relative';fingerprint=$fingerprint},
        @{path=($valid+'-suffix');fingerprint=$fingerprint},
        @{path=$valid;fingerprint=('a'*64)},
        @{path=(Join-Path (Split-Path $workerRoot -Parent) ('1.0.0-'+$fingerprint));fingerprint=$fingerprint},
        @{path=$valid;fingerprint=($fingerprint+' ')}
      )) {try{Assert-BridgeRuntimeRecord -Record ([pscustomobject]$bad) -WorkerRoot $workerRoot|Out-Null}catch{$rejected++}}
      @{accepted=$accepted.fingerprint;rejected=$rejected}|ConvertTo-Json -Compress`;
    assert.deepEqual(JSON.parse(await runPowerShell(command)), { accepted: fingerprint, rejected: 5 });
  });
});

test("atomic config replacement preserves a previous runtime and does not remove runtime folders", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const before = "a".repeat(64);
    const beforePath = path.join(workerRoot, "preparation-runtimes", `1.0.0-${before}`);
    const nextPath = path.join(workerRoot, "preparation-runtimes", `1.0.0-${fingerprint}`);
    await mkdir(beforePath, { recursive: true });
    await mkdir(nextPath, { recursive: true });
    await writeFile(path.join(workerRoot, "bridge-runtime.json"), JSON.stringify({ path: beforePath, fingerprint: before, previous: null }));
    await runPowerShell(`${common}$config=[pscustomobject]@{path=${quote(nextPath)};fingerprint=${quote(fingerprint)};previous=[pscustomobject]@{path=${quote(beforePath)};fingerprint=${quote(before)}}};Write-BridgeRuntimeConfig -WorkerRoot ${quote(workerRoot)} -Config $config;`);
    const current = JSON.parse(await readFile(path.join(workerRoot, "bridge-runtime.json"), "utf8"));
    assert.deepEqual(current, { path: nextPath, fingerprint, previous: { path: beforePath, fingerprint: before } });
    assert.deepEqual((await readdir(path.join(workerRoot, "preparation-runtimes"))).sort(), [`1.0.0-${fingerprint}`, `1.0.0-${before}`].sort());
    assert.equal((await readdir(workerRoot)).filter((name) => name.endsWith(".tmp")).length, 0);
  });
});

test("failed runtime activation restores synthetic previous config and restarts the previous runtime", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const oldFingerprint = "a".repeat(64);
    const oldPath = path.join(workerRoot, "preparation-runtimes", `1.0.0-${oldFingerprint}`);
    const targetPath = path.join(workerRoot, "preparation-runtimes", `1.0.0-${fingerprint}`);
    const current = { path: oldPath, fingerprint: oldFingerprint, previous: null };
    await writeFile(path.join(workerRoot, "bridge-runtime.json"), JSON.stringify(current));
    const command = `${common}$script:restarts=0;$script:waited=@();
      function Restart-BridgeTask {param($TaskName,$WorkerRoot)$script:restarts++;return (100+$script:restarts)}
      function Wait-BridgeRuntime {param($WorkerRoot,$Fingerprint,$OldProcessId)$script:waited+=@($Fingerprint);return ($Fingerprint -ceq ${quote(oldFingerprint)})}
      $current=Read-BridgeRuntimeConfig -WorkerRoot ${quote(workerRoot)};
      $target=[pscustomobject]@{path=${quote(targetPath)};fingerprint=${quote(fingerprint)}};
      $caught='';try{Invoke-BridgeRuntimeSwitch -WorkerRoot ${quote(workerRoot)} -TaskName 'Synthetic bridge' -Target $target -Current $current}catch{$caught=$_.Exception.Message}
      @{caught=$caught;restarts=$script:restarts;waited=$script:waited}|ConvertTo-Json -Compress`;
    const output = await runPowerShell(command);
    assert.match(output, /되돌렸습니다/);
    const result = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.equal(result.caught, "PREPARATION_BRIDGE_START_TIMEOUT");
    assert.equal(result.restarts, 2);
    assert.deepEqual(result.waited, [fingerprint, oldFingerprint]);
    assert.deepEqual(JSON.parse(await readFile(path.join(workerRoot, "bridge-runtime.json"), "utf8")), current);
  });
});

test("runtime --check rejects extra fields, leaked text and nonboolean ready flags without echoing them", { skip: !canRunWindowsHarness }, async () => {
  const sentinel = "SYNTHETIC_SECRET_MUST_NEVER_APPEAR";
  const ready = { ready: true, started: false, bridgeVersion: "mockup-bridge-1", workerVersion: "2.10.0", fingerprint };
  const output = await runPowerShell(`${common}$script:raw=${quote(JSON.stringify(ready))};
    function Invoke-BridgeCommand {param($FilePath,$Arguments,$WorkingDirectory,$FailureCode)return $script:raw}
    $record=[pscustomobject]@{path=${quote(toolsRoot)};fingerprint=${quote(fingerprint)}};
    Invoke-BridgeRuntimeCheck -NodePath 'synthetic-node' -Record $record;
    $rejected=0;
    foreach($raw in @(
      ${quote(JSON.stringify({ ...ready, secret: sentinel }))},
      ${quote(`${sentinel}\n${JSON.stringify(ready)}`)},
      ${quote(JSON.stringify({ ...ready, ready: "True", started: "False" }))},
      ${quote(JSON.stringify({ ...ready, ready: false }))},
      ${quote(JSON.stringify({ ...ready, fingerprint: fingerprint.toUpperCase() }))}
    )){$script:raw=$raw;try{Invoke-BridgeRuntimeCheck -NodePath 'synthetic-node' -Record $record}catch{$rejected++;[Console]::WriteLine($_.Exception.Message)}}
    [Console]::WriteLine('REJECTED='+$rejected)`);
  assert.ok(!output.includes(sentinel));
  assert.match(output, /REJECTED=5$/);
  assert.equal(output.split(/\r?\n/).filter((line) => line === "PREPARATION_RUNTIME_CHECK_FAILED").length, 5);
});

test("child command failures expose a safe code while suppressing raw synthetic stderr", { skip: !canRunWindowsHarness }, async () => {
  const sentinel = "SYNTHETIC_STDERR_NEVER_SHOWN";
  const output = await runPowerShell(`${common}$caught='';try{Invoke-BridgeCommand -FilePath ${quote(process.execPath)} -Arguments @('-e',${quote(`process.stderr.write('${sentinel}\\nPREPARATION_PACKAGE_FILE_MISMATCH: ${sentinel}\\n');process.exit(1)` )}) -WorkingDirectory ${quote(root)} -FailureCode 'PREPARATION_COMMAND_FAILED'|Out-Null}catch{$caught=$_.Exception.Message};[Console]::WriteLine($caught)`);
  assert.equal(output, "PREPARATION_PACKAGE_FILE_MISMATCH");
  assert.ok(!output.includes(sentinel));
});

test("child command transport preserves synthetic Unicode stdin and quoted arguments on Windows PowerShell", { skip: !canRunWindowsHarness }, async () => {
  const input = "합성 승인 목록 · no secrets";
  const script = "let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>input+=part);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({input,arg:process.argv[1]})))";
  const argument = 'spaces and "quotes" plus trailing\\';
  const output = await runPowerShell(`${common}$raw=Invoke-BridgeCommand -FilePath ${quote(process.execPath)} -Arguments @('-e',${quote(script)},${quote(argument)}) -WorkingDirectory ${quote(root)} -InputText ${quote(input)};[Console]::WriteLine($raw)`);
  assert.deepEqual(JSON.parse(output), { input, arg: argument });
});

test("restart kills only the Node process from the lock and enables the task before starting", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    await mkdir(path.join(workerRoot, "p"));
    await writeFile(path.join(workerRoot, "p", "mockup-bridge.lock"), JSON.stringify({ pid: 4321 }));
    const commandLine = `node.exe "C:\\synthetic\\scripts\\run-production-mockup-worker.mjs" --expected-fingerprint ${fingerprint}`;
    const output = await runPowerShell(`${common}$script:events=@();$script:changed=$false;$script:unrelated=$false;
      function Get-CimInstance {param($ClassName,$Filter)if($Filter -ne 'ProcessId = 4321'){throw 'UNEXPECTED_PROCESS_LOOKUP'};$line=if($script:changed -and $script:unrelated){'node.exe unrelated.mjs'}else{${quote(commandLine)}};return [pscustomobject]@{Name='node.exe';ProcessId=4321;CommandLine=$line}}
      function Stop-ScheduledTask {param($TaskName)$script:events+=@('stop-task');$script:changed=$true}
      function Stop-Process {param($Id)$script:events+=@('kill:'+ $Id)}
      function Enable-ScheduledTask {param($TaskName)$script:events+=@('enable')}
      function Start-ScheduledTask {param($TaskName)$script:events+=@('start')}
      $oldId=Restart-BridgeTask -TaskName 'Synthetic bridge' -WorkerRoot ${quote(workerRoot)};
      $normal=@($script:events);$script:events=@();$script:changed=$false;$script:unrelated=$true;$caught='';
      try{Restart-BridgeTask -TaskName 'Synthetic bridge' -WorkerRoot ${quote(workerRoot)}|Out-Null}catch{$caught=$_.Exception.Message};
      @{oldId=$oldId;normal=$normal;unrelated=$script:events;caught=$caught}|ConvertTo-Json -Compress`);
    assert.deepEqual(JSON.parse(output), {
      oldId: 4321, normal: ["stop-task", "kill:4321", "enable", "start"], unrelated: ["stop-task"], caught: "PREPARATION_BRIDGE_LOCK_INVALID",
    });
  });
});

test("startup verification requires both a changed lock PID and the exact new fingerprint", { skip: !canRunWindowsHarness }, async () => {
  const output = await runPowerShell(`${common}$script:count=0;
    function Get-BridgeLockedProcess {param($WorkerRoot)$script:count++;$number=if($script:count -eq 1){100}else{100+$script:count};$value=if($script:count -eq 2){'a'*64}else{${quote(fingerprint)}};return [pscustomobject]@{ProcessId=$number;CommandLine=('node.exe --expected-fingerprint '+$value)}}
    function Start-Sleep {param($Milliseconds)}
    $ready=Wait-BridgeRuntime -WorkerRoot 'synthetic' -Fingerprint ${quote(fingerprint)} -OldProcessId 100;
    @{ready=$ready;probes=$script:count}|ConvertTo-Json -Compress`);
  assert.deepEqual(JSON.parse(output), { ready: true, probes: 3 });
});

test("launcher removes only top-level log files older than fourteen days and reports repeated restarts", { skip: !canRunWindowsHarness }, async () => {
  await withSyntheticWorker(async (workerRoot) => {
    const logs = path.join(workerRoot, "mockup-bridge-logs");
    await mkdir(path.join(logs, "nested"), { recursive: true });
    for (const file of ["expired.log", "fresh.log", "expired.txt", "nested/expired.log"]) {
      await writeFile(path.join(logs, file), "synthetic log");
      const when = new Date(Date.now() - (file === "fresh.log" ? 1 : 15) * 24 * 60 * 60 * 1000);
      await utimes(path.join(logs, file), when, when);
    }
    const launchSource = `. ${quote(path.join(toolsRoot, "bridge-launch.ps1"))};`;
    await runPowerShell(`${launchSource}Remove-OldBridgeLogs -WorkerRoot ${quote(workerRoot)};1..3|ForEach-Object{Write-BridgeRestartNotice -WorkerRoot ${quote(workerRoot)}};`);
    assert.deepEqual((await readdir(logs)).sort(), ["expired.txt", "fresh.log", "nested"]);
    assert.deepEqual(await readdir(path.join(logs, "nested")), ["expired.log"]);
    assert.match(await readFile(path.join(workerRoot, "bridge-launch.log"), "utf8"), /10분 안에 3번 재시작/);
  });
});
