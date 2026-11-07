import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import sharp from 'sharp';

const execute = promisify(execFile);
const workerPath = fileURLToPath(new URL('../../tools/woolim-pc-worker/worker.ps1', import.meta.url));
const quote = value => `'${value.replaceAll("'", "''")}'`;

test('worker rejection messages list portrait 4:3 for both PDF pages and presentation slides', async () => {
  const source = await readFile(workerPath, 'utf8');
  for (const kind of ['Page', 'Slide']) {
    const message = source.split(/\r?\n/).find(line => line.includes(`NON_PRESENTATION_LAYOUT: ${kind} ratio`));
    assert.match(message, /4:3 portrait/);
  }
});

test('worker accepts ratio 0.75 without NON_PRESENTATION_LAYOUT and preserves other supported formats', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'worker-page-ratio-'));
  const portraitPage = path.join(temporary, 'portrait-4x3.png');
  t.after(async () => { await rm(portraitPage, { force: true }); await rmdir(temporary); });
  await sharp({ create: { width: 300, height: 400, channels: 3, background: '#fff' } }).png().toFile(portraitPage);
  // Load only the two ratio checks, so this never starts worker bootstrap or COM.
  const command = `$ErrorActionPreference='Stop';$tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(workerPath)},[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count){throw 'WORKER_PARSE_ERROR'};foreach($name in @('Test-SupportedPageRatio','Assert-SupportedPageImage')){$functionAst=$ast.Find({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true);. ([scriptblock]::Create($functionAst.Extent.Text))};Assert-SupportedPageImage -ImagePath ${quote(portraitPage)};$ratios=@(0.75,(16.0/9.0),(4.0/3.0),(297.0/210.0),(210.0/297.0),(0.75*1.024),(0.75*1.026),1.1);$accepted=@($ratios|ForEach-Object{Test-SupportedPageRatio -AspectRatio $_});ConvertTo-Json -InputObject $accepted -Compress`;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: 25_000,
  });
  assert.deepEqual(JSON.parse(stdout.trim()), [true, true, true, true, true, true, false, false]);
});
