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
import { getPowerPointTestLockWaitMs, runWhenPowerPointFree } from './powerpoint-test-lock.mjs';

const execute = promisify(execFile);
const converterPath = fileURLToPath(new URL('../../../tools/woolim-pc-worker/prepare-slides.ps1', import.meta.url));
const quote = value => `'${value.replaceAll("'", "''")}'`;
const loadFunctions = `$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(converterPath)},[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};`;
const powershell = command => execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop';${command}`], { windowsHide: true, timeout: 45_000, maxBuffer: 64 * 1024 });
const lockWaitMs = getPowerPointTestLockWaitMs();
const lockOptions = { file: import.meta.url };

async function rejectsWhenPowerPointFree(t, operation, expected, message) {
  let rejected = false;
  try {
    const completed = await runWhenPowerPointFree(t, async () => {
      await operation();
      return true;
    }, lockOptions);
    if (completed === undefined) return false;
  } catch (error) {
    await assert.rejects(Promise.reject(error), expected, message);
    rejected = true;
  }
  assert.ok(rejected, 'The converter operation must reject.');
  return true;
}

async function readPowerPointOwner(requestPath, suffix = '.powerpoint-owner.json') {
  const owner = JSON.parse(await readFile(`${requestPath}${suffix}`, 'utf8'));
  assert.ok(Number.isSafeInteger(owner?.id) && owner.id > 0, 'the receipt must identify the owned PID');
  assert.equal(typeof owner.started, 'string', 'the receipt must preserve exact start-time ticks');
  assert.match(owner.started, /^[0-9]{1,19}$/);
  return owner;
}

async function readPowerPointProcesses(id) {
  const { stdout } = await powershell(`
    $process=$null;
    try{$process=Get-Process -Id ${id} -ErrorAction Stop}
    catch{if($_.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenId*'){throw}};
    $identities=@();
    if($null -ne $process){
      try{if(-not $process.HasExited){$identities+=@{id=$process.Id;started=$process.StartTime.ToUniversalTime().Ticks.ToString()}}}
      catch{if(-not $process.HasExited){throw}}
      finally{$process.Dispose()}
    };
    ConvertTo-Json -InputObject $identities -Compress`);
  return JSON.parse(stdout.trim());
}

function assertOwnedPowerPointExited(owner, processes, message) {
  assert.equal(processes.some(process => process.id === owner.id && process.started === owner.started), false, message);
}

async function temporaryFixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'ppt-cleanup-'));
  t.after(()=>{
    const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('ppt-cleanup-'));
    return rm(target,{recursive:true,force:true});
  });
  return root;
}

test('owned PowerPoint exit assertion accepts an absent owner even with an unrelated PowerPoint running', () => {
  const owner = { id: 123, started: '639024768000000000' };
  assertOwnedPowerPointExited(owner, []);
  assertOwnedPowerPointExited(owner, [{ id: 456, started: owner.started }]);
});

test('owned PowerPoint exit assertion rejects the same PID with the same start time', () => {
  const owner = { id: 123, started: '639024768000000000' };
  assert.throws(() => assertOwnedPowerPointExited(owner, [owner], 'the exact owner is still running'), {
    code: 'ERR_ASSERTION', message: /the exact owner is still running/,
  });
});

test('owned PowerPoint exit assertion accepts a reused PID with a different start time', () => {
  const owner = { id: 123, started: '639024768000000000' };
  assertOwnedPowerPointExited(owner, [{ id: owner.id, started: '639024768000000001' }]);
});

test('owned PowerPoint receipt loading rejects a missing receipt file', async t => {
  const root = await temporaryFixture(t);
  await assert.rejects(readPowerPointOwner(path.join(root, 'request.json')), { code: 'ENOENT' });
});

test('export removes only a verified owner receipt and skips the cleanup helper; unknown owners retain it for cleanup', { skip: process.platform !== 'win32', timeout: 30_000 + 3 * lockWaitMs }, async t => {
  const original = await readFile(converterPath, 'utf8');
  for (const state of ['exited', 'live', 'unknown']) {
    const completed = await runWhenPowerPointFree(t, async () => {
      const root = await temporaryFixture(t);
      const marker = path.join(root, `${state}.events.txt`);
      const scriptPath = path.join(root, `${state}.ps1`);
      const sourcePath = path.join(root, `${state}.pptx`);
      const sentinel = path.join(root, `${state}.keep.txt`);
      await writeFile(sourcePath, 'synthetic source; no Office instance is created');
      await writeFile(sentinel, 'keep');
      const sourceHash = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
      const fakeExport = `
        $script:closed=$false;
        $script:slide=[pscustomobject]@{};
        $script:slide|Add-Member ScriptMethod Export {param($destination,$format,$width,$height)[IO.File]::WriteAllBytes($destination,(New-Object byte[] 2048))};
        $slides=[pscustomobject]@{Count=1};$slides|Add-Member ScriptMethod Item {param($number)return $script:slide};
        $script:presentation=[pscustomobject]@{ReadOnly=-1;Slides=$slides;PageSetup=[pscustomobject]@{SlideWidth=400;SlideHeight=300}};
        $script:presentation|Add-Member ScriptMethod Close {};
        $presentations=[pscustomobject]@{};$presentations|Add-Member ScriptMethod Open {param($copy,$readOnly,$untitled,$withWindow)return $script:presentation};
        $script:application=[pscustomobject]@{AutomationSecurity=1;Presentations=$presentations};
        function Get-Process {param($Name,$ErrorAction)return @()};
        function Get-OwnedPowerPointProcess {return [pscustomobject]@{id=123;started=[long]639024768000000000}};
        function Get-ImageDimensions {return [pscustomobject]@{width=800;height=600}};
        function Close-OwnedPowerPointProcess {$script:closed=$true;Add-Content -LiteralPath ${quote(marker)} -Value 'close'};
        function Test-OwnedPowerPointProcessExited {param($Identity)if(-not $script:closed){throw 'VERIFY_BEFORE_CLOSE'};if($Identity.id -ne 123 -or $Identity.started -ne [long]639024768000000000){throw 'WRONG_OWNER'};Add-Content -LiteralPath ${quote(marker)} -Value 'verify';${state === 'unknown' ? "throw 'UNKNOWN_OWNER'" : `return $${state === 'exited' ? 'true' : 'false'}`}};
        Invoke-ExportOperation -Request $request;
        Add-Content -LiteralPath ${quote(marker)} -Value ('receipt:'+(Test-Path -LiteralPath ($RequestPath+'.powerpoint-owner.json')).ToString().ToLowerInvariant());
      `;
      const injected = original
        .replace('$powerPointType = [Type]::GetTypeFromProgID("PowerPoint.Application")', '$powerPointType = [object]')
        .replace('$powerPoint = [Activator]::CreateInstance($powerPointType)', '$powerPoint = $script:application')
        .replace('"export" { Invoke-ExportOperation -Request $request; break }', `"export" { ${fakeExport}; break }`)
        .replace('"cleanup" { Invoke-CleanupOperation -Request $request; break }', `"cleanup" { if(-not (Test-Path -LiteralPath ($request.exportRequestPath+'.powerpoint-owner.json'))){throw 'MISSING_RECEIPT'};Add-Content -LiteralPath ${quote(marker)} -Value 'helper';Write-ProtocolLine ([pscustomobject]@{type='complete';operation='cleanup'}); break }`);
      assert.notEqual(injected, original);
      await writeFile(scriptPath, injected);
      const result = await exportLocalPowerPointSlides({ sourcePath, sourceHash, outputDirectory: path.join(root, `${state}.exports`), slideNumbers: [1], longEdge: 800 }, { scriptPath });
      assert.equal(result.slideCount, 1, state);
      const events = (await readFile(marker, 'utf8')).trim().split(/\r?\n/);
      assert.deepEqual(events, state === 'exited' ? ['close', 'verify', 'receipt:false'] : ['close', 'verify', 'receipt:true', 'helper'], state);
      assert.equal(await readFile(sentinel, 'utf8'), 'keep', state);
      assert.equal(createHash('sha256').update(await readFile(sourcePath)).digest('hex'), sourceHash, state);
      return true;
    }, lockOptions);
    if (completed === undefined) return;
  }
});

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

test('failed cleanup helper preserves the original error when its exact owner is already gone', {skip:process.platform!=='win32',timeout:30_000+lockWaitMs},async t=>{
  let root,scriptPath,marker,primary,privateRequestPath;
  const checked=await rejectsWhenPowerPointFree(t,async()=>{
    root=await temporaryFixture(t);scriptPath=path.join(root,'injected.ps1');marker=path.join(root,'unexpected-com.txt');
    const original=await readFile(converterPath,'utf8');
    const injected=original.replace('"cleanup" { Invoke-CleanupOperation -Request $request; break }','"cleanup" { if (-not $request.verifyOnly) { Throw-PreparationError -Code "POWERPOINT_CLEANUP_FAILED" -Message "SYNTHETIC_HELPER_FAILURE" }; Invoke-CleanupOperation -Request $request; break }')
      .replace('$activeObject = [System.Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")',`[System.IO.File]::WriteAllText(${quote(marker)},'unexpected');throw 'COM_MUST_NOT_BE_QUERIED'`);
    assert.notEqual(injected,original);await writeFile(scriptPath,injected);
    primary=new LocalPowerPointAdapterError('POWERPOINT_TIMEOUT','Synthetic original failure');
    await exportLocalPowerPointSlides({sourcePath:path.join(root,'synthetic.pptx'),sourceHash:'a'.repeat(64),outputDirectory:path.join(root,'exports'),slideNumbers:[1],longEdge:800},{scriptPath,
      runProcess:async invocation=>{
        privateRequestPath=invocation.args[invocation.args.indexOf('-RequestPath')+1];
        const request=JSON.parse(await readFile(privateRequestPath,'utf8'));
        await writeFile(`${privateRequestPath}.powerpoint-owner.json`,JSON.stringify({version:1,id:2147483647,started:'1',copyPath:path.join(request.outputDirectory,`.source-copy-${'c'.repeat(32)}.pptx`)}));
        throw primary;
      },
    });
  },error=>error===primary);
  if(!checked)return;
  await assert.rejects(readFile(marker),{code:'ENOENT'});await assert.rejects(readFile(privateRequestPath),{code:'ENOENT'});
});

async function failingCleanupFixture(t) {
  const root = await temporaryFixture(t);
  const scriptPath = path.join(root, 'failed-cleanup.ps1');
  const marker = path.join(root, 'cleanup-events.txt');
  await writeFile(scriptPath, `param([string]$RequestPath)
    $request=[IO.File]::ReadAllText($RequestPath)|ConvertFrom-Json;
    if($request.operation -ne 'cleanup'){throw 'UNEXPECTED_OPERATION'};
    $phase=if($request.verifyOnly){'verify'}else{'cleanup'};
    Add-Content -LiteralPath ${quote(marker)} -Value $phase;
    $reason=if($request.verifyOnly){'SYNTHETIC_VERIFICATION_REFUSAL'}else{'SYNTHETIC_CLEANUP_REFUSAL'};
    @{type='error';code='POWERPOINT_CLEANUP_FAILED';message=$reason}|ConvertTo-Json -Compress;
    exit 1`);
  const sourcePath = path.join(root, 'synthetic.pptx');
  await writeFile(sourcePath, 'synthetic source; no Office instance is created');
  const input = { sourcePath, sourceHash: 'a'.repeat(64), outputDirectory: path.join(root, 'exports'), slideNumbers: [1], longEdge: 800 };
  async function recordOwner(invocation) {
    const requestPath = invocation.args[invocation.args.indexOf('-RequestPath') + 1];
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    await writeFile(`${requestPath}.powerpoint-owner.json`, JSON.stringify({ version: 1, id: 123, started: '639024768000000000', copyPath: path.join(request.outputDirectory, `.source-copy-${'e'.repeat(32)}.pptx`) }));
    return { requestPath, request };
  }
  return { input, scriptPath, marker, recordOwner };
}

test('protocol failures preserve the original code and identity with both cleanup refusal reasons', { skip: process.platform !== 'win32', timeout: 30_000 + 3 * lockWaitMs }, async t => {
  for (const scenario of ['source', 'timeout', 'checkpoint']) {
    let marker, original, privateRequestPath;
    const checked = await rejectsWhenPowerPointFree(t, async () => {
      const fixture = await failingCleanupFixture(t);
      const { input, scriptPath, recordOwner } = fixture;
      marker = fixture.marker;
      original = scenario === 'checkpoint' ? new Error('SYNTHETIC_CHECKPOINT_FAILURE') : new LocalPowerPointAdapterError(scenario === 'source' ? 'SOURCE_HASH_MISMATCH' : 'POWERPOINT_TIMEOUT', `SYNTHETIC_${scenario.toUpperCase()}_FAILURE`);
      await exportLocalPowerPointSlides(input, {
        scriptPath,
        runProcess: async invocation => {
          ({ requestPath: privateRequestPath } = await recordOwner(invocation));
          throw original;
        },
      });
    }, error => {
      if (scenario === 'checkpoint') {
        assert.ok(error instanceof LocalPowerPointAdapterError);
        assert.equal(error.code, 'POWERPOINT_PROCESS_FAILED');
        assert.match(error.message, /SYNTHETIC_CHECKPOINT_FAILURE/);
      } else {
        assert.equal(error, original);
        assert.equal(error.code, scenario === 'source' ? 'SOURCE_HASH_MISMATCH' : 'POWERPOINT_TIMEOUT');
      }
      assert.equal(error.cleanupError.code, 'POWERPOINT_CLEANUP_FAILED');
      assert.match(error.cleanupError.message, /SYNTHETIC_CLEANUP_REFUSAL/);
      assert.match(error.cleanupError.message, /SYNTHETIC_VERIFICATION_REFUSAL/);
      assert.match(error.message, /POWERPOINT_CLEANUP_FAILED/);
      assert.match(error.message, /SYNTHETIC_CLEANUP_REFUSAL/);
      assert.match(error.message, /SYNTHETIC_VERIFICATION_REFUSAL/);
      return true;
    });
    if (!checked) return;
    assert.deepEqual((await readFile(marker, 'utf8')).trim().split(/\r?\n/), ['cleanup', 'verify'], scenario);
    await assert.rejects(readFile(privateRequestPath), { code: 'ENOENT' });
  }
});

test('a successful export reports cleanup-only failure with both helper refusal reasons', { skip: process.platform !== 'win32', timeout: 15_000 + lockWaitMs }, async t => {
  let marker;
  const checked = await rejectsWhenPowerPointFree(t, async () => {
    const fixture = await failingCleanupFixture(t);
    const { input, scriptPath, recordOwner } = fixture;
    marker = fixture.marker;
    await exportLocalPowerPointSlides(input, {
      scriptPath,
      runProcess: async invocation => {
        const { request } = await recordOwner(invocation);
        const slidePath = path.join(request.outputDirectory, 'slide-0001.png');
        await writeFile(slidePath, Buffer.alloc(2048));
        await invocation.onStdoutLine(JSON.stringify({ type: 'slide', sourceSlideNumber: 1, path: slidePath, width: 800, height: 600 }));
        await invocation.onStdoutLine(JSON.stringify({ type: 'complete', operation: 'export', sourceHash: input.sourceHash, outputDirectory: request.outputDirectory, slideCount: 1, sourceSlideNumbers: [1], slideWidth: 400, slideHeight: 300, exportWidth: 800, exportHeight: 600 }));
        return { exitCode: 0, signal: null, stderr: '' };
      },
    });
  }, error => {
    assert.ok(error instanceof LocalPowerPointAdapterError);
    assert.equal(error.code, 'POWERPOINT_CLEANUP_FAILED');
    assert.match(error.message, /SYNTHETIC_CLEANUP_REFUSAL/);
    assert.match(error.message, /SYNTHETIC_VERIFICATION_REFUSAL/);
    return true;
  });
  if (!checked) return;
  assert.deepEqual((await readFile(marker, 'utf8')).trim().split(/\r?\n/), ['cleanup', 'verify']);
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

test('injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process', { skip: process.platform !== 'win32', timeout: 240_000 + 7 * lockWaitMs }, async t => {
  const { stdout: availability } = await powershell("@{available=($null -ne [Type]::GetTypeFromProgID('PowerPoint.Application'));busy=(@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0)}|ConvertTo-Json -Compress");
  const available = JSON.parse(availability.trim());
  if (!available.available || available.busy) { t.skip(available.busy ? 'An existing PowerPoint instance belongs to the user.' : 'PowerPoint is not installed.'); return; }
  const sourcePath = await runWhenPowerPointFree(t, async () => {
    const temporary = await temporaryFixture(t);
    const destination = path.join(temporary, 'synthetic.pptx');
    // Generate a one-slide document without customer data, releasing only this
    // local COM instance. The converter tests below then open read-only copies.
    await powershell(`${loadFunctions}
      $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\\WoolimPowerPointPreparation');$owns=$false;
      try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};
        $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;
        $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);
        $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;
        foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};
        $presentation.SaveAs(${quote(destination)},24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;
      }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath ${quote(destination)};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}`);
    return destination;
  }, { ...lockOptions, syntheticPowerShell: true });
  if (sourcePath === undefined) return;
  const sourceHash = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
  // Record ownership before the converter can remove its verified receipt.
  // The snapshot is test-only and preserves exact PID/start-time assertions.
  const original = (await readFile(converterPath, 'utf8')).replace(
    '} | ConvertTo-Json -Compress), $utf8)',
    '} | ConvertTo-Json -Compress), $utf8); Copy-Item -LiteralPath ($RequestPath+".powerpoint-owner.json") -Destination ($RequestPath+".test-owner.json")',
  );
  for (const shutdown of ['normal', 'failed', 'disconnected']) {
    const attempt = await runWhenPowerPointFree(t, async () => {
      const temporary = await temporaryFixture(t);
      const outputRoot = path.join(temporary, shutdown);
      const outputDirectory = path.join(outputRoot, 'attempt-11111111-1111-4111-8111-111111111111');
      await mkdir(outputDirectory, { recursive: true });
      const requestPath = path.join(temporary, `${shutdown}.request.json`);
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
      if (result) {
        if (typeof result.stdout !== 'string' || !result.stdout.trim()) throw result;
        const record = JSON.parse(result.stdout.trim());
        if (record.code === 'POWERPOINT_BUSY') throw new LocalPowerPointAdapterError(record.code, record.message);
      }
      return { result, requestPath };
    }, lockOptions);
    if (attempt === undefined) return;
    const { result, requestPath } = attempt;
    assert.ok(result, 'the synthetic export must fail');
    const record = JSON.parse(result.stdout.trim());
    assert.equal(record.type, 'error');
    assert.equal(record.code, 'SLIDE_EXPORT_FAILED', `${shutdown}: ${JSON.stringify(record)}`);
    const owner = await readPowerPointOwner(requestPath, '.test-owner.json');
    assertOwnedPowerPointExited(owner, await readPowerPointProcesses(owner.id), `no owned PowerPoint remains after export failure with ${shutdown} shutdown`);
    await assert.rejects(readFile(`${requestPath}.powerpoint-owner.json`), { code: 'ENOENT' });
  }
  for (const failure of ['timeout', 'checkpoint', 'abrupt']) {
    let checkpoints, owner;
    const checked = await rejectsWhenPowerPointFree(t, async () => {
      const temporary = await temporaryFixture(t);
      const scriptPath = path.join(temporary, `${failure}.ps1`);
      const pause = failure === 'abrupt'
        ? original.replace('$previousAutomationSecurity = $powerPoint.AutomationSecurity', '[Environment]::Exit(2); $previousAutomationSecurity = $powerPoint.AutomationSecurity')
        : failure === 'timeout'
        ? original.replace('$previousAutomationSecurity = $powerPoint.AutomationSecurity', 'Start-Sleep -Seconds 60; $previousAutomationSecurity = $powerPoint.AutomationSecurity')
        : original.replace('height = $dimensions.height\n        })', 'height = $dimensions.height\n        }); Start-Sleep -Seconds 30');
      assert.notEqual(pause, original);
      await writeFile(scriptPath, pause);
      checkpoints = 0;
      owner = undefined;
      const checkpointError = new Error('SYNTHETIC_CHECKPOINT_FAILURE');
      await exportLocalPowerPointSlides({ sourcePath, sourceHash, outputDirectory: path.join(temporary, failure), slideNumbers: [1], longEdge: 800 }, {
        scriptPath,
        runProcess: invocation => runPowerPointProcess({ ...invocation, timeoutMs: failure === 'timeout' ? 20_000 : 180_000,
          cleanup: async () => {
            const requestPath=invocation.args[invocation.args.indexOf('-RequestPath')+1];
            // Lock contention exits before ownership is recorded; later assertions still require an owner.
            try { owner = await readPowerPointOwner(requestPath, '.test-owner.json'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            await invocation.cleanup();
          },
        }),
        onSlide: () => { checkpoints++; throw checkpointError; },
      });
    }, error => failure === 'timeout' ? error.code === 'POWERPOINT_TIMEOUT' : failure === 'abrupt' ? error.code === 'POWERPOINT_PROCESS_FAILED' : error.message.includes('SYNTHETIC_CHECKPOINT_FAILURE'), failure);
    if (!checked) return;
    assert.equal(checkpoints, failure === 'checkpoint' ? 1 : 0);
    assert.ok(owner, 'the intended failure occurs after exact process ownership is recorded');
    assertOwnedPowerPointExited(owner, await readPowerPointProcesses(owner.id), `no owned PowerPoint remains after ${failure} rejection`);
  }
});
