import assert from 'node:assert/strict';
import test from 'node:test';
import { portfolioTestDatabase, ledgerMigrations } from './sql-test-database.mjs';

test('publication and ledger commit atomically; conflicting URLs roll back and retries stay one row',async()=>{
  const db=await portfolioTestDatabase(ledgerMigrations);
  try {
    await db.exec(`set role service_role;
      insert into content_work_items(id,channel,format,title,status,metadata) values
      ('00000000-0000-0000-0000-000000000001','naver_design','portfolio','기존 글','review_required','{"portfolioPublication":{"normalizedProjectName":"판스캠","representativeHashes":["aaaaaaaaaaaaaaaa"]}}');
      update content_work_items set status='published',published_url_normalized='https://blog.naver.com/wl_0109/123',published_at=now();
      update content_work_items set status='published';`);
    assert.equal((await db.query('select * from portfolio_publication_ledger')).rows.length,1);
    await db.exec(`insert into content_work_items(id,channel,format,title,status,metadata) values
      ('00000000-0000-0000-0000-000000000002','naver_design','portfolio','다른 프로젝트','review_required','{"portfolioPublication":{"normalizedProjectName":"다른프로젝트"}}')`);
    await assert.rejects(db.exec(`update content_work_items set status='published',published_url_normalized='https://blog.naver.com/wl_0109/123',published_at=now() where id='00000000-0000-0000-0000-000000000002'`),/PORTFOLIO_PUBLICATION_CONFLICT/);
    assert.equal((await db.query(`select status from content_work_items where id='00000000-0000-0000-0000-000000000002'`)).rows[0].status,'review_required');
    for(const role of ['anon','authenticated']) {
      await db.exec(`reset role;set role ${role}`);
      await assert.rejects(db.query('select * from portfolio_publication_ledger'),/permission denied/);
      await assert.rejects(db.exec(`insert into portfolio_publication_ledger(normalized_project_name,blog_url,title,source) values('x','https://blog.naver.com/wl_0109/999','x','manual')`),/permission denied/);
    }
  } finally {await db.close();}
});

test('manual registration excludes atomically and refuses an already owned candidate',async()=>{
  const db=await portfolioTestDatabase(ledgerMigrations);
  try {
    const {rows:[candidate]}=await db.query(`insert into portfolio_candidates(project_name) values('판스캠 원본') returning *`);
    const register=()=>db.query(`select exclude_published_portfolio_candidate($1,$2,'판스캠','https://blog.naver.com/wl_0109/123','기존 글',null)`,[candidate.id,candidate.updated_at]);
    await register();
    assert.equal((await db.query('select status from portfolio_candidates')).rows[0].status,'excluded');
    assert.equal((await db.query('select source from portfolio_publication_ledger')).rows[0].source,'manual');
    await assert.rejects(register(),/PORTFOLIO_CANDIDATE_CHANGED/);
    assert.equal((await db.query('select * from portfolio_publication_ledger')).rows.length,1);
  } finally {await db.close();}
});
