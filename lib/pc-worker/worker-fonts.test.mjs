import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import JSZip from 'jszip';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('../../tools/woolim-pc-worker/worker.ps1', import.meta.url));
const quote = value => `'${value.replaceAll("'", "''")}'`;
const functions = ['Get-NormalizedWorkerFont','Get-WorkerFontAliases','Get-WorkerSlideThemes','Resolve-WorkerFont','Get-WorkerShapeFonts'];
const harness = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(worker)},[ref]$tokens,[ref]$errors);if($errors.Count){throw 'WORKER_PARSE_ERROR'};foreach($name in @(${functions.map(quote).join(',')})){$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);. ([scriptblock]::Create($fn.Extent.Text))};`;
async function run(code) {
  const { stdout } = await execute('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(harness + code,'utf16le').toString('base64')], { windowsHide:true, timeout:30_000 });
  return JSON.parse(stdout.trim());
}
const windows = { skip:process.platform !== 'win32' };
const relationships = (kind, target, id='r1', mode='') => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}" ${mode}/></Relationships>`;
const theme = (major,minor) => `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Hang" typeface="${major}"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Hang" typeface="${minor}"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
async function fixture(change = () => {}) {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="300" r:id="rB"/><p:sldId id="256" r:id="rA"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels',relationships('slide','slides/slide2.xml','rB').replace('</Relationships>', '<Relationship Id="rA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'));
  for (const index of [1,2]) {
    zip.file(`ppt/slides/_rels/slide${index}.xml.rels`,relationships('slideLayout',`../slideLayouts/layout${index}.xml`));
    zip.file(`ppt/slideLayouts/_rels/layout${index}.xml.rels`,relationships('slideMaster',`../slideMasters/master${index}.xml`));
    zip.file(`ppt/slideMasters/_rels/master${index}.xml.rels`,relationships('theme',`../theme/theme${index}.xml`));
    zip.file(`ppt/theme/theme${index}.xml`,index===1?theme('Malgun Gothic','Malgun Gothic'):theme('Other Major','Other Minor'));
  }
  change(zip);
  const root=await mkdtemp(path.join(tmpdir(),'woolim-fonts-'));
  const source=path.join(root,'source.pptx');
  await writeFile(source, await zip.generateAsync({type:'nodebuffer'}));
  return {source, dispose:()=>rm(root,{recursive:true,force:true})};
}

test('worker checks resolved run fonts before export and no longer swallows inspection errors', async()=>{
  const source=await readFile(worker,'utf8');
  assert.ok(source.indexOf('$slideThemes = Get-WorkerSlideThemes $SourcePath') < source.indexOf('$exportWidth = 2000'));
  assert.match(source, /Get-WorkerShapeFonts \$shape \$theme/);
  assert.doesNotMatch(source,/\$childFontName/);
});

test('localized family aliases recognize Malgun Gothic while any Test alias rejects the family', windows, async()=>{
  const result=await run(`$normal=[pscustomobject]@{Name='맑은 고딕'};$normal|Add-Member ScriptMethod GetName {param($id) if($id -eq 1033){'Malgun Gothic'}else{'맑은 고딕'}};$trial=[pscustomobject]@{Name='Sohne'};$trial|Add-Member ScriptMethod GetName {param($id) if($id -eq 1033){'Test Sohne'}else{'Sohne'}};$names=Get-WorkerFontAliases @($normal,$trial);@{english=$names.Contains('Malgun Gothic');korean=$names.Contains('맑은 고딕');trial=$names.Contains('Sohne')}|ConvertTo-Json -Compress`);
  assert.deepEqual(result,{english:true,korean:true,trial:false});
});

test('actual slide IDs and layout/master/theme relationships resolve both Korean theme tokens', windows, async()=>{
  const f=await fixture();
  try {
    const result=await run(`$themes=Get-WorkerSlideThemes ${quote(f.source)};@{minor=(Resolve-WorkerFont '+mn-ea' $themes['256'] '흥국생명' 1042);major=(Resolve-WorkerFont '+mj-ea' $themes['256'] '제안서' 1042);other=(Resolve-WorkerFont '+mn-ea' $themes['300'] '한글' 1042);latin=(Resolve-WorkerFont '+mn-lt' $themes['256'] 'hello' 1033)}|ConvertTo-Json -Compress`);
    assert.deepEqual(result,{minor:'Malgun Gothic',major:'Malgun Gothic',other:'Other Minor',latin:'Arial'});
  } finally { await f.dispose(); }
});

test('unknown or unresolved theme declarations remain blocked instead of using a global default', windows, async()=>{
  const result=await run(`$errors=@();foreach($name in @('+mn-ea','+mj-ea','+bad-ea')){try{Resolve-WorkerFont $name @{} 'hello' 0}catch{$errors+= $_.Exception.Message}};@{errors=$errors}|ConvertTo-Json -Compress`);
  assert.deepEqual(result.errors,['FONT_THEME_UNRESOLVED','FONT_THEME_UNRESOLVED','FONT_THEME_TOKEN_UNKNOWN']);
});

test('external or ambiguous relationships, overrides, escaping paths and XML entities are rejected', windows, async()=>{
  for (const change of [
    zip=>zip.file('ppt/slideMasters/_rels/master1.xml.rels',relationships('theme','https://external.invalid/theme.xml','r1','TargetMode="External"')),
    zip=>zip.file('ppt/slideMasters/_rels/master1.xml.rels',relationships('theme','../../../../theme.xml')),
    zip=>zip.file('ppt/slideMasters/_rels/master1.xml.rels',relationships('theme','../theme/theme1.xml').replace('</Relationships>','<Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme2.xml"/></Relationships>')),
    zip=>zip.file('ppt/slides/_rels/slide1.xml.rels',relationships('slideLayout','../slideLayouts/layout1.xml').replace('</Relationships>','<Relationship Id="override" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride" Target="../theme/override.xml"/></Relationships>')),
    zip=>zip.file('ppt/theme/theme1.xml','<!DOCTYPE theme [<!ENTITY secret SYSTEM "file:///forbidden">]><theme>&secret;</theme>'),
  ]) {
    const f=await fixture(change);
    try { assert.equal((await run(`$blocked=$false;try{Get-WorkerSlideThemes ${quote(f.source)}|Out-Null}catch{$blocked=$true};@{blocked=$blocked}|ConvertTo-Json -Compress`)).blocked,true); }
    finally { await f.dispose(); }
  }
});

test('nested group text runs inspect East Asian fonts and preserve a genuinely missing font', windows, async()=>{
  const result=await run(`$runs=@([pscustomobject]@{Text='한글';LanguageID=1042;Font=[pscustomobject]@{Name='+mn-ea';NameFarEast='+mj-ea'}},[pscustomobject]@{Text='Latin';LanguageID=1033;Font=[pscustomobject]@{Name='Actually Missing'}});$range=[pscustomobject]@{RunList=$runs};$range|Add-Member ScriptMethod Runs {param($start,$length)if($null -eq $start){return [pscustomobject]@{Count=$this.RunList.Count}};return $this.RunList[$start-1]};$text=[pscustomobject]@{Type=1;HasTable=0;HasTextFrame=-1;TextFrame=[pscustomobject]@{HasText=-1;TextRange=$range}};$group=[pscustomobject]@{Type=6;GroupItems=@([pscustomobject]@{Type=6;GroupItems=@($text)})};$theme=@{minorFont=@{ea='Malgun Gothic'};majorFont=@{ea='Malgun Gothic'}};@{fonts=@(Get-WorkerShapeFonts $group $theme)}|ConvertTo-Json -Compress`);
  assert.deepEqual(result.fonts,['Malgun Gothic','Malgun Gothic','Actually Missing']);
});
