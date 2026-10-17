import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('../../tools/woolim-pc-worker/worker.ps1', import.meta.url));
const quote = value => `'${value.replaceAll("'", "''")}'`;
const functions = ['Get-SafeSourceDownloadDiagnostic','Invoke-WorkerSourceCurl','Get-SourceFile'];
const harness = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(worker)},[ref]$tokens,[ref]$errors);if($errors.Count){throw 'WORKER_PARSE_ERROR'};foreach($name in @(${functions.map(quote).join(',')})){$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);. ([scriptblock]::Create($fn.Extent.Text))};$script:logs=[Collections.Generic.List[string]]::new();function Write-WorkerLog {param([string]$Message)$script:logs.Add($Message)};`;
async function run(code) {
  const { stdout }=await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(harness+code,'utf16le').toString('base64')],{windowsHide:true,timeout:45_000});
  return JSON.parse(stdout.trim());
}
const windows={skip:process.platform!=='win32'};

test('download keeps bounded curl retries and records only derived diagnostics',async()=>{
  const source=await readFile(worker,'utf8');
  assert.match(source,/for \(\$attempt = 1; \$attempt -le 3; \$attempt\+\+\)/);
  assert.match(source,/"--retry", "2"/);
  assert.match(source,/"--max-time", "600"/);
  assert.match(source,/\$lines = @\(& curl.exe @CurlArguments 2>\$null\)/);
  assert.match(source,/SOURCE_DOWNLOAD_FAILED: \$\(\$transfer.Diagnostic\)/);
});

test('diagnostic preserves status and final host while excluding URL, credentials and raw request IDs',windows,async()=>{
  const result=await run(`$lines=@('WOOLIM_HTTP=403','WOOLIM_URL=https://username:FAKE_PASSWORD@cdn.example.test/private?signature=FAKE_SIGNATURE','WOOLIM_REQUEST=FAKE_REQUEST_SECRET','WOOLIM_TRACE=FAKE_TRACE_SECRET');@{diagnostic=(Get-SafeSourceDownloadDiagnostic $lines 22)}|ConvertTo-Json -Compress`);
  assert.match(result.diagnostic,/curl=22 http=403 host=cdn.example.test request_id_sha256=[a-f0-9]{64}$/);
  assert.doesNotMatch(result.diagnostic,/username|FAKE_|private|signature/);
});

test('malformed or oversized curl metadata never enters the error message',windows,async()=>{
  const result=await run(`$a=Get-SafeSourceDownloadDiagnostic @('FAKE_SECRET','WOOLIM_URL=https://example.test') 22;$b=Get-SafeSourceDownloadDiagnostic @('WOOLIM_HTTP=403',('WOOLIM_URL=https://example.test/'+('x'*9000)),'WOOLIM_REQUEST=FAKE_SECRET','WOOLIM_TRACE=') 22;@{a=$a;b=$b}|ConvertTo-Json -Compress`);
  for(const value of Object.values(result))assert.equal(value,'curl=22 http=unknown host=unknown request_id_sha256=none');
});

test('source failures retain three attempts, two bounded sleeps, safe logs and original curl options',windows,async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'woolim-download-'));
  try{
    const result=await run(`$script:calls=0;$script:delays=@();$script:options=@();function Start-Sleep {param($Seconds)$script:delays+=$Seconds};function curl.exe {$script:calls++;$script:options=@($args);$global:LASTEXITCODE=22;'WOOLIM_HTTP=403';'WOOLIM_URL=https://cdn.example.test/source?secret=FAKE_URL';'WOOLIM_REQUEST=FAKE_ID';'WOOLIM_TRACE='};$caught='';try{Get-SourceFile -SourceUrl 'https://source.example.test/file?secret=FAKE_URL' -SourcePath ${quote(path.join(root,'source.pdf'))} -AuthorizationHeader 'Authorization: Bearer FAKE_AUTH'}catch{$caught=$_.Exception.Message};@{calls=$script:calls;delays=$script:delays;options=$script:options;error=$caught;logs=$script:logs.ToArray()}|ConvertTo-Json -Compress -Depth 4`);
    assert.equal(result.calls,3);assert.deepEqual(result.delays,[2,4]);
    assert.equal(result.options[result.options.indexOf('--retry')+1],'2');
    assert.ok(result.options.includes('--fail'));assert.ok(result.options.includes('--location'));
    assert.match(result.error,/SOURCE_DOWNLOAD_FAILED: curl=22 http=403 host=cdn.example.test/);
    assert.doesNotMatch(JSON.stringify({error:result.error,logs:result.logs}),/FAKE_|secret=|Authorization|source.example/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('real curl distinguishes 401/403/404 after redirects and keeps response bodies and auth out of logs',windows,async()=>{
  const hits=[];
  const server=createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;hits.push(pathname);
    if(pathname==='/redirect'){res.writeHead(302,{location:'/403?signature=FAKE_SIGNATURE'});res.end();return;}
    const status=Number(pathname.slice(1));
    res.writeHead(status,{'x-request-id':'FAKE_REQUEST_SECRET','x-ncp-apigw-trace-id':'FAKE_TRACE_SECRET'});
    res.end(status===200?'x'.repeat(2048):'FAKE_BODY_SECRET');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root=await mkdtemp(path.join(tmpdir(),'woolim-download-http-'));
  try{
    for(const route of ['401','403','404','redirect','200']){
      const url=`http://127.0.0.1:${server.address().port}/${route}?signature=FAKE_SIGNATURE`;
      const result=await run(`function Start-Sleep {param($Seconds)};$errorText='';try{Get-SourceFile -SourceUrl ${quote(url)} -SourcePath ${quote(path.join(root,`${route}.pdf`))} -AuthorizationHeader 'Authorization: Bearer FAKE_AUTH'}catch{$errorText=$_.Exception.Message};@{error=$errorText;logs=$script:logs.ToArray()}|ConvertTo-Json -Compress`);
      const status=route==='redirect'?'403':route;
      assert.match(result.logs.join('\n'),new RegExp(`http=${status} host=127\\.0\\.0\\.1 request_id_sha256=[a-f0-9]{64}`));
      assert.doesNotMatch(JSON.stringify(result),/FAKE_|signature|Authorization/);
      if(route==='200')assert.equal(result.error,'');else assert.match(result.error,/curl=22/);
    }
    assert.equal(hits.filter(x=>x==='/401').length,3);
    assert.equal(hits.filter(x=>x==='/redirect').length,3);
    assert.equal(hits.filter(x=>x==='/200').length,1);
  }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
