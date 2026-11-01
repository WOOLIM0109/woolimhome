import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = ["20261020122223_openchat_program_attachments.sql", "20261021032454_openchat_program_requirements.sql",
  "20261021042817_openchat_program_review_batches.sql", "20261021051857_openchat_requirement_normalization_version.sql",
  "20261021060019_openchat_requirement_normalization_v3.sql", "20261021062847_openchat_match_selection_delta.sql",
  "20261021063654_openchat_match_payload_materialization.sql", "20261021094429_openchat_program_agent_api.sql",
  "20261102120000_openchat_reading_slot_requirement_fit.sql"];

const CONDITIONAL = "조건부 후보: 확인된 일치가 있으며 나머지 요건은 확인 필요";

// 하루 정독 8칸은 **확정 후보가 있는 공고**부터 채운다. 점수가 1점뿐이어도
// 요건이 확인된 공고가, 요건을 하나도 확인하지 못한 100점 공고를 밀어낸다.
test("the daily reading slots take confirmed candidates ahead of higher scoring notices that confirm nothing", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table public.openchat_programs(id uuid primary key default gen_random_uuid(),status text not null default 'review_required',
        deadline_at timestamptz,created_at timestamptz not null default now());
      grant usage on schema public to anon,authenticated,service_role; grant select on public.openchat_programs to service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
    for (const name of MIGRATIONS) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    const day = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
    await db.exec(`create table public.fixture_programs as select gen_random_uuid() as id,n from generate_series(1,9) n;
      insert into public.openchat_programs(id,deadline_at) select id,now()+interval '10 days' from public.fixture_programs;
      insert into public.openchat_program_attachments(program_id,file_name,file_ext,source_url,text_status,text_content,created_at,extracted_at)
        select id,'notice.pdf','pdf','https://public-fixture.example/notice','extracted','[p.1] fixture',
          now()-interval '2 hours',now()-interval '1 hour' from public.fixture_programs;
      insert into public.openchat_program_requirements(program_id,input_hash,status,normalization_version,source_checked_at,updated_at)
        select id,'unchanged-hash','extracted',3,now(),now() from public.fixture_programs;`);
    // 8개 공고는 100점이지만 전부 조건부 후보 — 확인된 요건이 하나도 없다.
    await db.query(`insert into public.openchat_program_matches(program_id,target_kind,target_id,target_name,verdict,reasons,score,review_date)
      select f.id,'customer','fixture-'||t,'Public fixture','candidate',
        pg_catalog.jsonb_build_array('확인된 지역 일치: 전국 대상',$2::text),100,$1::date
      from public.fixture_programs f cross join generate_series(1,3) t where f.n>1`, [day, CONDITIONAL]);
    const confirmed = (await db.query("select id from public.fixture_programs where n=1")).rows[0].id;
    const payload = JSON.stringify([{ targetKind: "customer", targetId: "fixture-1", targetName: "Public fixture",
      verdict: "candidate", reasons: ["확인된 지역 일치: 전국 대상"], score: 1 }]);
    await db.exec("set role service_role");
    await db.query("select save_openchat_program_matches($1,$2::date,'unchanged-hash',$3::jsonb)", [confirmed, day, payload]);

    const slots = (await db.query(`select distinct f.n from openchat_program_matches m
      join fixture_programs f on f.id=m.program_id where m.review_date=$1 and m.selected_for_reading order by f.n`, [day])).rows;
    assert.equal(slots.length, 8, "여덟 칸을 다 쓴다");
    assert.ok(slots.some(row => row.n === 1), "1점이어도 확정 후보가 있는 공고는 칸을 차지한다");
    assert.equal((await db.query(`select count(*)::int as n from openchat_program_matches m
      join fixture_programs f on f.id=m.program_id
      where m.review_date=$1 and m.selected_for_reading and f.n>1`, [day])).rows[0].n, 7 * 3,
      "100점 공고 여덟 중 하나가 밀려난다");

    // 확정 후보가 조건부로 바뀌면 점수가 높은 공고에 칸을 돌려준다.
    const stillConditional = JSON.stringify([{ targetKind: "customer", targetId: "fixture-1", targetName: "Public fixture",
      verdict: "candidate", reasons: ["확인된 지역 일치: 전국 대상", CONDITIONAL], score: 1 }]);
    await db.query("select save_openchat_program_matches($1,$2::date,'unchanged-hash',$3::jsonb)", [confirmed, day, stillConditional]);
    assert.equal((await db.query(`select count(*)::int as n from openchat_program_matches m
      join fixture_programs f on f.id=m.program_id
      where m.review_date=$1 and m.selected_for_reading and f.n=1`, [day])).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from openchat_program_matches
      where review_date=$1 and selected_for_reading`, [day])).rows[0].n, 8 * 3);
  } finally { await db.close(); }
});
