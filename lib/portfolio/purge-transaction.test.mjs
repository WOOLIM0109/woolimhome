import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import { portfolioTestDatabase,ledgerMigrations } from './sql-test-database.mjs';
import { planPortfolioPurge,PURGE_TABLES } from './purge-plan.mjs';

test('purge rejects stale backups, preserves shared image manifests and protected work, and resets candidates',async()=>{
 const db=await portfolioTestDatabase([...ledgerMigrations,'20261016191618_portfolio_candidate_dedupe_guard.sql','20261016192646_portfolio_on_hold_purge.sql']);
 try {
  const guards=await readFile(new URL('../../supabase/migrations/202609070003_portfolio_mockup_sessions.sql',import.meta.url),'utf8');
  await db.exec(guards.slice(guards.indexOf('create or replace function public.guard_verified_portfolio_images()')));
  const {rows:[candidate]}=await db.query(`insert into portfolio_candidates(project_name,status,metadata) values('판스캠','on_hold','{"dedupeVersion":"old","workItemId":"old"}') returning *`);
  const {rows:[hold]}=await db.query(`insert into content_work_items(channel,format,title,status,metadata) values('naver_design','portfolio','보류','on_hold',$1) returning *`,[{candidateId:candidate.id}]);
  await db.query(`insert into content_jobs(work_item_id,candidate_id,job_type,status) values($1,$2,'draft','on_hold')`,[hold.id,candidate.id]);
  const {rows:[set]}=await db.query(`insert into portfolio_image_sets(work_item_id,manifest) values($1,'{}') returning *`,[hold.id]);
  await db.query(`insert into content_work_items(channel,status,metadata) values('naver_design','approved',$1),('naver_design','scheduled','{}'),('naver_design','review_required','{}'),('naver_consulting','on_hold','{}')`,[{activeImageSetId:set.id}]);
  const snapshot=async()=>Object.fromEntries(await Promise.all(PURGE_TABLES.map(async table=>[table,(await db.query(`select * from ${table}`)).rows])));
  const purge=plan=>db.query('select purge_naver_design_on_hold($1,$2)',[plan.backup,plan.retainedSetIds]);
  const first=planPortfolioPurge(await snapshot());assert.deepEqual(first.retainedSetIds,[set.id]);
  const incomplete=structuredClone(first);delete incomplete.backup.content_review_assets;
  await assert.rejects(purge(incomplete),/PURGE_BACKUP_MISSING/);
  const wrongScope=structuredClone(first);wrongScope.backup.portfolio_candidates=[];
  await assert.rejects(purge(wrongScope),/PURGE_CANDIDATE_SCOPE_MISMATCH/);
  await db.query(`update content_work_items set summary='changed' where id=$1`,[hold.id]);
  await assert.rejects(purge(first),/PURGE_BACKUP_STALE/);
  assert.equal((await db.query('select * from content_jobs')).rows.length,1);
  const fresh=planPortfolioPurge(await snapshot());
  await db.exec('revoke insert,update,delete on portfolio_image_sets,portfolio_image_set_activations from service_role;set role service_role');
  await purge(fresh);
  assert.equal((await db.query('select * from content_work_items')).rows.length,4);
  assert.equal((await db.query('select * from content_jobs')).rows.length,0);
  assert.equal((await db.query('select work_item_id from portfolio_image_sets')).rows[0].work_item_id,null);
  const reset=(await db.query('select * from portfolio_candidates')).rows[0];assert.equal(reset.status,'candidate');assert.equal(reset.metadata.dedupeVersion,undefined);
  await db.exec('reset role;set role authenticated');
  await assert.rejects(purge(fresh),/permission denied/);
 } finally {await db.close();}
});
