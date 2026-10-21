import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const VERSION_MIGRATION = "20261021051857_openchat_requirement_normalization_version.sql";
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
  for (const name of ["20261020122223_openchat_program_attachments.sql", "20261021032454_openchat_program_requirements.sql",
    "20261021042817_openchat_program_review_batches.sql"]) await db.exec(await migration(name));
  const day = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
  return { db, day };
}
async function addProgram(db, { result, matched = false, deadline = "now()+interval '10 days'", excluded = false } = {}) {
  const id = (await db.query(`insert into openchat_programs(status,deadline_at,created_at)
    values($1,${deadline},now()-interval '2 days') returning id`, [excluded ? "excluded" : "published"])).rows[0].id;
  await db.query(`insert into openchat_program_attachments(program_id,file_name,file_ext,source_url,text_status,text_content,created_at,extracted_at)
    values($1,'public.pdf','pdf','https://public-fixture.example/document','extracted','[p.1] Public fixture',now()-interval '2 hours',now()-interval '1 hour')`, [id]);
  if (result) {
    await db.query(`insert into openchat_program_requirements(program_id,input_hash,status,source_checked_at,updated_at)
      values($1,'public-fixture-hash',$2,now(),now())`, [id, result]);
  }
  if (matched) {
    await db.query(`insert into openchat_program_matches(program_id,target_kind,target_id,target_name,verdict,reasons,review_date)
      values($1,'self','public-fixture','Public fixture','unknown','[]',(now() at time zone 'Asia/Seoul')::date)`, [id]);
  }
  return id;
}

test("all thirteen old successful results become local normalization work before new paid work, then version two clears the due state", async () => {
  const { db, day } = await database();
  try {
    const old = [];
    for (let index = 0; index < 13; index++) old.push(await addProgram(db, {
      result: "extracted", matched: true, excluded: index % 2 === 0,
      deadline: index === 12 ? "null" : `now()+interval '${10 + index} days'`,
    }));
    const fresh = [await addProgram(db, { deadline: "now()+interval '1 day'" }),
      await addProgram(db, { deadline: "now()+interval '2 days'" })];
    const failed = await addProgram(db, { result: "failed" });
    const processing = await addProgram(db, { result: "processing" });
    await db.exec(await migration(VERSION_MIGRATION));
    assert.equal((await db.query("select count(*)::int as n from openchat_program_requirements where status='extracted' and normalization_version=1")).rows[0].n, 13);
    await db.exec("set role service_role");
    const work = async (limit = 100, include = true) => (await db.query(
      "select id from list_openchat_requirement_work($1::date,$2,null::uuid[],$3)", [day, limit, include])).rows.map(row => row.id);
    const queue = async () => (await db.query("select openchat_review_queue_status($1::date,true) as counts", [day])).rows[0].counts;
    const initial = await work();
    assert.equal(initial.length, 15);
    assert.deepEqual(new Set(initial.slice(0, 13)), new Set(old));
    assert.deepEqual(new Set(initial.slice(13)), new Set(fresh));
    assert.deepEqual(new Set(await work(13)), new Set(old));
    assert.ok(!initial.includes(failed) && !initial.includes(processing));
    assert.equal((await queue()).ready, 15);
    assert.equal((await queue()).remaining, 17);
    const nonexcluded = await work(100, false);
    assert.ok(nonexcluded.every(id => !old.filter((_, index) => index % 2 === 0).includes(id)));
    await db.query("update openchat_program_requirements set normalization_version=2 where program_id=any($1::uuid[])", [old]);
    assert.deepEqual(new Set(await work()), new Set(fresh));
    assert.equal((await queue()).ready, 2);
    assert.equal((await queue()).remaining, 4);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_requirement_attempts")).rows[0].n, 0);
    assert.equal((await db.query("select status from openchat_program_requirements where program_id=$1", [failed])).rows[0].status, "failed");
  } finally { await db.close(); }
});

test("normalization migration preserves original callers, invoker permissions and source/match freshness gates", async () => {
  const { db, day } = await database();
  try {
    const legacySql = "select pg_get_functiondef('list_openchat_requirement_work(date,integer,uuid[])'::regprocedure) as work,pg_get_functiondef('claim_openchat_requirement(uuid,text)'::regprocedure) as claim";
    const original = (await db.query(legacySql)).rows[0];
    const noMatch = await addProgram(db, { result: "extracted" });
    const changed = await addProgram(db, { result: "extracted", matched: true });
    const expired = await addProgram(db, { result: "extracted", matched: true, deadline: "now()-interval '1 day'" });
    await db.exec(await migration(VERSION_MIGRATION));
    assert.deepEqual((await db.query(legacySql)).rows[0], original);
    await db.query("update openchat_program_requirements set normalization_version=2 where program_id=any($1::uuid[])", [[noMatch, changed]]);
    await db.query("update openchat_program_requirements set source_checked_at=now()-interval '3 hours' where program_id=$1", [changed]);
    await assert.rejects(db.query("update openchat_program_requirements set normalization_version=null where program_id=$1", [changed]), /not-null/);
    const permissions = (await db.query(`select p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') as anon_execute,
      has_function_privilege('authenticated',p.oid,'execute') as user_execute,
      has_function_privilege('service_role',p.oid,'execute') as service_execute
      from pg_proc p where p.oid in ('list_openchat_requirement_work(date,integer,uuid[],boolean)'::regprocedure,
        'openchat_review_queue_status(date,boolean)'::regprocedure)`)).rows;
    assert.equal(permissions.length, 2);
    for (const p of permissions) {
      assert.equal(p.prosecdef, false); assert.equal(p.anon_execute, false); assert.equal(p.user_execute, false);
      assert.equal(p.service_execute, true); assert.ok(p.proconfig.some(value => value.startsWith("search_path=")));
    }
    await db.exec("set role service_role");
    const work = (await db.query("select id from list_openchat_requirement_work($1::date,100,null::uuid[],true)", [day])).rows.map(row => row.id);
    assert.deepEqual(new Set(work), new Set([noMatch, changed]));
    assert.ok(!work.includes(expired));
    await db.exec("set role anon");
    await assert.rejects(db.query("select openchat_review_queue_status($1::date,true)", [day]), /permission denied/);
  } finally { await db.close(); }
});
