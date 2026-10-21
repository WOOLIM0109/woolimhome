import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("private agent schema enforces append-only reviews and approval/context snapshot atomicity", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table public.openchat_programs(id uuid primary key default gen_random_uuid(),status text not null default 'review_required',
        deadline_at timestamptz,created_at timestamptz not null default now());
      grant usage on schema public to anon,authenticated,service_role; grant select on public.openchat_programs to service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
    for (const name of ["20261020122223_openchat_program_attachments.sql", "20261021032454_openchat_program_requirements.sql",
      "20261021042817_openchat_program_review_batches.sql", "20261021051857_openchat_requirement_normalization_version.sql",
      "20261021060019_openchat_requirement_normalization_v3.sql", "20261021062847_openchat_match_selection_delta.sql",
      "20261021063654_openchat_match_payload_materialization.sql", "20261021094429_openchat_program_agent_api.sql"])
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
    const security = (await db.query(`select c.relname,c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anon_read,has_table_privilege('authenticated',c.oid,'insert') as user_write,
      has_table_privilege('service_role',c.oid,'update') as service_update,has_table_privilege('service_role',c.oid,'delete') as service_delete
      from pg_class c where c.relname in ('openchat_program_match_context','openchat_program_self_profiles',
      'openchat_program_reviews','openchat_program_profile_proposals') order by c.relname`)).rows;
    assert.equal(security.length, 4);
    for (const row of security) {
      assert.equal(row.rls, true); assert.equal(row.anon_read, false); assert.equal(row.user_write, false);
      assert.equal(row.service_delete, false); assert.equal(row.service_update, row.relname !== "openchat_program_reviews");
    }
    const funcs = (await db.query(`select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'execute') as anon_exec,
      has_function_privilege('authenticated',p.oid,'execute') as user_exec,has_function_privilege('service_role',p.oid,'execute') as service_exec
      from pg_proc p where p.proname in ('valid_openchat_self_profile_patch','stamp_openchat_self_profile_version',
      'bump_openchat_program_match_context','apply_openchat_program_profile_proposal')
      or(p.proname='save_openchat_program_matches' and p.pronargs=5)`)).rows;
    assert.equal(funcs.length, 5);
    for (const row of funcs) assert.deepEqual({ definer: row.prosecdef, anon: row.anon_exec, user: row.user_exec, service: row.service_exec },
      { definer: false, anon: false, user: false, service: true });
    const program = (await db.query(`insert into openchat_programs(deadline_at) values(now()+interval '1 day') returning id`)).rows[0].id;
    await db.query(`insert into openchat_program_attachments(program_id,file_name,file_ext,source_url,text_status,text_content,created_at,extracted_at)
      values($1,'fixture.pdf','pdf','https://example.test/notice','extracted','[p.1] public fixture',now()-interval '2 hours',now()-interval '1 hour')`, [program]);
    await db.query(`insert into openchat_program_requirements(program_id,input_hash,status,normalization_version,source_checked_at)
      values($1,'same-input','extracted',3,now())`, [program]);
    await db.exec("set role service_role");
    const validPatch = async patch => (await db.query("select valid_openchat_self_profile_patch($1::jsonb) as valid", [JSON.stringify(patch)])).rows[0].valid;
    assert.equal(await validPatch({ region: "Test province", founded_on: "2020-01-31", business_type: "Test corporation",
      industries: ["Test design", "Test software"], employees: 7, revenue_krw: 123456789, revenue_band: "Test range",
      certifications: ["Test certification"], certifications_complete: false, has_support_history: true, notes: "Synthetic fixture only" }), true);
    for (const patch of [{ industries: [7] }, { certifications: [null] }, { industries: "not-array" }, { certifications_complete: null },
      { employees: 1.5 }, { revenue_krw: -1 }, { revenue_krw: 9007199254740992 }, { private_contact: "rejected field" }])
      assert.equal(await validPatch(patch), false);
    const revision = async () => Number((await db.query("select revision from openchat_program_match_context where id='current'")).rows[0].revision);
    assert.equal(await revision(), 1);
    for (let i = 0; i < 2; i++) await db.query(`insert into openchat_program_reviews(program_id,target_kind,target_id,target_name,conclusion,review_markdown)
      values($1,'self','woolim-company','Public fixture','검토','review fixture')`, [program]);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_reviews")).rows[0].n, 2);
    await assert.rejects(db.exec("update openchat_program_reviews set review_markdown='changed'"), /permission denied/);
    await assert.rejects(db.exec("delete from openchat_program_reviews"), /permission denied/);
    const proposal = (await db.query(`insert into openchat_program_profile_proposals(profile_id,base_version,patch,reason)
      values('woolim-company',1,'{"region":"Test region"}','fixture fact') returning id`)).rows[0].id;
    assert.equal(await revision(), 1);
    assert.equal((await db.query("select profile->>'region' as region from openchat_program_self_profiles where id='woolim-company'")).rows[0].region, null);
    await assert.rejects(db.query("select apply_openchat_program_profile_proposal($1,2,'admin-fixture',true)", [proposal]), /Proposal conflict/);
    await assert.rejects(db.query("select apply_openchat_program_profile_proposal($1,null,'admin-fixture',true)", [proposal]), /Invalid approval/);
    await db.query("select apply_openchat_program_profile_proposal($1,1,'admin-fixture',true)", [proposal]);
    assert.equal(await revision(), 2);
    const profile = (await db.query("select version,profile->>'region' as region from openchat_program_self_profiles where id='woolim-company'")).rows[0];
    assert.deepEqual(profile, { version: 2, region: "Test region" });
    await assert.rejects(db.query("select apply_openchat_program_profile_proposal($1,1,'admin-fixture',true)", [proposal]), /Proposal conflict/);
    await assert.rejects(db.exec(`update openchat_program_self_profiles set profile='{"employees":-1}' where id='woolim-company'`), /check constraint/);
    const day = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
    const payload = JSON.stringify([{ targetKind: "self", targetId: "woolim-company", targetName: "Public fixture", verdict: "unknown", reasons: ["fixture missing"], score: 5 }]);
    const save = (rev, body = payload) => db.query("select save_openchat_program_matches($1,$2::date,'same-input',$3::jsonb,$4::bigint)", [program, day, body, rev]);
    await assert.rejects(save(1), /Profile snapshot changed/);
    await save(2);
    const markers = (await db.query("select matched_profile_revision,matched_rule_version from openchat_program_requirements where program_id=$1", [program])).rows[0];
    assert.deepEqual({ revision: Number(markers.matched_profile_revision), rule: markers.matched_rule_version }, { revision: 2, rule: 2 });
    const queue = async () => (await db.query("select openchat_review_queue_status($1::date,true) as q", [day])).rows[0].q;
    assert.equal((await queue()).ready, 0);
    await db.query(`insert into openchat_match_profiles_cache(cache_date,refresh_state) values($1,'{"cursor":40}')`, [day]);
    assert.equal(await revision(), 2);
    await db.query(`update openchat_match_profiles_cache set payload='[{"id":"fake-customer","name":"Fake customer"}]',
      fetched_at=now(),expires_at=now()+interval '1 day' where cache_date=$1`, [day]);
    assert.equal(await revision(), 3); assert.equal((await queue()).ready, 1);
    assert.equal((await db.query("select count(*)::int as n from list_openchat_requirement_work($1::date,100,null,true)", [day])).rows[0].n, 1);
    await db.query(`update openchat_match_profiles_cache set refresh_state='{"cursor":80}',fetched_at=now() where cache_date=$1`, [day]);
    assert.equal(await revision(), 3);
    const bad = JSON.stringify([{ targetKind: "self", targetId: "woolim-company", targetName: "Public fixture", verdict: "invalid", reasons: [], score: 0 }]);
    await assert.rejects(save(3, bad), /check constraint/);
    assert.equal((await queue()).ready, 1);
    assert.equal(Number((await db.query("select matched_profile_revision from openchat_program_requirements where program_id=$1", [program])).rows[0].matched_profile_revision), 2);
    await save(3); assert.equal((await queue()).ready, 0);
    await db.query("update openchat_program_requirements set matched_rule_version=1 where program_id=$1", [program]);
    assert.equal((await queue()).ready, 1);
    await db.exec("reset role;set role anon");
    await assert.rejects(db.query("select apply_openchat_program_profile_proposal($1,1,'attacker',true)", [proposal]), /permission denied/);
    await assert.rejects(db.exec("select * from openchat_program_self_profiles"), /permission denied/);
  } finally { await db.close(); }
});
