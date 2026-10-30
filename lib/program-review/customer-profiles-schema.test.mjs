import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

/**
 * 고객사 요건 표를 **실제로 만들어 보고** 확인한다.
 *
 * 운영 Supabase 에는 사람이 직접 적용한다. 그 전에 여기서 돌려 보지 않으면
 * 틀린 SQL 을 운영에 들고 가게 된다.
 */
const MIGRATIONS = [
  "20261020122223_openchat_program_attachments.sql",
  "20261021032454_openchat_program_requirements.sql",
  "20261021042817_openchat_program_review_batches.sql",
  "20261021051857_openchat_requirement_normalization_version.sql",
  "20261021060019_openchat_requirement_normalization_v3.sql",
  "20261021062847_openchat_match_selection_delta.sql",
  "20261021063654_openchat_match_payload_materialization.sql",
  "20261021094429_openchat_program_agent_api.sql",
  "20261030090000_openchat_program_customer_profiles.sql",
];

async function 만든다() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table public.openchat_programs(id uuid primary key default gen_random_uuid(),status text not null default 'review_required',
      deadline_at timestamptz,created_at timestamptz not null default now());
    grant usage on schema public to anon,authenticated,service_role; grant select on public.openchat_programs to service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  for (const name of MIGRATIONS) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  return db;
}

const 넣기 = `insert into openchat_program_customer_profiles(customer_id,entity_key,entity_name,profile)
  values($1,$2,$3,$4) returning id,version`;

test("고객사 요건 표는 비공개이고, 지우지 못하고, 고치기만 된다", async () => {
  const db = await 만든다();
  try {
    const [row] = (await db.query(`select c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anon_read,
      has_table_privilege('authenticated',c.oid,'select') as user_read,
      has_table_privilege('authenticated',c.oid,'insert') as user_write,
      has_table_privilege('service_role',c.oid,'insert') as service_insert,
      has_table_privilege('service_role',c.oid,'update') as service_update,
      has_table_privilege('service_role',c.oid,'delete') as service_delete
      from pg_class c where c.relname='openchat_program_customer_profiles'`)).rows;
    assert.equal(row.rls, true);
    assert.equal(row.anon_read, false, "로그인 안 한 사람이 고객 자료를 읽으면 안 된다");
    assert.equal(row.user_read, false, "로그인했다고 읽을 수 있으면 안 된다");
    assert.equal(row.user_write, false);
    assert.equal(row.service_insert, true);
    assert.equal(row.service_update, true);
    assert.equal(row.service_delete, false, "지우지 않는다 — 뺄 사업자는 active=false 로 끈다");

    const funcs = (await db.query(`select p.proname,p.prosecdef,
      has_function_privilege('anon',p.oid,'execute') as anon_exec,
      has_function_privilege('authenticated',p.oid,'execute') as user_exec,
      has_function_privilege('service_role',p.oid,'execute') as service_exec
      from pg_proc p where p.proname in ('stamp_openchat_customer_profile_version',
      'bump_openchat_customer_profile_context')`)).rows;
    assert.equal(funcs.length, 2);
    for (const fn of funcs) {
      assert.deepEqual({ definer: fn.prosecdef, anon: fn.anon_exec, user: fn.user_exec, service: fn.service_exec },
        { definer: false, anon: false, user: false, service: true });
    }
  } finally { await db.close(); }
});

test("값의 모양은 자사 프로필과 같은 검사를 받는다", async () => {
  const db = await 만든다();
  try {
    // 쓸 수 있는 칸과 모양
    await db.query(넣기, ["cust-1", "main", "울림컴퍼니", JSON.stringify({
      region: "부산", founded_on: "2021-03-02", business_type: "소상공인",
      industries: ["경영컨설팅업"], employees: 3, revenue_krw: 120000000,
      certifications: ["여성기업"], certifications_complete: true, has_support_history: false })]);

    // 모르는 칸은 받지 않는다 — 조용히 무시되면 화면에 적은 값이 사라진다
    await assert.rejects(() => db.query(넣기, ["cust-2", "main", "가게", JSON.stringify({ 매출: 100 })]));
    // 설립일은 날짜 모양이어야 한다
    await assert.rejects(() => db.query(넣기, ["cust-3", "main", "가게", JSON.stringify({ founded_on: "2021년 3월" })]));
    // 직원수는 숫자다
    await assert.rejects(() => db.query(넣기, ["cust-4", "main", "가게", JSON.stringify({ employees: "세 명" })]));
    // 사업자등록번호 모양
    await assert.rejects(() => db.query(
      `insert into openchat_program_customer_profiles(customer_id,entity_key,entity_name,business_number)
       values('cust-5','main','가게','1234567890')`));
  } finally { await db.close(); }
});

test("한 고객사 안에 사업자를 여럿 두되 같은 이름은 한 번만", async () => {
  const db = await 만든다();
  try {
    await db.query(넣기, ["cust-1", "main", "본사", "{}"]);
    await db.query(넣기, ["cust-1", "shop", "가맹점", "{}"]);
    const [{ count }] = (await db.query(
      `select count(*)::int as count from openchat_program_customer_profiles where customer_id='cust-1'`)).rows;
    assert.equal(count, 2, "판정 단위는 사업자다 — 한 고객사에 여럿일 수 있다");
    await assert.rejects(() => db.query(넣기, ["cust-1", "main", "본사 또", "{}"]));
  } finally { await db.close(); }
});

test("값이 바뀔 때만 판이 올라간다", async () => {
  const db = await 만든다();
  try {
    const 판 = async () => (await db.query(
      `select revision::int as revision from openchat_program_match_context where id='current'`)).rows[0].revision;
    const 처음 = await 판();
    const { id } = (await db.query(넣기, ["cust-1", "main", "본사", "{}"])).rows[0];
    assert.ok(await 판() > 처음, "사업자를 넣으면 이미 내린 판정은 낡은 것이 된다");

    const 넣은뒤 = await 판();
    await db.query(`update openchat_program_customer_profiles set entity_name='본사' where id=$1`, [id]);
    assert.equal(await 판(), 넣은뒤, "같은 값을 다시 저장하면 헛되이 다시 매기지 않는다");
    const [{ version }] = (await db.query(
      `select version from openchat_program_customer_profiles where id=$1`, [id])).rows;
    assert.equal(version, 1);

    await db.query(`update openchat_program_customer_profiles
      set profile='{"region":"부산"}'::jsonb where id=$1`, [id]);
    assert.ok(await 판() > 넣은뒤, "요건이 바뀌면 다시 매겨야 한다");
    const [{ version: 다음 }] = (await db.query(
      `select version from openchat_program_customer_profiles where id=$1`, [id])).rows;
    assert.equal(다음, 2);

    // 끄는 것도 판정을 바꾼다
    const 끄기전 = await 판();
    await db.query(`update openchat_program_customer_profiles set active=false where id=$1`, [id]);
    assert.ok(await 판() > 끄기전);
  } finally { await db.close(); }
});
