import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { exportLocalPowerPointSlides, runPowerPointProcess } from './powerpoint-adapter.ts';

const execute = promisify(execFile);
const converterPath = fileURLToPath(new URL('../../../tools/woolim-pc-worker/prepare-slides.ps1', import.meta.url));
const quote = value => `'${value.replaceAll("'", "''")}'`;
const loadFunctions = `$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(converterPath)},[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};`;
const powershell = command => execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop';${command}`], { windowsHide: true, timeout: 45_000, maxBuffer: 64 * 1024 });

test('converter cleanup is limited to its exact owned instance and read-only attempt document', { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
  const { stdout } = await powershell(`${loadFunctions}
    $script:quit=0;$script:killed=0;
    $collection=[pscustomobject]@{Count=1;document=[pscustomobject]@{ReadOnly=-1;FullName='C:\\private\\user.pptx'}};
    $collection|Add-Member ScriptMethod Item {param($number)return $this.document};
    $app=[pscustomobject]@{Presentations=$collection};$app|Add-Member ScriptMethod Quit {$script:quit++};
    $identity=[pscustomobject]@{id=123;started=456};
    function Get-Process {throw 'UNOWNED_PROCESS_MUST_NOT_BE_TOUCHED'};
    Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\\private\\.source-copy-test.pptx';
    $collection.Count=0;
    function Get-Process {return [pscustomobject]@{ProcessName='POWERPNT';StartTime=[DateTime]::UtcNow}|Add-Member ScriptMethod Dispose {} -PassThru};
    Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\\private\\.source-copy-test.pptx';
    function Get-Process {throw 'UNKNOWN_PROCESS_MUST_NOT_BE_TOUCHED'};
    Close-OwnedPowerPointProcess -Application $app -Identity $null -CopyPath 'C:\\private\\.source-copy-test.pptx';
    $disconnected=New-Object -ComObject Scripting.Dictionary;[Runtime.InteropServices.Marshal]::FinalReleaseComObject($disconnected)|Out-Null;
    Close-OwnedPowerPointProcess -Application $disconnected -Identity $null -CopyPath 'C:\\private\\.source-copy-test.pptx';
    $started=[DateTime]::UtcNow;$identity=[pscustomobject]@{id=123;started=$started.Ticks};$collection.Count=1;$collection.document.FullName='C:\\private\\.source-copy-test.pptx';
    $app|Add-Member ScriptMethod Quit {$script:quit++;$this.Presentations.document.FullName='C:\\private\\user.pptx';throw 'SYNTHETIC_QUIT_FAILURE'} -Force;
    $script:process=[pscustomobject]@{ProcessName='POWERPNT';StartTime=$started;HasExited=$false};$script:process|Add-Member ScriptMethod Dispose {};$script:process|Add-Member ScriptMethod WaitForExit {param($timeout)return $false};$script:process|Add-Member ScriptMethod Kill {$script:killed++};
    function Get-Process {return $script:process};
    Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\\private\\.source-copy-test.pptx';
    @{quit=$script:quit;killed=$script:killed}|ConvertTo-Json -Compress`);
  assert.deepEqual(JSON.parse(stdout.trim()), { quit: 3, killed: 0 });
});

test('injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process', { skip: process.platform !== 'win32', timeout: 240_000 }, async t => {
  const { stdout: availability } = await powershell("@{available=($null -ne [Type]::GetTypeFromProgID('PowerPoint.Application'));busy=(@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0)}|ConvertTo-Json -Compress");
  const available = JSON.parse(availability.trim());
  if (!available.available || available.busy) { t.skip(available.busy ? 'An existing PowerPoint instance belongs to the user.' : 'PowerPoint is not installed.'); return; }
  const temporary = await mkdtemp(path.join(tmpdir(), 'ppt-cleanup-'));
  t.after(() => {
    const target=path.resolve(temporary);
    assert.equal(path.dirname(target),path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('ppt-cleanup-'));
    return rm(target, { recursive: true, force: true });
  });
  const sourcePath = path.join(temporary, 'synthetic.pptx');
  // Generate a one-slide document without customer data, releasing only this
  // local COM instance. The converter tests below then open read-only copies.
  await powershell(`${loadFunctions}
    $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\\WoolimPowerPointPreparation');$owns=$false;
    try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};
      $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;
      $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);
      $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;
      foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};
      $presentation.SaveAs(${quote(sourcePath)},24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;
    }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath ${quote(sourcePath)};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}`);
  const sourceHash = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
  const original = await readFile(converterPath, 'utf8');
  for (const shutdown of ['normal', 'failed', 'disconnected']) {
    const outputRoot = path.join(temporary, shutdown);
    const outputDirectory = path.join(outputRoot, 'attempt-11111111-1111-4111-8111-111111111111');
    await mkdir(outputDirectory, { recursive: true });
    const requestPath = path.join(temporary, 'request.json');
    const scriptPath = path.join(temporary, 'injected.ps1');
    let injected = original.replace('$slide.Export($temporaryPath, "PNG", $exportWidth, $exportHeight)', "throw 'SYNTHETIC_EXPORT_FAILURE'");
    assert.notEqual(injected, original);
    if (shutdown === 'failed') injected = injected.replace('$Application.Quit(); $quitRequested = $true', "throw 'SYNTHETIC_QUIT_FAILURE'");
    if (shutdown === 'disconnected') {
      injected = injected.replace('$Application.Quit(); $quitRequested = $true', '$quitRequested = $true; $script:simulateDisconnected = $true');
      injected = injected.replace('param($Application, [string]$CopyPath)', 'param($Application, [string]$CopyPath)\n  if ($script:simulateDisconnected) { return $null }');
      injected = injected.replace('if ($quitRequested) { 20000 }', 'if ($quitRequested) { 100 }');
    }
    await writeFile(scriptPath, injected);
    await writeFile(requestPath, JSON.stringify({ operation: 'export', sourcePath, sourceHash, outputRoot, outputDirectory, slideNumbers: [1], longEdge: 800 }));
    let result;
    try { await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-RequestPath', requestPath], { windowsHide: true, timeout: 40_000, maxBuffer: 64 * 1024 }); }
    catch (error) { result = error; }
    assert.ok(result, 'the synthetic export must fail');
    const record = JSON.parse(result.stdout.trim());
    assert.equal(record.type, 'error');
    assert.equal(record.code, 'SLIDE_EXPORT_FAILED');
    const { stdout: processes } = await powershell("[Console]::WriteLine(@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count)");
    assert.equal(Number(processes.trim()), 0, `no owned PowerPoint remains after export failure with ${shutdown} shutdown`);
  }
  for (const failure of ['timeout', 'checkpoint', 'abrupt']) {
    const scriptPath = path.join(temporary, `${failure}.ps1`);
    const pause = failure === 'abrupt'
      ? original.replace('$previousAutomationSecurity = $powerPoint.AutomationSecurity', '[Environment]::Exit(2); $previousAutomationSecurity = $powerPoint.AutomationSecurity')
      : failure === 'timeout'
      ? original.replace('$previousAutomationSecurity = $powerPoint.AutomationSecurity', 'Start-Sleep -Seconds 60; $previousAutomationSecurity = $powerPoint.AutomationSecurity')
      : original.replace('height = $dimensions.height\n        })', 'height = $dimensions.height\n        }); Start-Sleep -Seconds 30');
    assert.notEqual(pause, original);
    await writeFile(scriptPath, pause);
    let checkpoints = 0;
    let ownedReceiptSeen = false;
    const checkpointError = new Error('SYNTHETIC_CHECKPOINT_FAILURE');
    await assert.rejects(exportLocalPowerPointSlides({ sourcePath, sourceHash, outputDirectory: path.join(temporary, failure), slideNumbers: [1], longEdge: 800 }, {
      scriptPath,
      runProcess: invocation => runPowerPointProcess({ ...invocation, timeoutMs: failure === 'timeout' ? 20_000 : 30_000,
        cleanup: async () => {
          const requestPath=invocation.args[invocation.args.indexOf('-RequestPath')+1];
          const owner=JSON.parse(await readFile(`${requestPath}.powerpoint-owner.json`,'utf8'));
          ownedReceiptSeen=Number.isSafeInteger(owner.id)&&typeof owner.started==='string';
          await invocation.cleanup();
        },
      }),
      onSlide: () => { checkpoints++; throw checkpointError; },
    }), error => failure === 'timeout' ? error.code === 'POWERPOINT_TIMEOUT' : failure === 'abrupt' ? error.code === 'POWERPOINT_PROCESS_FAILED' : error.message.includes('SYNTHETIC_CHECKPOINT_FAILURE'), failure);
    assert.equal(checkpoints, failure === 'checkpoint' ? 1 : 0);
    assert.equal(ownedReceiptSeen,true,'the intended failure occurs after exact process ownership is recorded');
    const { stdout: processes } = await powershell("[Console]::WriteLine(@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count)");
    assert.equal(Number(processes.trim()), 0, `no owned PowerPoint remains after ${failure} rejection`);
  }
});
