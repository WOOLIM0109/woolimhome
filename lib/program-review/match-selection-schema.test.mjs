import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const DELTA_MIGRATION = "20261021062847_openchat_match_selection_delta.sql";
const PAYLOAD_MIGRATION = "20261021063654_openchat_match_payload_materialization.sql";

test("daily selection writes only changed flags across 56 × 469 matches and atomically records recoverable completion", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table public.openchat_programs(id uuid primary key default gen_random_uuid(),status text not null default 'review_required',
        deadline_at timestamptz,created_at timestamptz not null default now());
      grant usage on schema public to anon,authenticated,service_role;
      grant select on public.openchat_programs to service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated;`);
    for (const name of ["20261020122223_openchat_program_attachments.sql", "20261021032454_openchat_program_requirements.sql",
      "20261021042817_openchat_program_review_batches.sql", "20261021051857_openchat_requirement_normalization_version.sql",
      "20261021060019_openchat_requirement_normalization_v3.sql"]) await db.exec(await migration(name));
    const day = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
    const functions = async () => (await db.query(`select p.oid::regprocedure::text as signature,
      pg_get_functiondef(p.oid) as definition,p.prosecdef,p.proacl::text as acl,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like '%openchat%' order by signature`)).rows;
    const security = async () => (await db.query(`select c.relname,c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anon_read,
      has_table_privilege('authenticated',c.oid,'insert') as user_write,
      has_table_privilege('service_role',c.oid,'update') as service_write
      from pg_class c where c.relkind='r' and c.relname like 'openchat_%' order by c.relname`)).rows;
    const beforeFunctions = await functions(), beforeSecurity = await security();
    await db.exec(await migration(DELTA_MIGRATION));
    const deltaFunctions = await functions();
    await db.exec(await migration(PAYLOAD_MIGRATION));
    const afterFunctions = await functions();
    assert.equal(afterFunctions.length, deltaFunctions.length);
    for (const before of deltaFunctions) {
      const after = afterFunctions.find(row => row.signature === before.signature);
      if (before.signature !== "save_openchat_program_matches(uuid,date,text,jsonb)") assert.deepEqual(after, before);
      else {
        assert.equal(after.acl, before.acl);
        assert.equal(after.prosecdef, before.prosecdef);
        assert.deepEqual(after.proconfig, before.proconfig);
      }
    }
    assert.equal(afterFunctions.length, beforeFunctions.length);
    const changed = new Set(["save_openchat_program_matches(uuid,date,text,jsonb)",
      "list_openchat_requirement_work(date,integer,uuid[],boolean)", "openchat_review_queue_status(date,boolean)"]);
    for (const before of beforeFunctions) {
      const after = afterFunctions.find(row => row.signature === before.signature);
      assert.ok(after);
      if (!changed.has(before.signature)) assert.deepEqual(after, before);
      else {
        assert.equal(after.acl, before.acl);
        assert.equal(after.prosecdef, false);
        assert.deepEqual(after.proconfig, before.proconfig);
      }
    }
    assert.deepEqual(await security(), beforeSecurity);
    const columns = (await db.query(`select column_name,is_nullable,column_default from information_schema.columns
      where table_schema='public' and table_name='openchat_program_requirements'
      and column_name in ('matched_normalization_version','matched_review_date','matched_source_checked_at') order by column_name`)).rows;
    assert.deepEqual(columns, [
      { column_name: "matched_normalization_version", is_nullable: "NO", column_default: "0" },
      { column_name: "matched_review_date", is_nullable: "YES", column_default: null },
      { column_name: "matched_source_checked_at", is_nullable: "YES", column_default: null },
    ]);
    await db.exec(`create table public.fixture_programs as select gen_random_uuid() as id,n from generate_series(1,56) n;
      grant select on public.fixture_programs to service_role;
      insert into public.openchat_programs(id,status,deadline_at)
        select id,case when n=56 then 'excluded' else 'review_required' end,
          case when n=55 then now()-interval '1 day' else now()+interval '10 days' end from public.fixture_programs;
      insert into public.openchat_program_attachments(program_id,file_name,file_ext,source_url,text_status,text_content,created_at,extracted_at)
        select id,'notice.pdf','pdf','https://public-fixture.example/notice','extracted','[p.1] fixture',
          now()-interval '2 hours',now()-interval '1 hour' from public.fixture_programs;
      insert into public.openchat_program_requirements(program_id,input_hash,status,normalization_version,source_checked_at,updated_at)
        select id,'unchanged-hash','extracted',3,now(),now() from public.fixture_programs;
      insert into public.openchat_program_requirement_attempts(program_id,input_hash,response_text)
        select id,'unchanged-hash','immutable provider artifact' from public.fixture_programs;`);
    await db.query(`insert into public.openchat_program_matches(program_id,target_kind,target_id,target_name,verdict,reasons,score,review_date)
      select f.id,case when t=1 then 'self' else 'customer' end,'fixture-'||t,'Public fixture',
        case when t=469 then 'mismatch' else 'candidate' end,'[]',f.n,$1::date
      from public.fixture_programs f cross join generate_series(1,469) t`, [day]);
    const target = (await db.query("select id from public.fixture_programs where n=1")).rows[0].id;
    await db.query(`update openchat_program_requirements set matched_normalization_version=normalization_version,
      matched_review_date=$1::date,matched_source_checked_at=source_checked_at where program_id<>$2`, [day, target]);
    await db.query(`insert into public.openchat_program_matches(program_id,target_kind,target_id,target_name,verdict,reasons,score,review_date,selected_for_reading)
      values($1,'self','previous-day','Previous day fixture','candidate','[]',500,$2::date-1,true)`, [target, day]);
    assert.equal((await db.query("select count(*)::int as n from public.openchat_program_matches where review_date=$1", [day])).rows[0].n, 56 * 469);
    await db.exec(`create sequence public.fixture_selection_write_count minvalue 0 start 0;
      grant usage,select,update on sequence public.fixture_selection_write_count to service_role;
      create function public.fixture_count_selection_write() returns trigger language plpgsql as $$
        begin perform nextval('public.fixture_selection_write_count'); return new; end; $$;
      create trigger fixture_selection_write after update of selected_for_reading on public.openchat_program_matches
        for each row execute function public.fixture_count_selection_write();
      create sequence public.fixture_payload_write_count minvalue 0 start 0;
      grant usage,select,update on sequence public.fixture_payload_write_count to service_role;
      create function public.fixture_count_payload_write() returns trigger language plpgsql as $$
        begin perform nextval('public.fixture_payload_write_count'); return new; end; $$;
      create trigger fixture_payload_write after update of target_name,verdict,reasons,score on public.openchat_program_matches
        for each row execute function public.fixture_count_payload_write();`);
    const writes = async () => (await db.query(`select case when is_called then last_value+1 else 0 end::int as n
      from public.fixture_selection_write_count`)).rows[0].n;
    const payloadWrites = async () => (await db.query(`select case when is_called then last_value+1 else 0 end::int as n
      from public.fixture_payload_write_count`)).rows[0].n;
    const reasonSentence = "공개 근거 확인 필요: 조건별 신청자격과 첨부 원문을 담당자가 검토해야 합니다. ";
    const longReason = reasonSentence.repeat(Math.ceil(3000 / Buffer.byteLength(reasonSentence)));
    assert.ok(Buffer.byteLength(longReason) >= 3000);
    const payload = async (score = 1) => Array.from({ length: 469 }, (_, index) => ({
      targetKind: index === 0 ? "self" : "customer", targetId: `fixture-${index + 1}`, targetName: "Public fixture",
      verdict: index === 468 ? "mismatch" : "candidate", reasons: [longReason, `공개 검증 대상 ${index + 1}`], score,
    }));
    const save = async (matches, hash = "unchanged-hash") => db.query(
      "select save_openchat_program_matches($1,$2::date,$3,$4::jsonb)", [target, day, hash, JSON.stringify(matches)]);
    const work = async (scope = [target], reviewDay = day) => (await db.query(
      "select id from list_openchat_requirement_work($1::date,100,$2::uuid[],true)", [reviewDay, scope])).rows.map(row => row.id);
    const counts = async () => (await db.query("select openchat_review_queue_status($1::date,true) as counts", [day])).rows[0].counts;
    const marker = async () => (await db.query(`select matched_normalization_version as version,matched_review_date::text as day,
      matched_source_checked_at is not distinct from source_checked_at as source_matches
      from openchat_program_requirements where program_id=$1`, [target])).rows[0];
    const artifacts = async () => (await db.query(`select * from openchat_program_requirement_attempts order by program_id`)).rows;
    const originalArtifacts = await artifacts();
    const storedPayload = async () => (await db.query(`select target_kind as "targetKind",target_id as "targetId",
      target_name as "targetName",verdict,reasons,score::float as score from openchat_program_matches
      where program_id=$1 and review_date=$2 order by split_part(target_id,'-',2)::int`, [target, day])).rows;
    await db.exec("set role service_role");
    assert.deepEqual(await work(), [target]);
    assert.equal((await counts()).ready, 1);
    const firstPayload = await payload();
    assert.ok(Buffer.byteLength(JSON.stringify(firstPayload)) >= 1_400_000, "exercise the production-sized Korean reasons payload");
    await save(firstPayload);
    assert.equal(await writes(), 8 * 468);
    assert.equal(await payloadWrites(), 469);
    assert.deepEqual(await storedPayload(), firstPayload);
    const selected = (await db.query(`select f.n,count(*)::int as rows from openchat_program_matches m
      join fixture_programs f on f.id=m.program_id where review_date=$1 and selected_for_reading
      group by f.n order by f.n`, [day])).rows;
    assert.deepEqual(selected, Array.from({ length: 8 }, (_, index) => ({ n: 47 + index, rows: 468 })));
    assert.equal((await db.query(`select count(*)::int as n from openchat_program_matches
      where selected_for_reading and verdict='mismatch'`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from openchat_program_matches
      where review_date=$1::date-1 and selected_for_reading`, [day])).rows[0].n, 1);
    assert.deepEqual(await marker(), { version: 3, day, source_matches: true });
    assert.deepEqual(await work(), []);
    assert.equal((await counts()).ready, 0);
    await db.query("select setval('public.fixture_selection_write_count',0,false)");
    await db.query("select setval('public.fixture_payload_write_count',0,false)");
    await save(firstPayload);
    assert.equal(await writes(), 0, "identical ranking must not rewrite the 26,264 daily flags");
    assert.equal(await payloadWrites(), 0, "identical 1.4MB payload must not rewrite its 469 target rows");
    const oneFieldChanged = structuredClone(firstPayload);
    oneFieldChanged[0].targetName = "공개 검증 이름 변경";
    await save(oneFieldChanged);
    assert.equal(await payloadWrites(), 1, "a single name change updates exactly one target");
    assert.deepEqual(await storedPayload(), oneFieldChanged);
    await save(firstPayload);
    assert.equal(await payloadWrites(), 2);
    assert.equal(await writes(), 0);
    const replaced = [...firstPayload.slice(0, -1), { ...firstPayload.at(-1), targetId: "fixture-470" }];
    await save(replaced);
    assert.deepEqual(await storedPayload(), replaced, "remove the obsolete target and insert the new target without dropping retained rows");
    await save(firstPayload);
    assert.deepEqual(await storedPayload(), firstPayload);
    assert.equal(await writes(), 0);
    await assert.rejects(save(firstPayload, "stale-hash"), /Stale requirements/);
    assert.equal(await writes(), 0);

    // Simulate the exact interruption: canonical v3 is durable, old daily matches
    // remain, and the RPC fails at its final completion marker. The entire match
    // replacement and selection must roll back, while the queue still sees work.
    await db.exec("reset role");
    await db.query(`update openchat_program_requirements set matched_normalization_version=2,matched_review_date=$2::date
      where program_id=$1`, [target, day]);
    await db.exec(`create function public.fixture_fail_match_marker() returns trigger language plpgsql as $$
      begin raise exception 'fixture completion marker interrupted'; end; $$;
      create trigger fixture_match_interruption before update of matched_normalization_version on public.openchat_program_requirements
        for each row execute function public.fixture_fail_match_marker();`);
    const snapshot = async () => (await db.query(`select md5(string_agg(program_id::text||target_kind||target_id||score::text||selected_for_reading::text,
      ',' order by program_id,target_kind,target_id)) as digest from openchat_program_matches where review_date=$1`, [day])).rows[0].digest;
    const oldSnapshot = await snapshot();
    await db.exec("set role service_role");
    assert.deepEqual(await work(), [target]);
    assert.equal((await counts()).ready, 1);
    await assert.rejects(save(await payload(999)), /fixture completion marker interrupted/);
    assert.equal(await snapshot(), oldSnapshot);
    assert.deepEqual(await marker(), { version: 2, day, source_matches: true });
    assert.deepEqual(await work(), [target], "existing same-day rows cannot conceal interrupted normalization matching");
    await db.exec("reset role; drop trigger fixture_match_interruption on public.openchat_program_requirements; set role service_role");
    await save(await payload(999));
    assert.deepEqual(await marker(), { version: 3, day, source_matches: true });
    assert.deepEqual(await work(), []);
    assert.equal((await counts()).ready, 0);

    // Completeness/source metadata can advance with the exact same text hash,
    // normalization version and date. A separate source checkpoint is necessary
    // to distinguish these old matches from the refreshed canonical snapshot.
    await db.exec("reset role");
    await db.query(`update openchat_program_requirements set source_checked_at=source_checked_at+interval '1 minute'
      where program_id=$1`, [target]);
    await db.exec(`create trigger fixture_match_interruption before update of matched_normalization_version on public.openchat_program_requirements
      for each row execute function public.fixture_fail_match_marker(); set role service_role`);
    assert.deepEqual(await marker(), { version: 3, day, source_matches: false });
    assert.deepEqual(await work(), [target]);
    assert.equal((await counts()).ready, 1);
    const sourceSnapshot = await snapshot();
    await assert.rejects(save(await payload(777)), /fixture completion marker interrupted/);
    assert.equal(await snapshot(), sourceSnapshot);
    assert.deepEqual(await marker(), { version: 3, day, source_matches: false });
    assert.deepEqual(await work(), [target]);
    assert.equal((await counts()).ready, 1);
    await db.exec("reset role; drop trigger fixture_match_interruption on public.openchat_program_requirements; set role service_role");
    await save(await payload(777));
    assert.deepEqual(await marker(), { version: 3, day, source_matches: true });
    assert.deepEqual(await work(), []);
    assert.equal((await counts()).ready, 0);
    const nextDay = (await db.query("select ($1::date+1)::text as day", [day])).rows[0].day;
    assert.deepEqual(await work([target], nextDay), [target]);
    assert.deepEqual(await artifacts(), originalArtifacts);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_requirement_recoveries")).rows[0].n, 0);
    await db.exec("reset role; set role anon");
    await assert.rejects(save(firstPayload), /permission denied/);
    await assert.rejects(db.query("select * from list_openchat_requirement_work($1::date,100,null,true)", [day]), /permission denied/);
    await assert.rejects(db.query("select openchat_review_queue_status($1::date,true)", [day]), /permission denied/);
  } finally { await db.close(); }
});
