import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table public.openchat_programs(id uuid primary key default gen_random_uuid(),status text not null default 'review_required',
      deadline_at timestamptz,created_at timestamptz not null default now());
    grant usage on schema public to anon,authenticated,service_role;
    grant select on public.openchat_programs to service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  await db.exec(await migration("20261020122223_openchat_program_attachments.sql"));
  await db.exec(await migration("20261021032454_openchat_program_requirements.sql"));
  const before = (await db.query(`select
    pg_get_functiondef('public.claim_openchat_attachment(uuid)'::regprocedure) as attachment,
    pg_get_functiondef('public.list_openchat_requirement_work(date,integer,uuid[])'::regprocedure) as work`)).rows[0];
  await db.exec(await migration("20261021042817_openchat_program_review_batches.sql"));
  const day = (await db.query(`select (now() at time zone 'Asia/Seoul')::date::text as day`)).rows[0].day;
  return { db, day, before };
}
async function program(db, { status = "review_required", deadline = "now()+interval '10 days'", created = "now()" } = {}) {
  return (await db.query(`insert into openchat_programs(status,deadline_at,created_at) values($1,${deadline},${created}) returning id`, [status])).rows[0].id;
}
async function document(db, id, { status = "extracted", text = "공고문 본문", attempts = 0 } = {}) {
  return (await db.query(`insert into openchat_program_attachments(program_id,file_name,file_ext,source_url,text_status,text_content,attempts,created_at,extracted_at)
    values($1,'공고.pdf','pdf','https://public-fixture.example/doc',$2,$3,$4,now()-interval '2 hours',now()-interval '1 hour') returning id`,
  [id, status, text, attempts])).rows[0].id;
}
async function failedRequirement(db, id, hash = "fixture-hash") {
  await db.query(`insert into openchat_program_requirements(program_id,input_hash,status) values($1,$2,'failed')`, [id, hash]);
  await db.query(`insert into openchat_program_requirement_attempts(program_id,input_hash) values($1,$2)`, [id, hash]);
}

test("batch migration keeps new tables and all seven RPCs service-only and preserves deployed original RPC definitions", async () => {
  const { db, before } = await database();
  try {
    const rows = (await db.query(`select c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anon_read,
      has_table_privilege('authenticated',c.oid,'insert') as user_write,
      has_table_privilege('service_role',c.oid,'insert') as service_write
      from pg_class c where c.relname in ('openchat_program_requirement_recoveries','openchat_program_review_jobs')`)).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) assert.deepEqual(row, { rls: true, anon_read: false, user_write: false, service_write: true });
    const functions = (await db.query(`select p.proname,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') as anon_execute,
      has_function_privilege('authenticated',p.oid,'execute') as user_execute,
      has_function_privilege('service_role',p.oid,'execute') as service_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.oid in
      ('claim_openchat_program_review_job(uuid,text)'::regprocedure,
       'finish_openchat_program_review_job(uuid,uuid,text,jsonb,text)'::regprocedure,
       'claim_openchat_requirement_recovery(uuid,text)'::regprocedure,
       'claim_openchat_review_attachment(uuid)'::regprocedure,
       'list_openchat_requirement_work(date,integer,uuid[],boolean)'::regprocedure,
       'openchat_review_queue_status(date,boolean)'::regprocedure,
       'release_openchat_requirement_recovery_budget(uuid)'::regprocedure)`)).rows;
    assert.equal(functions.length, 7);
    for (const row of functions) {
      assert.equal(row.prosecdef, false); assert.equal(row.anon_execute, false); assert.equal(row.user_execute, false);
      assert.equal(row.service_execute, true); assert.ok(row.proconfig.some(value => value.startsWith("search_path=")));
    }
    const after = (await db.query(`select
      pg_get_functiondef('public.claim_openchat_attachment(uuid)'::regprocedure) as attachment,
      pg_get_functiondef('public.list_openchat_requirement_work(date,integer,uuid[])'::regprocedure) as work`)).rows[0];
    assert.deepEqual(after, before);
    await db.exec("set role anon");
    await assert.rejects(db.query("select claim_openchat_program_review_job($1,'requirements')", [OWNER]), /permission denied/);
    await assert.rejects(db.query("select * from openchat_program_review_jobs"), /permission denied/);
  } finally { await db.close(); }
});

test("attachments and requirements contend for one global lease, with owner-only and one-time completion", async () => {
  const { db } = await database();
  try {
    await db.exec("set role service_role");
    const responses = await Promise.all([
      db.query("select claim_openchat_program_review_job($1,'requirements') as id", [OWNER]),
      db.query("select claim_openchat_program_review_job($1,'attachments') as id", [OTHER]),
    ]);
    const ids = responses.map(response => response.rows[0].id);
    assert.equal(ids.filter(Boolean).length, 1);
    const index = ids.findIndex(Boolean), owner = index === 0 ? OWNER : OTHER, wrong = index === 0 ? OTHER : OWNER;
    const finish = async who => (await db.query("select finish_openchat_program_review_job($1,$2,'completed','{\"extracted\":2}',null) as ok", [ids[index], who])).rows[0].ok;
    assert.equal(await finish(wrong), false); assert.equal(await finish(owner), true); assert.equal(await finish(owner), false);
    const next = (await db.query("select claim_openchat_program_review_job($1,'attachments') as id", [wrong])).rows[0].id;
    assert.ok(next); assert.notEqual(next, ids[index]);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_review_jobs where status='running'")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("an expired owner cannot finish and the next claim marks the old lease interrupted before taking over", async () => {
  const { db } = await database();
  try {
    await db.exec("set role service_role");
    const first = (await db.query("select claim_openchat_program_review_job($1,'requirements') as id", [OWNER])).rows[0].id;
    await db.query("update openchat_program_review_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first]);
    assert.equal((await db.query("select finish_openchat_program_review_job($1,$2,'completed','{}',null) as ok", [first, OWNER])).rows[0].ok, false);
    const second = (await db.query("select claim_openchat_program_review_job($1,'attachments') as id", [OTHER])).rows[0].id;
    assert.ok(second);
    const old = (await db.query("select status,finished_at is not null as finished from openchat_program_review_jobs where id=$1", [first])).rows[0];
    assert.deepEqual(old, { status: "interrupted", finished: true });
    assert.equal((await db.query("select count(*)::int as n from openchat_program_review_jobs where status='running'")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("job finish rejects null or oversized summaries, arbitrary error text and nonterminal statuses", async () => {
  const { db } = await database();
  try {
    await db.exec("set role service_role");
    await assert.rejects(db.query("select claim_openchat_program_review_job($1,'not-a-task')", [OWNER]), /Invalid review job/);
    const id = (await db.query("select claim_openchat_program_review_job($1,'requirements') as id", [OWNER])).rows[0].id;
    for (const status of ["running", "interrupted", "not-a-status", null]) {
      await assert.rejects(db.query("select finish_openchat_program_review_job($1,$2,$3,'{}',null)", [id, OWNER, status]), /Invalid review summary/);
    }
    for (const summary of [null, "null", "[]", JSON.stringify({ padding: "x".repeat(33_000) })]) {
      await assert.rejects(db.query("select finish_openchat_program_review_job($1,$2,'completed',$3::jsonb,null)", [id, OWNER, summary]), /Invalid review summary/);
    }
    await assert.rejects(db.query("select finish_openchat_program_review_job($1,$2,'failed','{}','provider raw message')", [id, OWNER]), /Invalid review summary/);
    assert.equal((await db.query("select finish_openchat_program_review_job($1,$2,'failed','{}','REVIEW_JOB_FAILED') as ok", [id, OWNER])).rows[0].ok, true);
  } finally { await db.close(); }
});

test("one explicit recovery per input hash preserves the original attempt and cannot be released after a response", async () => {
  const { db, day } = await database();
  try {
    const id = await program(db, { status: "excluded" }); await failedRequirement(db, id);
    await db.query(`insert into openchat_program_matches(program_id,target_kind,target_id,target_name,verdict,reasons,review_date)
      values($1,'self','fixture','공개 시험 대상','unknown','[]',$2::date)`, [id, day]);
    await db.exec("set role service_role");
    const claim = async hash => (await db.query("select claim_openchat_requirement_recovery($1,$2) as id", [id, hash])).rows[0].id;
    assert.equal(await claim("wrong-hash"), null);
    const recovery = await claim("fixture-hash"); assert.ok(recovery); assert.equal(await claim("fixture-hash"), null);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_matches where program_id=$1", [id])).rows[0].n, 0);
    await db.query("update openchat_program_requirement_recoveries set responded_at=now(),response_text='public fixture response' where id=$1", [recovery]);
    await db.query("update openchat_program_requirements set status='failed' where program_id=$1", [id]);
    assert.equal(await claim("fixture-hash"), null);
    await db.query("select release_openchat_requirement_recovery_budget($1)", [recovery]);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_requirement_recoveries where program_id=$1", [id])).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_requirement_attempts where program_id=$1", [id])).rows[0].n, 1);
    assert.equal((await db.query("select status from openchat_programs where id=$1", [id])).rows[0].status, "excluded");
  } finally { await db.close(); }
});

test("a recovery deferred before the model call releases only that reservation and can resume once", async () => {
  const { db } = await database();
  try {
    const id = await program(db); await failedRequirement(db, id);
    await db.exec("set role service_role");
    const claim = async () => (await db.query("select claim_openchat_requirement_recovery($1,'fixture-hash') as id", [id])).rows[0].id;
    const first = await claim(); assert.ok(first);
    await db.query("select release_openchat_requirement_recovery_budget($1)", [first]);
    const row = (await db.query("select status,diagnostics->>'code' as code from openchat_program_requirements where program_id=$1", [id])).rows[0];
    assert.deepEqual(row, { status: "failed", code: "RECOVERY_DEFERRED" });
    assert.equal((await db.query("select count(*)::int as n from openchat_program_requirement_recoveries")).rows[0].n, 0);
    const second = await claim(); assert.ok(second); assert.notEqual(second, first);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_requirement_attempts where program_id=$1", [id])).rows[0].n, 1);
  } finally { await db.close(); }
});

test("recovery ignores successful, expired or older-than-60-day notices", async () => {
  const { db } = await database();
  try {
    const expired = await program(db, { deadline: "now()-interval '1 day'" }); await failedRequirement(db, expired);
    const old = await program(db, { created: "now()-interval '61 days'" }); await failedRequirement(db, old);
    const completed = await program(db); await failedRequirement(db, completed);
    await db.query("update openchat_program_requirements set status='extracted' where program_id=$1", [completed]);
    await db.exec("set role service_role");
    for (const id of [expired, old, completed]) {
      assert.equal((await db.query("select claim_openchat_requirement_recovery($1,'fixture-hash') as id", [id])).rows[0].id, null);
    }
  } finally { await db.close(); }
});

test("manual attachment claims include excluded future notices but retain claim, age and attempt limits", async () => {
  const { db } = await database();
  try {
    const id = await program(db, { status: "excluded" }), attachment = await document(db, id, { status: "pending", text: null });
    const expired = await program(db, { deadline: "now()-interval '1 day'" });
    const expiredAttachment = await document(db, expired, { status: "pending", text: null });
    const old = await program(db, { created: "now()-interval '61 days'" });
    const oldAttachment = await document(db, old, { status: "pending", text: null });
    await db.exec("set role service_role");
    assert.equal((await db.query("select * from claim_openchat_attachment($1)", [attachment])).rows.length, 0);
    const first = (await db.query("select * from claim_openchat_review_attachment($1)", [attachment])).rows;
    assert.equal(first.length, 1); assert.equal(first[0].attempts, 1);
    assert.equal((await db.query("select * from claim_openchat_review_attachment($1)", [attachment])).rows.length, 0);
    for (const invalid of [expiredAttachment, oldAttachment]) {
      assert.equal((await db.query("select * from claim_openchat_review_attachment($1)", [invalid])).rows.length, 0);
    }
    for (const expected of [2, 3]) {
      await db.query("update openchat_program_attachments set processing_started_at=now()-interval '11 minutes' where id=$1", [attachment]);
      assert.equal((await db.query("select attempts from claim_openchat_review_attachment($1)", [attachment])).rows[0].attempts, expected);
    }
    await db.query("update openchat_program_attachments set processing_started_at=null where id=$1", [attachment]);
    assert.equal((await db.query("select * from claim_openchat_review_attachment($1)", [attachment])).rows.length, 0);
    assert.equal((await db.query("select status from openchat_programs where id=$1", [id])).rows[0].status, "excluded");
  } finally { await db.close(); }
});

test("four-argument work scope prefers real future deadlines, leaves null deadlines last and keeps old callers unchanged", async () => {
  const { db, day } = await database();
  try {
    const ids = {
      soon: await program(db, { deadline: "now()+interval '1 day'", created: "now()-interval '3 days'" }),
      excluded: await program(db, { status: "excluded", deadline: "now()+interval '2 days'" }),
      later: await program(db, { deadline: "now()+interval '10 days'" }),
      unknown: await program(db, { deadline: "null" }),
      expired: await program(db, { deadline: "now()-interval '1 day'" }),
      old: await program(db, { created: "now()-interval '61 days'" }),
      waiting: await program(db),
    };
    for (const [key, id] of Object.entries(ids)) if (key !== "waiting") await document(db, id);
    await db.exec("set role service_role");
    const work = async (include, scope = null, limit = 80) => (await db.query("select id from list_openchat_requirement_work($1::date,$2,$3::uuid[],$4)", [day, limit, scope, include])).rows.map(row => row.id);
    assert.deepEqual(await work(false), [ids.soon, ids.later, ids.unknown]);
    assert.deepEqual(await work(true), [ids.soon, ids.excluded, ids.later, ids.unknown]);
    assert.deepEqual(await work(true, [ids.unknown, ids.excluded]), [ids.excluded, ids.unknown]);
    assert.deepEqual(await work(false, [ids.unknown, ids.excluded]), [ids.unknown]);
    assert.deepEqual(await work(true, null, 2), [ids.soon, ids.excluded]);
    const legacy = (await db.query("select id from list_openchat_requirement_work($1::date,80,null)", [day])).rows.map(row => row.id);
    assert.ok(!legacy.includes(ids.excluded));
    const queue = (await db.query("select openchat_review_queue_status($1::date,false) as counts", [day])).rows[0].counts;
    assert.equal(queue.eligible, 4); assert.equal(queue.withText, 3); assert.equal(queue.waitingAttachments, 1);
    assert.equal(queue.ready, 3); assert.equal(queue.remaining, 4);
    const manual = (await db.query("select openchat_review_queue_status($1::date,true) as counts", [day])).rows[0].counts;
    assert.equal(manual.eligible, 5); assert.equal(manual.withText, 4);
    await db.query(`insert into openchat_program_requirements(program_id,input_hash,status,updated_at)
      values($1,'stale','extracted',now()-interval '3 hours')`, [ids.soon]);
    const stale = (await db.query("select openchat_review_queue_status($1::date,false) as counts", [day])).rows[0].counts;
    assert.equal(stale.requirementsExtracted, 1); assert.equal(stale.ready, 3); assert.equal(stale.remaining, 4);
  } finally { await db.close(); }
});

test("source snapshots reveal changes made during generation even when the saved result timestamp is newer", async () => {
  const { db, day } = await database();
  try {
    const id = await program(db); await document(db, id);
    await db.query(`insert into openchat_program_attachment_discovery(program_id,status,attachment_count,detail_text,checked_at)
      values($1,'found',1,'공개 검증 원문',now()-interval '30 minutes')`, [id]);
    await db.query(`insert into openchat_program_requirements(program_id,input_hash,status,updated_at,source_checked_at)
      values($1,'before-change','extracted',now(),now()-interval '2 hours')`, [id]);
    await db.query(`insert into openchat_program_matches(program_id,target_kind,target_id,target_name,verdict,reasons,review_date)
      values($1,'self','fixture','공개 시험 대상','unknown','[]',$2::date)`, [id, day]);
    await db.exec("set role service_role");
    assert.deepEqual((await db.query("select id from list_openchat_requirement_work($1::date,80,null,false)", [day])).rows.map(row => row.id), [id]);
    const stale = (await db.query("select openchat_review_queue_status($1::date,false) as counts", [day])).rows[0].counts;
    assert.equal(stale.ready, 1); assert.equal(stale.remaining, 1);
    // The deployed three-argument definition remains unchanged during staging compatibility.
    assert.equal((await db.query("select id from list_openchat_requirement_work($1::date,80,null)", [day])).rows.length, 0);
    await db.query("update openchat_program_requirements set source_checked_at=now() where program_id=$1", [id]);
    assert.equal((await db.query("select id from list_openchat_requirement_work($1::date,80,null,false)", [day])).rows.length, 0);
    const current = (await db.query("select openchat_review_queue_status($1::date,false) as counts", [day])).rows[0].counts;
    assert.equal(current.ready, 0); assert.equal(current.remaining, 0);
  } finally { await db.close(); }
});
