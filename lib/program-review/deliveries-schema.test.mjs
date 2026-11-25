import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.openchat_programs(id uuid primary key default gen_random_uuid());
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  await db.exec(await migration("20261126090000_openchat_program_deliveries.sql"));
  const id = (await db.query("insert into openchat_programs default values returning id")).rows[0].id;
  return { db, id };
}

test("보낸 기록 표는 서버 키만 읽고 쓰며 고치지는 못한다", async () => {
  const { db } = await database();
  try {
    const row = (await db.query(`select c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anon_read,
      has_table_privilege('authenticated',c.oid,'insert') as user_write,
      has_table_privilege('service_role',c.oid,'select') as service_read,
      has_table_privilege('service_role',c.oid,'insert') as service_insert,
      has_table_privilege('service_role',c.oid,'delete') as service_delete,
      has_table_privilege('service_role',c.oid,'update') as service_update
      from pg_class c where c.relname='openchat_program_deliveries'`)).rows[0];
    assert.deepEqual(row, { rls: true, anon_read: false, user_write: false,
      service_read: true, service_insert: true, service_delete: true, service_update: false });
  } finally { await db.close(); }
});

test("같은 고객사에 같은 공고는 한 줄만 남고, 두 번 눌러도 오류가 아니다", async () => {
  const { db, id } = await database();
  try {
    await db.exec("set role service_role");
    const insert = `insert into openchat_program_deliveries(customer_id,program_id,review_date,delivered_by)
      values('cust-1',$1,'2026-11-26','staff@example.test') on conflict (customer_id,program_id) do nothing`;
    await db.query(insert, [id]);
    await db.query(insert, [id]);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_deliveries")).rows[0].n, 1);
    await assert.rejects(db.query(`insert into openchat_program_deliveries(customer_id,program_id,review_date,delivered_by)
      values('cust-1',$1,'2026-11-26','')`, [id]), /check/i);
    await db.exec("reset role");
    await db.query("delete from openchat_programs where id=$1", [id]);
    assert.equal((await db.query("select count(*)::int as n from openchat_program_deliveries")).rows[0].n, 0);
  } finally { await db.close(); }
});
