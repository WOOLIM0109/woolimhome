import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { verifyReviewCrons } from '../../scripts/verify-program-review-crons.mjs';

test('첨부 저장은 비공개이며 중복 실행·제외·마감 공고를 원자적으로 차단한다', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table public.openchat_programs(id uuid primary key default gen_random_uuid(),status text,deadline_at timestamptz);
      grant usage on schema public to anon,authenticated,service_role;
      grant select on public.openchat_programs to service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated;`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261020122223_openchat_program_attachments.sql', import.meta.url), 'utf8'));
    const security = (await db.query(`select c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anon_read,
      has_table_privilege('authenticated',c.oid,'insert') as user_write,
      has_table_privilege('service_role',c.oid,'insert') as service_write
      from pg_class c where c.relname in ('openchat_program_attachments','openchat_program_attachment_discovery')`)).rows;
    assert.equal(security.length, 2);
    for (const row of security) assert.deepEqual(row, {rls:true,anon_read:false,user_write:false,service_write:true});
    assert.deepEqual((await db.query(`select public,file_size_limit from storage.buckets where id='program-attachments'`)).rows[0], {public:false,file_size_limit:31457280});
    assert.equal((await db.query(`select has_function_privilege('anon','public.claim_openchat_attachment(uuid)','execute') as allowed`)).rows[0].allowed, false);
    const programs = (await db.query(`insert into openchat_programs(status,deadline_at) values
      ('review_required',now()+interval '1 day'),('excluded',null),('published',now()-interval '1 day') returning id`)).rows;
    const attachmentIds = [];
    for (const p of programs) attachmentIds.push((await db.query(`insert into openchat_program_attachments(program_id,file_name,file_ext,source_url) values ($1,'공고문.hwp','hwp','https://example.go.kr/download') returning id`,[p.id])).rows[0].id);
    await db.exec('set role service_role');
    assert.equal((await db.query('select * from claim_openchat_attachment($1)',[attachmentIds[0]])).rows.length,1);
    assert.equal((await db.query('select * from claim_openchat_attachment($1)',[attachmentIds[0]])).rows.length,0);
    for (const id of attachmentIds.slice(1)) assert.equal((await db.query('select * from claim_openchat_attachment($1)',[id])).rows.length,0);
    await db.exec('reset role');
    await db.query(`update openchat_program_attachments set processing_started_at=now()-interval '11 minutes' where id=$1`,[attachmentIds[0]]);
    await db.exec('set role service_role');
    assert.equal((await db.query('select * from claim_openchat_attachment($1)',[attachmentIds[0]])).rows[0].attempts,2);
  } finally { await db.close(); }
});

test('기존 11개와 첨부 세 회를 유지하고 평일 오전 요건 검토만 추가한다', async () => {
  const crons = JSON.parse(await readFile(new URL('../../vercel.json',import.meta.url),'utf8')).crons;
  const original = [
    ['/api/cron/columns','17 1 * * 2,4,6'],['/api/cron/content-operations','7 * * * *'],
    ['/api/cron/openchat/morning-collect','0 23 * * 0-4'],['/api/cron/openchat/morning-draft-notify','0 0 * * 1-5'],
    ['/api/cron/openchat/morning-approval-reminder','0 1 * * 1-5'],['/api/cron/openchat/morning-cutoff','15 1 * * 1-5'],
    ['/api/cron/openchat/morning-ready','0 2 * * 1-5'],['/api/cron/openchat/afternoon-draft','0 6 * * *'],
    ['/api/cron/openchat/afternoon-cutoff','30 8 * * *'],['/api/cron/openchat/afternoon-ready','0 9 * * *'],
    ['/api/cron/retention','40 20 * * *'],
  ];
  assert.deepEqual(crons.filter(c=>!c.path.endsWith('/attachments') && c.path!=='/api/cron/program-review').map(c=>[c.path,c.schedule]),original);
  assert.deepEqual(crons.filter(c=>c.path.endsWith('/attachments')).map(c=>c.schedule),['10,40 23 * * 0-4','10 0 * * 1-5']);
  assert.deepEqual(crons.filter(c=>c.path==='/api/cron/program-review').map(c=>c.schedule),['*/2 23 * * 0-4','*/2 0 * * 1-5']);
  assert.equal(crons.length, 15);
  verifyReviewCrons({crons});
});
