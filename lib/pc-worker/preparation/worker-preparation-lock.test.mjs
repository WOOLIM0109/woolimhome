import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import test from "node:test";

const execute = promisify(execFile);
const workerPath = fileURLToPath(new URL("../../../tools/woolim-pc-worker/worker.ps1", import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const testMutex = `Local\\WoolimPreparationLockTest-${randomUUID()}`;
const harness = `$ErrorActionPreference='Stop';$tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(workerPath)},[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count){throw 'WORKER_PARSE_ERROR'};$functionAst=$ast.Find({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-WithPowerPointPreparationLock'},$true);. ([scriptblock]::Create($functionAst.Extent.Text.Replace('Local\\WoolimPowerPointPreparation',${quote(testMutex)})));`;

test("worker 2.10.0 takes shared PowerPoint lock before claim and keeps heartbeat outside it", async () => {
  const source = await readFile(workerPath, "utf8");
  assert.match(source, /\$WorkerVersion = "2\.10\.0"/);
  assert.match(source, /Send-Heartbeat\s+\$conversionCycleRan = Invoke-WithPowerPointPreparationLock -Operation \{\s+\$claim = Invoke-WorkerApi/);
  assert.match(source, /if \(-not \$ownsPreparationMutex\) \{ return \$false \}/);
  assert.match(source, /finally \{\s+if \(\$ownsPreparationMutex\) \{\s+try \{ \$preparationMutex.ReleaseMutex\(\) \}/);
  assert.match(source, /if \(-not \$conversionCycleRan\) \{\s+Write-WorkerLog "Local slide preparation is busy\. No conversion job was claimed this cycle\."\s+\}/);
  assert.match(source, /if \(-not \$Once\) \{ Start-Sleep -Seconds 60 \}/);
});

test("shared lock releases after successful and failed operations without running worker bootstrap", { skip: process.platform !== "win32", timeout: 30_000 }, async () => {
  const command = `${harness}$script:called=0;$first=Invoke-WithPowerPointPreparationLock -Operation {$script:called++};$caught=$false;try {Invoke-WithPowerPointPreparationLock -Operation {throw 'EXPECTED_TEST_FAILURE'} | Out-Null}catch{$caught=$true};$last=Invoke-WithPowerPointPreparationLock -Operation {$script:called++};@{first=$first;last=$last;called=$script:called;caught=$caught}|ConvertTo-Json -Compress`;
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 25_000 });
  assert.deepEqual(JSON.parse(stdout.trim()), { first: true, last: true, called: 2, caught: true });
});

test("another preparation owner prevents claim callback and releases normally later", { skip: process.platform !== "win32", timeout: 35_000 }, async () => {
  const holder = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$m=New-Object System.Threading.Mutex($false,${quote(testMutex)});$owns=$false;try{$owns=$m.WaitOne(10000);if(-not $owns){throw 'TEST_MUTEX_UNAVAILABLE'};[Console]::WriteLine('HELD');[Console]::ReadLine()|Out-Null}finally{if($owns){$m.ReleaseMutex()};$m.Dispose()}`],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let ready = false;
  const readyPromise = new Promise((resolve, reject) => {
    holder.once("error", reject);
    holder.once("exit", () => { if (!ready) reject(new Error("TEST_MUTEX_OWNER_EXITED")); });
    holder.stdout.on("data", (bytes) => { if (bytes.toString().includes("HELD")) { ready = true; resolve(); } });
  });
  try {
    await readyPromise;
    const command = `${harness}$script:called=0;$ran=Invoke-WithPowerPointPreparationLock -Operation {$script:called++};@{ran=$ran;called=$script:called}|ConvertTo-Json -Compress`;
    const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 15_000 });
    assert.deepEqual(JSON.parse(stdout.trim()), { ran: false, called: 0 });
  } finally {
    const done = once(holder, "exit");
    holder.stdin.end("\n");
    await done;
  }
});
