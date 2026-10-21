import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('요건 호출은 원문별 1회, 캐시는 소유 실행만 확정하며 하루 정독은 8개 이하다', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.openchat_programs(id uuid primary key default gen_random_uuid(),status text default 'review_required',
        deadline_at timestamptz,created_at timestamptz default now());
      create table public.openchat_program_attachment_discovery(program_id uuid primary key,checked_at timestamptz);
      create table public.openchat_program_attachments(program_id uuid,created_at timestamptz,extracted_at timestamptz,
        processing_started_at timestamptz,text_status text,text_content text);
      grant select on public.openchat_programs,public.openchat_program_attachment_discovery,public.openchat_program_attachments to service_role;
      grant usage on schema public to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated;`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021032454_openchat_program_requirements.sql', import.meta.url),'utf8'));
    const security = (await db.query(`select c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anon_read,
      has_table_privilege('authenticated',c.oid,'insert') as user_write,
      has_table_privilege('service_role',c.oid,'insert') as service_write
      from pg_class c where c.relname in ('openchat_program_requirements','openchat_program_requirement_attempts',
      'openchat_program_matches','openchat_match_profiles_cache')`)).rows;
    assert.equal(security.length,4);
    for (const row of security) assert.deepEqual(row,{rls:true,anon_read:false,user_write:false,service_write:true});
    assert.equal((await db.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('claim_openchat_requirement','release_openchat_requirement_budget',
      'claim_openchat_match_profiles_refresh','finish_openchat_match_profiles_refresh','release_openchat_match_profiles_refresh',
      'checkpoint_openchat_match_profiles_refresh','save_openchat_program_matches','list_openchat_requirement_work')
      and has_function_privilege('anon',p.oid,'execute')`)).rows[0].n,0);
    const ids = (await db.query(`insert into openchat_programs(id) select gen_random_uuid() from generate_series(1,10) returning id`)).rows.map(r=>r.id);
    await db.exec('set role service_role');
    const claim = async hash => (await db.query('select claim_openchat_requirement($1,$2) as ok',[ids[0],hash])).rows[0].ok;
    assert.equal(await claim('hash-a'),true);
    assert.equal(await claim('hash-a'),false);
    assert.equal(await claim('hash-other-concurrent'),false);
    await db.query(`update openchat_program_requirements set status='failed' where program_id=$1`,[ids[0]]);
    assert.equal(await claim('hash-a'),false);
    assert.equal(await claim('hash-b'),true);
    await db.query('select release_openchat_requirement_budget($1,$2)',[ids[0],'hash-b']);
    assert.equal(await claim('hash-b'),true);
    assert.equal(await claim('hash-a'),false);
    const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
    const cacheClaim = async who => (await db.query(`select claim_openchat_match_profiles_refresh('2026-10-21',$1) as ok`,[who])).rows[0].ok;
    assert.equal(await cacheClaim(owner),true);
    assert.equal(await cacheClaim(other),false);
    assert.equal((await db.query(`select checkpoint_openchat_match_profiles_refresh('2026-10-21',$1,'{"cursor":40}') as ok`,[other])).rows[0].ok,false);
    assert.equal((await db.query(`select checkpoint_openchat_match_profiles_refresh('2026-10-21',$1,'{"cursor":40}') as ok`,[owner])).rows[0].ok,true);
    assert.equal(await cacheClaim(other),true);
    assert.equal((await db.query(`select refresh_state->>'cursor' as cursor,fetched_at from openchat_match_profiles_cache`)).rows[0].cursor,'40');
    assert.equal((await db.query(`select finish_openchat_match_profiles_refresh('2026-10-21',$1,'[]','{}',now()+interval '1 day') as ok`,[owner])).rows[0].ok,false);
    assert.equal((await db.query(`select finish_openchat_match_profiles_refresh('2026-10-21',$1,'[]','{}',now()+interval '1 day') as ok`,[other])).rows[0].ok,true);
    assert.equal(await cacheClaim(owner),false);
    assert.equal((await db.query(`select refresh_state from openchat_match_profiles_cache`)).rows[0].refresh_state,null);
    for (let i=0;i<ids.length;i++) {
      await db.query(`insert into openchat_program_requirements(program_id,input_hash,status) values($1,'fixture','extracted')
        on conflict(program_id) do update set status='extracted',input_hash='fixture'`,[ids[i]]);
      await db.query(`select save_openchat_program_matches($1,'2026-10-21','fixture',$2::jsonb)`,[ids[i],JSON.stringify([
        {targetKind:'self',targetId:'woolim',targetName:'울림컴퍼니',verdict:i===9?'mismatch':'unknown',reasons:['정보 부족'],score:i},
        {targetKind:'customer',targetId:'sample',targetName:'테스트 대상',verdict:'candidate',reasons:[],score:i},
      ])]);
    }
    const selected=(await db.query(`select count(distinct program_id)::int as n,max(score)::float as max
      from openchat_program_matches where selected_for_reading`)).rows[0];
    assert.deepEqual(selected,{n:8,max:9});
    assert.equal((await db.query(`select count(*)::int as n from openchat_program_matches where selected_for_reading and verdict='mismatch'`)).rows[0].n,0);
    await assert.rejects(db.query(`select save_openchat_program_matches($1,'2026-10-21','stale','[]')`,[ids[0]]),/Stale requirements/);
    await db.query(`select save_openchat_program_matches($1,'2026-10-21','fixture',$2::jsonb)`,[ids[0],JSON.stringify([
      {targetKind:'self',targetId:'woolim',targetName:'울림컴퍼니',verdict:'unknown',reasons:[],score:7.5},
    ])]);
    assert.equal((await db.query(`select score::float as score from openchat_program_matches where program_id=$1`,[ids[0]])).rows[0].score,7.5);
    await db.exec('reset role');
    await db.query(`update openchat_programs set deadline_at=now()-interval '1 second' where id=$1`,[ids[9]]);
    await db.exec('set role service_role');
    await db.query(`select save_openchat_program_matches($1,'2026-10-21','fixture','[]')`,[ids[0]]);
    assert.equal((await db.query(`select count(*)::int as n from openchat_program_matches where program_id=$1 and selected_for_reading`,[ids[9]])).rows[0].n,0);
    await db.exec('reset role');
    const backlog=(await db.query(`insert into openchat_programs(id,created_at)
      select gen_random_uuid(),now()-n*interval '1 minute' from generate_series(1,81) n returning id,created_at`)).rows
      .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    for (const [index,p] of backlog.entries()) {
      await db.query(`insert into openchat_program_attachments(program_id,created_at,extracted_at,text_status,text_content)
        values($1,now()-interval '1 hour',now()-interval '1 hour','extracted','본문')`,[p.id]);
      if (index===80) continue;
      await db.query(`insert into openchat_program_requirements(program_id,input_hash,status) values($1,'done','extracted')`,[p.id]);
      await db.query(`insert into openchat_program_matches(program_id,target_kind,target_id,target_name,verdict,reasons,review_date)
        values($1,'self','sample','테스트','unknown','[]','2026-10-21')`,[p.id]);
    }
    await db.exec('set role service_role');
    assert.deepEqual((await db.query(`select id from list_openchat_requirement_work('2026-10-21',20,null)`)).rows.map(r=>r.id),[backlog[80].id]);
  } finally { await db.close(); }
});

test('normalization v3 queues saved v2 success for zero-call reuse and preserves legacy RPCs and security', async () => {
  const db = new PGlite();
  const migration = name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table public.openchat_programs(id uuid primary key default gen_random_uuid(),status text not null default 'review_required',
        deadline_at timestamptz,created_at timestamptz not null default now());
      grant usage on schema public to anon,authenticated,service_role;
      grant select on public.openchat_programs to service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated;`);
    for (const name of ['20261020122223_openchat_program_attachments.sql',
      '20261021032454_openchat_program_requirements.sql', '20261021042817_openchat_program_review_batches.sql',
      '20261021051857_openchat_requirement_normalization_version.sql']) await db.exec(await migration(name));
    const day = (await db.query(`select (now() at time zone 'Asia/Seoul')::date::text as day`)).rows[0].day;
    const beforeFunctions = (await db.query(`select p.oid::regprocedure::text as signature,
      pg_get_functiondef(p.oid) as definition,p.prosecdef,p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like '%openchat%' order by signature`)).rows;
    const security = async () => (await db.query(`select c.relname,c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anon_read,
      has_table_privilege('authenticated',c.oid,'insert') as user_write,
      has_table_privilege('service_role',c.oid,'update') as service_write
      from pg_class c where c.relkind='r' and c.relname like 'openchat_%' order by c.relname`)).rows;
    const beforeSecurity = await security();
    const ids = [];
    for (const [index, version, status, excluded] of [[0,2,'extracted',false],[1,3,'extracted',false],
      [2,2,'failed',false],[3,1,'extracted',false],[4,2,'extracted',true]]) {
      const id = (await db.query(`insert into openchat_programs(status,deadline_at)
        values($1,now()+($2::int+1)*interval '1 day') returning id`,[excluded?'excluded':'review_required',index])).rows[0].id;
      ids.push(id);
      await db.query(`insert into openchat_program_attachments(program_id,file_name,file_ext,source_url,
        text_status,text_content,created_at,extracted_at) values($1,'notice.pdf','pdf','https://public-fixture.example/notice',
        'extracted','fixture body',now()-interval '2 hours',now()-interval '1 hour')`,[id]);
      await db.query(`insert into openchat_program_requirements(program_id,input_hash,status,normalization_version,
        model,requirements,source_checked_at,updated_at) values($1,$2,$3,$4,'unchanged-model','{}',now(),now())`,
      [id,`original-hash-${index}`,status,version]);
      await db.query(`insert into openchat_program_requirement_attempts(program_id,input_hash,response_text)
        values($1,$2,'immutable provider artifact')`,[id,`original-hash-${index}`]);
      if (status==='extracted') await db.query(`insert into openchat_program_matches(program_id,target_kind,target_id,target_name,
        verdict,reasons,review_date) values($1,'self','fixture','fixture','unknown','[]',$2)`,[id,day]);
    }
    const immutable = async () => (await db.query(`select program_id,input_hash,model from openchat_program_requirements order by program_id`)).rows;
    const calls = async () => ({
      attempts:(await db.query(`select * from openchat_program_requirement_attempts order by program_id,input_hash`)).rows,
      recoveries:(await db.query(`select * from openchat_program_requirement_recoveries order by program_id,input_hash`)).rows,
    });
    const beforeHashes = await immutable(), beforeCalls = await calls();
    const work = async (include=false, scope=null) => (await db.query(
      `select id from list_openchat_requirement_work($1,100,$2::uuid[],$3)`,[day,scope,include])).rows.map(row=>row.id);
    const queue = async (include=false) => (await db.query(`select openchat_review_queue_status($1,$2) as counts`,[day,include])).rows[0].counts;
    await db.exec('set role service_role');
    assert.deepEqual(await work(),[ids[3]]);
    assert.equal((await queue()).ready,1);
    await db.exec('reset role');
    await db.exec(await migration('20261021060019_openchat_requirement_normalization_v3.sql'));
    const afterFunctions = (await db.query(`select p.oid::regprocedure::text as signature,
      pg_get_functiondef(p.oid) as definition,p.prosecdef,p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like '%openchat%' order by signature`)).rows;
    assert.equal(afterFunctions.length,beforeFunctions.length);
    const changed = new Set(['list_openchat_requirement_work(date,integer,uuid[],boolean)','openchat_review_queue_status(date,boolean)']);
    for (const before of beforeFunctions) {
      const after = afterFunctions.find(row=>row.signature===before.signature);
      assert.ok(after);
      if (!changed.has(before.signature)) assert.deepEqual(after,before);
      else {
        assert.equal(after.acl,before.acl);
        assert.equal(after.prosecdef,false);
        assert.match(after.definition,/normalization_version\s*<\s*3/);
        assert.doesNotMatch(after.definition,/normalization_version\s*<\s*2/);
      }
    }
    assert.deepEqual(await security(),beforeSecurity);
    assert.equal((await db.query(`select column_default from information_schema.columns
      where table_schema='public' and table_name='openchat_program_requirements' and column_name='normalization_version'`)).rows[0].column_default,'1');
    await db.exec('set role service_role');
    assert.deepEqual(await work(),[ids[0],ids[3]]);
    assert.deepEqual(await work(true),[ids[0],ids[3],ids[4]]);
    assert.deepEqual(await work(true,[ids[0],ids[1],ids[2]]),[ids[0]]);
    assert.equal((await queue()).ready,2);
    assert.equal((await queue(true)).ready,3);
    assert.equal((await queue()).requirementsFailed,1);
    assert.deepEqual(await immutable(),beforeHashes);
    assert.deepEqual(await calls(),beforeCalls);
    // The runner's saved-success reuse updates normalization, never a claim or paid-attempt row.
    for (const id of [ids[0],ids[3],ids[4]]) await db.query(`update openchat_program_requirements
      set normalization_version=3 where program_id=$1 and status='extracted'`,[id]);
    assert.deepEqual(await work(true),[]);
    assert.equal((await queue(true)).ready,0);
    assert.deepEqual(await immutable(),beforeHashes);
    assert.deepEqual(await calls(),beforeCalls);
    assert.equal((await db.query(`select claim_openchat_requirement($1,'original-hash-2') as claimed`,[ids[2]])).rows[0].claimed,false);
    assert.deepEqual(await calls(),beforeCalls);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query(`select * from list_openchat_requirement_work($1,100,null,true)`,[day]),/permission denied/);
    await assert.rejects(db.query(`select openchat_review_queue_status($1,true)`,[day]),/permission denied/);
  } finally { await db.close(); }
});
