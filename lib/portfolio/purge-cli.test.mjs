import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('CLI defaults to dry-run, writes verifiable JSON/CSV, rejects snapshot execution and stops on backup failure',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'portfolio-purge-cli-')),snapshot=path.join(root,'snapshot');
 await mkdir(snapshot);
 await writeFile(path.join(snapshot,'content_work_items.json'),JSON.stringify([
  {id:'hold',channel:'naver_design',status:'on_hold',title:'=unsafe spreadsheet title',review_note:'test'},
  {id:'approved',channel:'naver_design',status:'approved',title:'protected'}]));
 const script=fileURLToPath(new URL('../../scripts/purge-naver-design-on-hold.mjs',import.meta.url));
 const run=(args,cwd=root)=>spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8',timeout:30000});
 const result=run(['--snapshot',snapshot]);assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);assert.equal(report.mode,'dry-run');assert.equal(report.count,1);
 const raw=await readFile(path.join(report.backupDir,'rows.json'));
 const plan=JSON.parse(await readFile(path.join(report.backupDir,'plan.json'),'utf8'));
 assert.equal(plan.backupSha256,createHash('sha256').update(raw).digest('hex'));
 assert.equal(JSON.parse(raw).content_work_items[0].id,'hold');
 assert.match(await readFile(path.join(report.backupDir,'summary.csv'),'utf8'),/"'=unsafe spreadsheet title"/);
 const execute=run(['--execute','--snapshot',snapshot]);assert.notEqual(execute.status,0);assert.match(execute.stderr,/스냅샷 모드에서는 삭제할 수 없습니다/);
 const blocked=path.join(root,'blocked');await mkdir(blocked);await writeFile(path.join(blocked,'.codex-tmp'),'not a directory');
 const failed=run(['--snapshot',snapshot],blocked);assert.notEqual(failed.status,0);assert.equal(failed.stdout,'');
});
