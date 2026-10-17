import assert from 'node:assert/strict';
import test from 'node:test';
import { portfolioTestDatabase,ledgerMigrations } from './sql-test-database.mjs';
export const guardMigration='20261016191618_portfolio_candidate_dedupe_guard.sql';

test('restart defaults paused; unchecked PC conversion is rejected; reservations recheck names and hashes atomically',async()=>{
 const db=await portfolioTestDatabase([...ledgerMigrations,guardMigration]);
 try {
  const {rows:[a,b,c]}=await db.query(`insert into portfolio_candidates(project_name) values('원본'),('사본'),('다른이름') returning *`);
  const reserve=(candidate,name,hash='aaaaaaaaaaaaaaaa',key=candidate.id)=>db.query(`select reserve_deduplicated_portfolio_candidate($1,$2,$3,$4,$5) id`,[
   candidate.id,candidate.updated_at,name,{dedupeVersion:'project-dedupe-v1',representativeHashes:[hash],normalizedProjectName:name,duplicateScore:0,selectionScore:80,selectionReasons:['test']},
   {title:name,schedule_key:key,metadata:{candidateId:candidate.id}}]);
  await assert.rejects(reserve(a,'판스캠'),/PORTFOLIO_RESTART_APPROVAL_REQUIRED/);
  await assert.rejects(db.query(`insert into content_jobs(candidate_id,job_type,status) values($1,'convert','pc_waiting')`,[a.id]),/PORTFOLIO_DEDUPE_REQUIRED/);
  await db.exec(`update portfolio_automation_control set first_run_approved=true,hash_threshold=4,calibration_evidence='fixture',approved_at=now()`);
  const first=(await reserve(a,'판스캠')).rows[0].id;assert.ok(first);
  assert.equal((await reserve(b,'판스캠','cccccccccccccccc')).rows[0].id,null);
  assert.equal((await reserve(c,'다른이름','aaaaaaaaaaaaaaab')).rows[0].id,null);
  assert.equal((await db.query('select * from content_work_items')).rows.length,1);
  assert.equal((await db.query('select * from content_jobs')).rows.length,6);
  assert.equal((await db.query(`select status from portfolio_candidates where id=$1`,[b.id])).rows[0].status,'candidate');
  // A child failure must not strand a selected candidate or an incomplete work item.
  await db.exec(`alter table content_jobs add constraint test_fail_new_jobs check(work_item_id='${first}')`);
  await assert.rejects(reserve(b,'독립프로젝트','cccccccccccccccc'),/test_fail_new_jobs/);
  assert.equal((await db.query(`select status from portfolio_candidates where id=$1`,[b.id])).rows[0].status,'candidate');
  assert.equal((await db.query('select * from content_work_items')).rows.length,1);
 } finally {await db.close();}
});
