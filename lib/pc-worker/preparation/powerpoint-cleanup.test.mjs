import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { exportLocalPowerPointSlides, LocalPowerPointAdapterError, runPowerPointProcess } from './powerpoint-adapter.ts';

const execute = promisify(execFile);
const converterPath = fileURLToPath(new URL('../../../tools/woolim-pc-worker/prepare-slides.ps1', import.meta.url));
const quote = value => `'${value.replaceAll("'", "''")}'`;
const loadFunctions = `$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(converterPath)},[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};`;
const powershell = command => execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop';${command}`], { windowsHide: true, timeout: 45_000, maxBuffer: 64 * 1024 });

async function temporaryFixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'ppt-cleanup-'));
  t.after(()=>{
    const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('ppt-cleanup-'));
    return rm(target,{recursive:true,force:true});
  });
  return root;
}

test('read-only cleanup verification accepts only absent or replaced owners and rejects live or unknown owners without COM', {skip:process.platform!=='win32'},async t=>{
  const root=await temporaryFixture(t),requestPath=path.join(root,'request.json'),copyPath=path.join(root,`.source-copy-${'a'.repeat(32)}.pptx`);
  await writeFile(requestPath,JSON.stringify({operation:'export',outputDirectory:root}));
  await writeFile(`${requestPath}.powerpoint-owner.json`,JSON.stringify({version:1,id:123,started:'639024768000000000',copyPath}));
  await writeFile(copyPath,'synthetic copy must remain unchanged');
  const {stdout}=await powershell(`${loadFunctions}
    $script:state='';$script:com=0;$script:files=0;$script:results=@();
    $body=($ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-CleanupOperation'},$true)|Select-Object -First 1).Extent.Text;
    $body=$body.Replace('$activeObject = [System.Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")','$script:com++;throw "COM_MUST_NOT_BE_QUERIED"');. ([scriptblock]::Create($body));
    function Remove-ReadOnlyFile {$script:files++;throw 'VERIFY_MUST_NOT_DELETE'};
    function Write-ProtocolLine {param($Value)$script:completed=$Value.operation -eq 'cleanup'};
    function Get-Process {
      param($Id,$ErrorAction)
      if($script:state -eq 'absent'){Write-Error 'Absent' -ErrorId NoProcessFoundForGivenId -ErrorAction Stop}
      if($script:state -eq 'denied'){Write-Error 'Unknown access' -ErrorId AccessDenied -ErrorAction Stop}
      $value=[pscustomobject]@{ProcessName='POWERPNT';StartTime=[DateTime]::new([long]639024768000000000,[DateTimeKind]::Utc);HasExited=$false};$value|Add-Member ScriptMethod Dispose {};
      if($script:state -eq 'replacedName'){$value.ProcessName='other'};
      if($script:state -eq 'replacedTicks'){$value.StartTime=$value.StartTime.AddTicks(1)};
      if($script:state -eq 'unknownProperty'){$value.PSObject.Properties.Remove('StartTime');$value|Add-Member ScriptProperty StartTime {throw 'UNKNOWN_START_TIME'}};
      return $value
    };
    foreach($state in @('absent','replacedName','replacedTicks','live','denied','unknownProperty')){
      $script:state=$state;$script:completed=$false;$code='';
      try{Invoke-CleanupOperation -Request ([pscustomobject]@{exportRequestPath=${quote(requestPath)};verifyOnly=$true})}catch{$code=[string]$_.Exception.Data['WoolimPreparationCode']};
      $script:results+=@{state=$state;completed=$script:completed;code=$code}
    };
    @{results=$script:results;com=$script:com;files=$script:files}|ConvertTo-Json -Compress -Depth 4`);
  const result=JSON.parse(stdout.trim());
  assert.equal(result.com,0);assert.equal(result.files,0);
  for(const row of result.results){
    const gone=['absent','replacedName','replacedTicks'].includes(row.state);
    assert.equal(row.completed,gone,row.state);assert.equal(row.code,gone?'':'POWERPOINT_CLEANUP_FAILED',row.state);
  }
  assert.equal(await readFile(copyPath,'utf8'),'synthetic copy must remain unchanged');
});

test('an owner exiting between identity query and COM attachment is accepted only by the fresh read-only verifier', {skip:process.platform!=='win32'},async t=>{
  const root=await temporaryFixture(t),requestPath=path.join(root,'request.json'),copyPath=path.join(root,`.source-copy-${'b'.repeat(32)}.pptx`);
  await writeFile(requestPath,JSON.stringify({operation:'export',outputDirectory:root}));
  await writeFile(`${requestPath}.powerpoint-owner.json`,JSON.stringify({version:1,id:123,started:'639024768000000000',copyPath}));
  const mutex=`Local\\WoolimCleanupVerifier-${path.basename(root)}`;
  const {stdout}=await powershell(`${loadFunctions}
    $script:gone=$false;$script:completed=$false;$script:attaches=0;
    $body=($ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-CleanupOperation'},$true)|Select-Object -First 1).Extent.Text;
    $body=$body.Replace('Local\\WoolimPowerPointPreparation',${quote(mutex)}).Replace('$activeObject = [System.Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")','$script:gone=$true;$script:attaches++;throw "OWNER_EXITED_DURING_ATTACH"');. ([scriptblock]::Create($body));
    function Write-ProtocolLine {param($Value)$script:completed=$Value.operation -eq 'cleanup'};
    function Get-Process {param($Id,$ErrorAction)if($script:gone){Write-Error 'Absent' -ErrorId NoProcessFoundForGivenId -ErrorAction Stop};return [pscustomobject]@{ProcessName='POWERPNT';StartTime=[DateTime]::new([long]639024768000000000,[DateTimeKind]::Utc);HasExited=$false}|Add-Member ScriptMethod Dispose {} -PassThru};
    $primary='';try{Invoke-CleanupOperation -Request ([pscustomobject]@{exportRequestPath=${quote(requestPath)}})}catch{$primary=[string]$_.Exception.Data['WoolimPreparationCode']};
    Invoke-CleanupOperation -Request ([pscustomobject]@{exportRequestPath=${quote(requestPath)};verifyOnly=$true});
    @{primary=$primary;completed=$script:completed;attaches=$script:attaches}|ConvertTo-Json -Compress`);
  assert.deepEqual(JSON.parse(stdout.trim()),{primary:'POWERPOINT_CLEANUP_FAILED',completed:true,attaches:1});
});

test('failed cleanup helper preserves the original error when its exact owner is already gone', {skip:process.platform!=='win32'},async t=>{
  const root=await temporaryFixture(t),scriptPath=path.join(root,'injected.ps1'),marker=path.join(root,'unexpected-com.txt');
  const original=await readFile(converterPath,'utf8');
  const injected=original.replace('"cleanup" { Invoke-CleanupOperation -Request $request; break }','"cleanup" { if (-not $request.verifyOnly) { Throw-PreparationError -Code "POWERPOINT_CLEANUP_FAILED" -Message "SYNTHETIC_HELPER_FAILURE" }; Invoke-CleanupOperation -Request $request; break }')
    .replace('$activeObject = [System.Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")',`[System.IO.File]::WriteAllText(${quote(marker)},'unexpected');throw 'COM_MUST_NOT_BE_QUERIED'`);
  assert.notEqual(injected,original);await writeFile(scriptPath,injected);
  const primary=new LocalPowerPointAdapterError('POWERPOINT_TIMEOUT','Synthetic original failure');let privateRequestPath;
  await assert.rejects(exportLocalPowerPointSlides({sourcePath:path.join(root,'synthetic.pptx'),sourceHash:'a'.repeat(64),outputDirectory:path.join(root,'exports'),slideNumbers:[1],longEdge:800},{scriptPath,
    runProcess:async invocation=>{
      privateRequestPath=invocation.args[invocation.args.indexOf('-RequestPath')+1];
      const request=JSON.parse(await readFile(privateRequestPath,'utf8'));
      await writeFile(`${privateRequestPath}.powerpoint-owner.json`,JSON.stringify({version:1,id:2147483647,started:'1',copyPath:path.join(request.outputDirectory,`.source-copy-${'c'.repeat(32)}.pptx`)}));
      throw primary;
    },
  }),error=>error===primary);
  await assert.rejects(readFile(marker),{code:'ENOENT'});await assert.rejects(readFile(privateRequestPath),{code:'ENOENT'});
});

test('primary cleanup requires strict owner-exit proof after transient process query failures', {skip:process.platform!=='win32'},async t=>{
  const root=await temporaryFixture(t),requestPath=path.join(root,'request.json'),copyPath=path.join(root,`.source-copy-${'d'.repeat(32)}.pptx`);
  await writeFile(requestPath,JSON.stringify({operation:'export',outputDirectory:root}));
  await writeFile(`${requestPath}.powerpoint-owner.json`,JSON.stringify({version:1,id:123,started:'639024768000000000',copyPath}));
  const mutex=`Local\\WoolimCleanupPostcondition-${path.basename(root)}`;
  const {stdout}=await powershell(`${loadFunctions}
    $body=($ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-CleanupOperation'},$true)|Select-Object -First 1).Extent.Text;
    $body=$body.Replace('Local\\WoolimPowerPointPreparation',${quote(mutex)}).Replace('$activeObject = [System.Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")','$activeObject=$null').Replace('$application = [System.Runtime.InteropServices.Marshal]::CreateWrapperOfType('+[Environment]::NewLine+'        $activeObject, [Type]::GetTypeFromProgID("PowerPoint.Application"))','$application=[pscustomobject]@{HWND=1234}');
    $body=$body -replace '\\$application = \\[System.Runtime.InteropServices.Marshal\\]::CreateWrapperOfType\\(\\s*\\$activeObject, \\[Type\\]::GetTypeFromProgID\\("PowerPoint.Application"\\)\\)','$application=[pscustomobject]@{HWND=1234}';. ([scriptblock]::Create($body));
    function Write-ProtocolLine {param($Value)$script:completed=$true};function Remove-ReadOnlyFile {$script:files++};
    function Get-OwnedPowerPointProcess {return [pscustomobject]@{id=123;started=[long]639024768000000000}};
    function Close-OwnedPowerPointProcess {$script:closed++};
    function Get-Process {param($Id,$ErrorAction)$script:queries++;if(($script:scenario -eq 'initial' -and $script:queries -eq 2) -or ($script:scenario -eq 'remaining' -and $script:queries -eq 3)){Write-Error 'Unknown access' -ErrorId AccessDenied -ErrorAction SilentlyContinue;return $null};return [pscustomobject]@{ProcessName='POWERPNT';StartTime=[DateTime]::new([long]639024768000000000,[DateTimeKind]::Utc);HasExited=$false}|Add-Member ScriptMethod Dispose {} -PassThru};
    $results=@();foreach($scenario in @('initial','remaining')){$script:scenario=$scenario;$script:queries=0;$script:completed=$false;$script:closed=0;$script:files=0;$code='';try{Invoke-CleanupOperation -Request ([pscustomobject]@{exportRequestPath=${quote(requestPath)}})}catch{$code=[string]$_.Exception.Data['WoolimPreparationCode']};$results+=@{scenario=$scenario;completed=$script:completed;queries=$script:queries;closed=$script:closed;files=$script:files;code=$code}};
    $results|ConvertTo-Json -Compress`);
  const result=JSON.parse(stdout.trim());
  for(const row of result){assert.equal(row.completed,false,row.scenario);assert.equal(row.files,0,row.scenario);assert.equal(row.code,'POWERPOINT_CLEANUP_FAILED',row.scenario);assert.equal(row.queries,row.scenario==='initial'?3:4,row.scenario);assert.equal(row.closed,row.scenario==='initial'?0:1,row.scenario);}
});

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
      runProcess: invocation => runPowerPointProcess({ ...invocation, timeoutMs: failure === 'timeout' ? 20_000 : 180_000,
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
