import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import JSZip from "jszip";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const toolsRoot = path.join(root, "tools/woolim-pc-worker");
const updater = path.join(toolsRoot, "bridge-update.ps1");
const fingerprint = "0dd37af3825d72c564dfe28846a5282cfeba41b15b624fbf43e47d42425020cd";
const archiveUrl = "https://github.com/WOOLIM0109/woolimhome/releases/download/synthetic/runtime.zip";
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function findPowerShell() {
  for (const command of process.platform === "win32" ? ["powershell.exe", "pwsh"] : ["pwsh"]) {
    try {
      await execute(command, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], {
        windowsHide: true, timeout: 15_000,
      });
      return command;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return null;
}

const powerShell = await findPowerShell();
const canRun = process.platform === "win32" && Boolean(powerShell);

async function runPowerShell(command) {
  const { stdout } = await execute(powerShell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
    `[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$ErrorActionPreference='Stop';. ${quote(updater)};${command}`], {
    windowsHide: true, timeout: 30_000,
  });
  return stdout.trim();
}

async function withFixture(action, files = { "preparation-runtime-manifest.json": "{}", "scripts/example.mjs": "synthetic bytes" }) {
  const base = path.join(root, ".codex-tmp");
  await mkdir(base, { recursive: true });
  const temporary = await mkdtemp(path.join(base, "bridge-download-"));
  const workerRoot = path.join(temporary, "WoolimWorker");
  const repository = path.join(temporary, "repository-without-dependencies");
  await mkdir(workerRoot);
  await mkdir(repository);
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
  const archive = await zip.generateAsync({ type: "nodebuffer" });
  const sourceArchive = path.join(temporary, "source.zip");
  await writeFile(sourceArchive, archive);
  const approved = { fingerprint, version: "1.0.0", platform: "win32", arch: "x64", note: "synthetic", url: archiveUrl,
    archiveSha256: sha256(archive) };
  try { return await action({ temporary, workerRoot, repository, sourceArchive, approved }); }
  finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(base));
    assert.ok(path.basename(temporary).startsWith("bridge-download-"));
    await rm(temporary, { recursive: true, force: true });
  }
}

function harness(fixture, { digest = fixture.approved.archiveSha256 } = {}) {
  const { workerRoot, repository, sourceArchive, approved } = fixture;
  return `
    $script:context=[pscustomobject]@{NodePath=${quote(process.execPath)};Repository=${quote(repository)};WorkerRoot=${quote(workerRoot)}};
    $script:approved=${quote(JSON.stringify({ ...approved, archiveSha256: digest }))}|ConvertFrom-Json;
    $script:events=@();$script:downloaded='';
    function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec,$ErrorAction)
      if($Uri -cne ${quote(archiveUrl)}){throw 'UNEXPECTED_DOWNLOAD_URL'};
      $script:events+=@('download');$script:downloaded=$OutFile;Copy-Item -LiteralPath ${quote(sourceArchive)} -Destination $OutFile;
    }
    function Invoke-BridgeCommand {param($FilePath,$Arguments,$WorkingDirectory,$FailureCode)
      if($Arguments[0] -cne 'scripts/install-preparation-runtime.mjs'){throw 'UNEXPECTED_PACKAGE_BUILD'};
      $script:events+=@('install');$script:installArguments=@($Arguments);
      if(-not(Test-Path -LiteralPath (Join-Path $Arguments[2] 'scripts/example.mjs') -PathType Leaf)){throw 'PACKAGE_NOT_EXTRACTED'};
      return ([pscustomobject]@{runtimeRoot=(Join-Path (Join-Path $script:context.WorkerRoot 'preparation-runtimes') ('1.0.0-'+$script:approved.fingerprint));fingerprint=$script:approved.fingerprint;activated=$false}|ConvertTo-Json -Compress)
    }
  `;
}

test("download path requires SHA validation before archive inspection and preserves the verified installer", async () => {
  const source = await readFile(updater, "utf8");
  const start = source.indexOf("function Get-BridgePreparedRuntime");
  const body = source.slice(start, source.indexOf("function Invoke-BridgeUpdate", start));
  assert.ok(body.indexOf("Get-FileHash") < body.indexOf("Assert-BridgeArchiveEntries"));
  assert.ok(body.indexOf("PREPARATION_ARCHIVE_SHA_MISMATCH") < body.indexOf("Expand-Archive"));
  assert.match(body, /'--expected-fingerprint', \$Approved\.fingerprint/);
  assert.match(body, /if \(\$Approved\.url\)/);
  assert.match(body, /else \{\s*if \(-not .*node_modules/s);
});

test("matching approved archive extracts and installs without local node_modules or package building", { skip: !canRun }, async () => {
  await withFixture(async (fixture) => {
    await assert.rejects(access(path.join(fixture.repository, "node_modules")));
    const output = await runPowerShell(`${harness(fixture, { digest: fixture.approved.archiveSha256.toUpperCase() })}
      $target=Get-BridgePreparedRuntime -Context $script:context -Approvals '[]' -Approved $script:approved;
      @{events=$script:events;target=$target;arguments=$script:installArguments;downloaded=$script:downloaded}|ConvertTo-Json -Depth 5 -Compress`);
    const result = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.deepEqual(result.events, ["download", "install"]);
    assert.equal(result.target.fingerprint, fingerprint);
    assert.equal(result.target.path, path.join(fixture.workerRoot, "preparation-runtimes", `1.0.0-${fingerprint}`));
    assert.equal(result.arguments[0], "scripts/install-preparation-runtime.mjs");
    assert.equal(result.arguments[1], "--package");
    assert.equal(result.arguments[5], "--expected-fingerprint");
    assert.equal(result.arguments[6], fingerprint);
    const packageRoot = result.arguments[2];
    assert.equal(path.dirname(packageRoot), path.dirname(result.downloaded));
    assert.equal(path.dirname(path.dirname(result.downloaded)), path.join(fixture.workerRoot, "staging"));
    assert.equal(await readFile(path.join(packageRoot, "scripts/example.mjs"), "utf8"), "synthetic bytes");
    await assert.rejects(access(path.join(fixture.workerRoot, "bridge-runtime.json")));
  });
});

test("wrong archive digest deletes the download before inspection, extraction or installation", { skip: !canRun }, async () => {
  await withFixture(async (fixture) => {
    const output = await runPowerShell(`${harness(fixture, { digest: "f".repeat(64) })}
      function Assert-BridgeArchiveEntries {throw 'MUST_NOT_OPEN_ARCHIVE'};
      function Expand-Archive {throw 'MUST_NOT_EXTRACT_ARCHIVE'};
      $caught='';try{Get-BridgePreparedRuntime -Context $script:context -Approvals '[]' -Approved $script:approved}catch{$caught=$_.Exception.Message};
      @{caught=$caught;events=$script:events;downloaded=$script:downloaded}|ConvertTo-Json -Compress`);
    const result = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.equal(result.caught, "PREPARATION_ARCHIVE_SHA_MISMATCH");
    assert.deepEqual(result.events, ["download"]);
    await assert.rejects(access(result.downloaded));
    assert.deepEqual(await readdir(path.dirname(result.downloaded)), []);
  });
});

test("download failure removes partial bytes and returns the dedicated error", { skip: !canRun }, async () => {
  await withFixture(async (fixture) => {
    const output = await runPowerShell(`${harness(fixture)}
      function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec,$ErrorAction)
        $script:downloaded=$OutFile;[IO.File]::WriteAllText($OutFile,'partial download');throw 'SYNTHETIC_NETWORK_DETAILS_NEVER_SHOWN'};
      function Expand-Archive {throw 'MUST_NOT_EXTRACT_ARCHIVE'};
      $caught='';try{Get-BridgePreparedRuntime -Context $script:context -Approvals '[]' -Approved $script:approved}catch{$caught=$_.Exception.Message};
      @{caught=$caught;events=$script:events;downloaded=$script:downloaded}|ConvertTo-Json -Compress`);
    assert.ok(!output.includes("SYNTHETIC_NETWORK_DETAILS_NEVER_SHOWN"));
    const result = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.equal(result.caught, "PREPARATION_ARCHIVE_DOWNLOAD_FAILED");
    assert.deepEqual(result.events, []);
    await assert.rejects(access(result.downloaded));
  });
});

test("archive with an approved digest still cannot extract a traversal entry", { skip: !canRun }, async () => {
  await withFixture(async (fixture) => {
    const output = await runPowerShell(`${harness(fixture)}
      function Expand-Archive {throw 'MUST_NOT_EXTRACT_UNSAFE_ARCHIVE'};
      $caught='';try{Get-BridgePreparedRuntime -Context $script:context -Approvals '[]' -Approved $script:approved}catch{$caught=$_.Exception.Message};
      @{caught=$caught;events=$script:events}|ConvertTo-Json -Compress`);
    const result = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.equal(result.caught, "PREPARATION_ARCHIVE_INVALID");
    assert.deepEqual(result.events, ["download"]);
    await assert.rejects(access(path.join(fixture.workerRoot, "escaped.txt")));
  }, { "../escaped.txt": "unsafe entry" });
});

test("downloaded contents must still pass the real installer even when archive SHA is approved", { skip: !canRun }, async () => {
  await withFixture(async (fixture) => {
    const config = JSON.stringify({ fingerprint: "a".repeat(64), note: "preserve existing config" });
    await writeFile(path.join(fixture.workerRoot, "bridge-runtime.json"), config);
    const output = await runPowerShell(`
      $script:nativeTransport=\${function:Invoke-BridgeCommand};${harness(fixture)}
      function Invoke-BridgeCommand {param($FilePath,$Arguments,$WorkingDirectory,$FailureCode)
        $script:events+=@('install');
        $Arguments[0]=${quote(path.join(root, "scripts/install-preparation-runtime.mjs"))};
        return & $script:nativeTransport @PSBoundParameters
      }
      $caught='';try{Get-BridgePreparedRuntime -Context $script:context -Approvals '[]' -Approved $script:approved}catch{$caught=$_.Exception.Message};
      @{caught=$caught;events=$script:events}|ConvertTo-Json -Compress`);
    const result = JSON.parse(output.split(/\r?\n/).at(-1));
    assert.equal(result.caught, "PREPARATION_PACKAGE_MANIFEST_MISMATCH");
    assert.deepEqual(result.events, ["download", "install"]);
    assert.equal(await readFile(path.join(fixture.workerRoot, "bridge-runtime.json"), "utf8"), config);
    await assert.rejects(access(path.join(fixture.workerRoot, "preparation-runtimes")));
  });
});

test("an unresponsive approval command times out without delaying the previous runtime indefinitely", { skip: !canRun }, async () => {
  const output = await runPowerShell(`
    $watch=[Diagnostics.Stopwatch]::StartNew();$caught='';
    try {Invoke-BridgeCommand -FilePath ${quote(process.execPath)} -WorkingDirectory ${quote(root)} -Arguments @('-e', 'setTimeout(() => {}, 10000)') -TimeoutSeconds 1 -FailureCode 'PREPARATION_APPROVAL_FETCH_FAILED'|Out-Null
    } catch {$caught=$_.Exception.Message};
    @{caught=$caught;elapsedMs=$watch.ElapsedMilliseconds}|ConvertTo-Json -Compress`);
  const result = JSON.parse(output.split(/\r?\n/).at(-1));
  assert.equal(result.caught, "PREPARATION_APPROVAL_FETCH_FAILED");
  assert.ok(result.elapsedMs >= 900, `timeout returned too early: ${result.elapsedMs}ms`);
  assert.ok(result.elapsedMs < 8000, `timeout did not bound the child command: ${result.elapsedMs}ms`);
});
