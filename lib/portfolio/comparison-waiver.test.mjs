import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { portfolioTestDatabase } from "./sql-test-database.mjs";

const migration = "20261105061540_portfolio_publication_comparison_waiver.sql";
const recordId = "00000000-0000-0000-0000-000000000001";
const firstEvent = { action: "waive", reason: "not_portfolio", actor: "first@example.com", at: "2026-11-05T01:00:00.000Z" };

function load(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  }, Date, Error, JSON, Number });
  return exports;
}

const helpers = load("lib/portfolio/comparison-waiver.ts");

async function harness() {
  const db = await portfolioTestDatabase(["20261016190043_portfolio_publication_ledger.sql", migration]);
  await db.query(`insert into portfolio_publication_ledger(id,normalized_project_name,blog_url,title,source)
    values($1,'과거 안내','https://blog.naver.com/wl_0109/123','과거 안내','history')`, [recordId]);
  const control = { user: { id: "admin-id", email: "admin@example.com" }, fromCalls: 0, updates: 0 };
  const route = load("app/api/admin/naver-works/publications/[id]/comparison-waiver/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/portfolio/comparison-waiver": helpers,
    "@/lib/content-ops/data": {
      authenticatedAdmin: async () => control.user,
      contentAdmin: () => ({ from(table) {
        control.fromCalls++;
        assert.equal(table, "portfolio_publication_ledger");
        const filters = new Map();
        let update;
        const query = {
          select() { return query; },
          update(value) { update = value; return query; },
          eq(key, value) { filters.set(key, value); return query; },
          async maybeSingle() {
            if (control.databaseError) return { data: null, error: control.databaseError };
            if (!update) {
              const result = await db.query("select id,comparison_waiver from portfolio_publication_ledger where id=$1", [filters.get("id")]);
              return { data: result.rows[0] || null, error: null };
            }
            control.updates++;
            assert.deepEqual(Object.keys(update), ["comparison_waiver"]);
            assert.equal(typeof filters.get("comparison_waiver"), "string");
            if (control.beforeUpdate) await control.beforeUpdate();
            const result = await db.query(`update portfolio_publication_ledger set comparison_waiver=$1::jsonb
              where id=$2 and comparison_waiver=$3::jsonb returning id`,
            [JSON.stringify(update.comparison_waiver), filters.get("id"), filters.get("comparison_waiver")]);
            return { data: result.rows[0] || null, error: null };
          },
        };
        return query;
      } }),
    },
  });
  return {
    db, control,
    run: (body, id = recordId) => route.PATCH(new Request("http://localhost/comparison-waiver", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) }),
    history: async () => (await db.query("select comparison_waiver from portfolio_publication_ledger where id=$1", [recordId])).rows[0].comparison_waiver,
  };
}

test("comparison waiver accepts only selected reasons and rejects the entire damaged history", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.COMPARISON_WAIVER_REASONS)).map(reason => reason.value),
    ["not_portfolio", "source_unavailable", "duplicate_record"]);
  assert.equal(helpers.activeComparisonWaiver([firstEvent]).actor, firstEvent.actor);
  assert.equal(helpers.activeComparisonWaiver([firstEvent, { action: "restore", reason: "free text" }]), null);
  assert.equal(helpers.activeComparisonWaiver([firstEvent, { ...firstEvent, action: "restore" }]), null);
  assert.equal(helpers.comparisonWaiverHistory([{ ...firstEvent, at: "yesterday" }]).length, 0);
  assert.equal(helpers.comparisonWaiverHistory([{ ...firstEvent, actor: "" }]).length, 0);
});

test("admin marks and restores a publication while preserving who, when and the selected reason", async () => {
  const h = await harness();
  try {
    const before = Date.now();
    const response = await h.run({ action: "waive", reason: "not_portfolio", expectedHistory: [], actor: "forged", at: "1900-01-01" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.waiver.actor, "admin@example.com");
    assert.equal(body.waiver.reason, "not_portfolio");
    assert.ok(Date.parse(body.waiver.at) >= before && Date.parse(body.waiver.at) <= Date.now());
    assert.deepEqual(await h.history(), body.waiverHistory);
    h.control.user = { id: "second-admin", email: "second@example.com" };
    const restored = await h.run({ action: "restore", expectedHistory: body.waiverHistory });
    assert.equal(restored.status, 200);
    const restoredBody = await restored.json();
    assert.equal(restoredBody.waiver, null);
    assert.equal(restoredBody.waiverHistory.length, 2);
    assert.deepEqual(restoredBody.waiverHistory[0], body.waiver);
    assert.deepEqual(restoredBody.waiverHistory[1], {
      action: "restore", reason: "not_portfolio", actor: "second@example.com", at: restoredBody.waiverHistory[1].at,
    });
    assert.deepEqual(await h.history(), restoredBody.waiverHistory);
    const markedAgain = await h.run({ action: "waive", reason: "source_unavailable", expectedHistory: restoredBody.waiverHistory });
    assert.equal(markedAgain.status, 200);
    assert.equal((await markedAgain.json()).waiverHistory.length, 3);
    const row = (await h.db.query("select * from portfolio_publication_ledger where id=$1", [recordId])).rows[0];
    assert.equal(row.title, "과거 안내");
    assert.equal(row.source, "history");
    assert.deepEqual(row.representative_hashes, []);
  } finally { await h.db.close(); }
});

test("unauthorized users and invalid actions, reasons, histories and IDs cannot change a waiver", async () => {
  const h = await harness();
  try {
    h.control.user = null;
    assert.equal((await h.run({ action: "waive", reason: "not_portfolio", expectedHistory: [] })).status, 401);
    assert.equal(h.control.fromCalls, 0);
    h.control.user = { id: "admin-id", email: "admin@example.com" };
    for (const body of [null, {}, { action: "remove", expectedHistory: [] },
      { action: "waive", reason: "because I said so", expectedHistory: [] },
      { action: "waive", reason: "not_portfolio" },
      { action: "waive", reason: "not_portfolio", expectedHistory: [null] }]) {
      assert.equal((await h.run(body)).status, 400);
    }
    assert.equal((await h.run({ action: "waive", reason: "not_portfolio", expectedHistory: [] }, "bad-id")).status, 400);
    assert.equal((await h.run({ action: "restore", expectedHistory: [] })).status, 409);
    assert.equal((await h.run({ action: "waive", reason: "not_portfolio", expectedHistory: [] }, "00000000-0000-0000-0000-000000000002")).status, 404);
    assert.equal(h.control.updates, 0);
    assert.deepEqual(await h.history(), []);
  } finally { await h.db.close(); }
});

test("stale and simultaneous waiver changes fail without overwriting another person's audit event", async () => {
  const h = await harness();
  try {
    await h.db.query("update portfolio_publication_ledger set comparison_waiver=$1 where id=$2", [JSON.stringify([firstEvent]), recordId]);
    assert.equal((await h.run({ action: "waive", reason: "not_portfolio", expectedHistory: [] })).status, 409);
    assert.equal(h.control.updates, 0);
    const competingEvent = { ...firstEvent, action: "restore", actor: "other@example.com", at: "2026-11-05T02:00:00.000Z" };
    h.control.beforeUpdate = () => h.db.query("update portfolio_publication_ledger set comparison_waiver=$1 where id=$2",
      [JSON.stringify([firstEvent, competingEvent]), recordId]);
    const response = await h.run({ action: "restore", expectedHistory: [firstEvent] });
    assert.equal(response.status, 409);
    assert.deepEqual(await h.history(), [firstEvent, competingEvent]);
  } finally { await h.db.close(); }
});

test("damaged saved audit history cannot be replaced, and missing migration errors explain the required file", async () => {
  const h = await harness();
  try {
    const damaged = [firstEvent, { action: "restore", reason: "free text" }];
    await h.db.query("update portfolio_publication_ledger set comparison_waiver=$1 where id=$2", [JSON.stringify(damaged), recordId]);
    assert.equal((await h.run({ action: "restore", expectedHistory: [firstEvent] })).status, 409);
    assert.deepEqual(await h.history(), damaged);
    h.control.databaseError = { code: "42703", message: "column comparison_waiver does not exist" };
    const response = await h.run({ action: "waive", reason: "not_portfolio", expectedHistory: [] });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /20261105061540_portfolio_publication_comparison_waiver.sql/);
    h.control.databaseError = { message: "connection failed" };
    const failed = await h.run({ action: "waive", reason: "not_portfolio", expectedHistory: [] });
    assert.equal(failed.status, 500);
    assert.equal((await failed.json()).error, "connection failed");
  } finally { await h.db.close(); }
});

test("the migration adds only one defaulted audit column and keeps ledger access private", async () => {
  const db = await portfolioTestDatabase(["20261016190043_portfolio_publication_ledger.sql"]);
  try {
    await db.exec(`insert into portfolio_publication_ledger(normalized_project_name,blog_url,title,source)
      values('원본','https://blog.naver.com/wl_0109/123','원본','history')`);
    const columnsBefore = (await db.query("select column_name from information_schema.columns where table_name='portfolio_publication_ledger' order by ordinal_position")).rows;
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    const columnsAfter = (await db.query("select column_name from information_schema.columns where table_name='portfolio_publication_ledger' order by ordinal_position")).rows;
    assert.deepEqual(columnsAfter.slice(0, -1), columnsBefore);
    assert.equal(columnsAfter.length, columnsBefore.length + 1);
    assert.equal(columnsAfter.at(-1).column_name, "comparison_waiver");
    assert.deepEqual((await db.query("select comparison_waiver from portfolio_publication_ledger")).rows[0].comparison_waiver, []);
    await assert.rejects(db.exec("update portfolio_publication_ledger set comparison_waiver='{}'"), /check constraint/);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(db.query("select comparison_waiver from portfolio_publication_ledger"), /permission denied/);
      await assert.rejects(db.exec("update portfolio_publication_ledger set comparison_waiver='[]'"), /permission denied/);
    }
    await db.exec("reset role; set role service_role; update portfolio_publication_ledger set comparison_waiver='[]'");
  } finally { await db.close(); }
});
