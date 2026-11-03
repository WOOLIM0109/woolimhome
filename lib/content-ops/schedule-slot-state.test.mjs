import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyPortfolioSlotReason } from "./schedule-slot-state.ts";
import { EDITORIAL_SLOTS } from "./config.ts";

const plan = { key: "design-tue", scheduleKey: "2026-11-03-design-tue", dateKey: "2026-11-03", hour: 9,
  channel: "naver_design", format: "portfolio" };
const now = new Date("2026-11-03T10:00:00+09:00");
const run = (entry, scheduledFor = "2026-11-03T09:07:00+09:00") => ({
  scheduled_for: scheduledFor, metrics: { localProgress: [{
    stage: "deterministic_portfolio_prepare", status: "failed", scheduleKey: plan.scheduleKey, slotKey: plan.key,
    error: "중복 검수 이미지 조회 실패: Object not found", ...entry,
  }] },
});

test("an overdue empty portfolio displays the latest matching failed or skipped reason", () => {
  assert.equal(emptyPortfolioSlotReason(plan, false, [run({})], now), "중복 검수 이미지 조회 실패: Object not found");
  const runs = [run({}), run({ status: "skipped", reason: "중복 확인 불가", error: null }, "2026-11-03T09:57:00+09:00")];
  assert.equal(emptyPortfolioSlotReason(plan, false, runs, now), "중복 확인 불가");
  assert.equal(emptyPortfolioSlotReason(plan, false, [run({ scheduleKey: undefined, slotKey: undefined })], now),
    "중복 검수 이미지 조회 실패: Object not found");
});

test("normal slots and slots before or at the scheduled time do not display empty status", () => {
  assert.equal(emptyPortfolioSlotReason(plan, true, [run({})], now), null);
  assert.equal(emptyPortfolioSlotReason(plan, false, [run({})], new Date("2026-11-03T08:59:59+09:00")), null);
  assert.equal(emptyPortfolioSlotReason(plan, false, [run({})], new Date("2026-11-03T09:00:00+09:00")), null);
  assert.equal(emptyPortfolioSlotReason({ ...plan, format: "design_insight" }, false, [run({})], now), null);
});

test("empty slots without a matching failure explain the missing preparation result", () => {
  const other = [run({ scheduleKey: "another-slot" }), run({}, "2026-11-02T09:07:00+09:00")];
  assert.equal(emptyPortfolioSlotReason(plan, false, other, now), "예정 시각 이후 준비 결과가 없습니다.");
  assert.equal(emptyPortfolioSlotReason(plan, false, [{ scheduled_for: now.toISOString(), metrics: null }], now),
    "예정 시각 이후 준비 결과가 없습니다.");
});

function load(file, dependencies, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  }, Date, Intl, URL, URLSearchParams, Response, ...globals });
  return exports;
}

function scheduleHarness(workItems = []) {
  const reads = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now.toISOString()])); }
  }
  const admin = { from(table) {
    let columns = "";
    const filters = [];
    const query = {
      select(value) { columns = value; return query; },
      gte(...args) { filters.push(["gte", ...args]); return query; },
      lt(...args) { filters.push(["lt", ...args]); return query; },
      in(...args) { filters.push(["in", ...args]); return query; },
      eq(...args) { filters.push(["eq", ...args]); return query; },
      order() { return query; },
      limit(value) { filters.push(["limit", value]); return query; },
      then(resolve) {
        reads.push({ table, columns, filters });
        const data = table === "content_work_items" ? workItems
          : table === "content_automation_runs" && columns.includes("metrics") ? [run({})] : [];
        resolve({ data, error: null });
      },
    };
    return query;
  } };
  const route = load("app/api/schedule/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/auth": { isAdmin: () => true },
    "@/lib/content-ops/config": { EDITORIAL_SLOTS },
    "@/lib/content-ops/data": { authenticatedPartner: async () => ({ email: "admin@example.test" }), contentAdmin: () => admin },
    "@/lib/content-ops/schedule-slot-state": { emptyPortfolioSlotReason },
  }, { Date: Clock });
  return { reads, get: () => route.GET(new Request("https://example.test/api/schedule")) };
}

test("schedule API retrieves portfolio failure reasons independently of the twelve-run summary", async () => {
  const h = scheduleHarness();
  const response = await h.get();
  const body = await response.json();
  const row = body.rows.find(value => value.dateKey === plan.dateKey && value.format === "portfolio");
  assert.equal(row.status, "planned");
  assert.equal(row.emptySlotReason, "중복 검수 이미지 조회 실패: Object not found");
  assert.equal(body.rows.find(value => value.dateKey === "2026-11-10" && value.format === "portfolio").emptySlotReason, null);
  const read = h.reads.find(value => value.columns.includes("metrics"));
  assert.ok(read.filters.some(value => value[0] === "eq" && value[1] === "cron_name" && value[2] === "content-operations"));
  assert.ok(read.filters.some(value => value[0] === "gte" && value[2] === "2026-11-02T15:00:00.000Z"));
  assert.ok(!read.filters.some(value => value[0] === "limit"));
});

test("schedule API keeps an existing portfolio normal even when a previous attempt failed", async () => {
  const h = scheduleHarness([{ schedule_key: plan.scheduleKey, status: "draft_waiting", title: "준비된 포트폴리오" }]);
  const body = await (await h.get()).json();
  const row = body.rows.find(value => value.dateKey === plan.dateKey && value.format === "portfolio");
  assert.equal(row.emptySlotReason, null);
  assert.equal(row.status, "draft_waiting");
});

test("schedule screen renders overdue empty status prominently and keeps future text", () => {
  const rows = [
    { ...plan, key: "today", label: "포트폴리오", status: "planned", emptySlotReason: "중복 확인 불가" },
    { ...plan, key: "future", dateKey: "2026-11-10", label: "포트폴리오", status: "planned", emptySlotReason: null },
    { ...plan, key: "normal", label: "포트폴리오", status: "draft_waiting", emptySlotReason: null },
  ];
  const values = [rows, [], false, ""];
  const component = load("components/admin/TwoWeekSchedule.tsx", {
    react: { useState: () => [values.shift(), () => {}], useMemo: fn => fn(), useEffect: () => {} },
    "react/jsx-runtime": { jsx, jsxs },
    "@/lib/content-ops/config": { CHANNELS: [], STATUS_LABELS: { draft_waiting: "본문 작성 대기" }, STATUS_STYLES: { draft_waiting: "normal" } },
  }).default;
  const html = renderToStaticMarkup(component({}));
  assert.match(html, /bg-red-50 text-red-700[^>]*>빈손 · 중복 확인 불가/);
  assert.match(html, /아직 생성 전/);
  assert.match(html, /본문 작성 대기/);
  assert.equal((html.match(/빈손 ·/g) || []).length, 1);
});
