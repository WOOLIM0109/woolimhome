import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const slot = { key: "design-tue", channel: "naver_design", format: "portfolio", weekday: 2, hour: 9, label: "포트폴리오" };
const scheduledKey = "2026-11-03-design-tue";

function harness({ existing = false, prepareError = null, prepared = false, pushError = null, noticeError = null, prepareReason = "중복 확인 불가" } = {}) {
  let time = Date.parse("2026-11-03T03:07:00Z");
  let prepareCalls = 0;
  let draftCalls = 0;
  const items = existing ? [{ id: "work-1", schedule_key: scheduledKey, status: "creating", metadata: { candidateId: "candidate-1" } }] : [];
  const pushes = [];
  const runs = new Map();
  const claims = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  class Query {
    constructor(execute) { this.execute = execute; this.filters = []; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    maybeSingle() { return this; }
    abortSignal() { return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute(this)).then(resolve, reject); }
  }
  const admin = {
    rpc(name, params) {
      assert.equal(name, "claim_content_automation_run");
      claims.push(params);
      return new Query(() => {
        const key = `${params.p_cron_name}:${params.p_schedule_key}`;
        const previous = runs.get(key);
        if (previous && ["running", "completed"].includes(previous.status)) return { data: null, error: null };
        const run = { id: previous?.id || `run-${runs.size + 1}`, status: "running" };
        runs.set(key, run);
        return { data: run.id, error: null };
      });
    },
    from(table) {
      return {
        select() {
          return new Query(query => {
            if (table === "content_work_items") return { data: items.find(item => query.filters.every(([key, value]) => item[key] === value)) || null, error: null };
            assert.equal(table, "portfolio_candidates");
            return { data: { status: "selected" }, error: null };
          });
        },
        update(values) {
          assert.equal(table, "content_automation_runs");
          return new Query(query => {
            for (const run of runs.values()) {
              if (query.filters.every(([key, value]) => run[key] === value)) Object.assign(run, values);
            }
            return { error: null };
          });
        },
      };
    },
  };
  function load(path, dependencies) {
    const exports = {};
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports,
      require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
      Date: Clock, Error, Response, AbortSignal, encodeURIComponent,
      process: { env: { CONTENT_AUTO_GENERATION: "false" } },
    });
    return exports;
  }
  const notice = load("lib/content-ops/portfolio-stall-notice.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/portfolio/stall-state": {},
    "@/lib/notify/web-push": { async sendAdminPush(message) {
      pushes.push(message);
      if (pushError) throw new Error(pushError);
      return { sent: 1 };
    } },
  });
  const route = load("app/api/cron/content-operations/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/content-ops/config": { EDITORIAL_SLOTS: [slot] },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/naver-works/portfolio-pipeline": { async prepareNextPortfolioCandidate() {
      prepareCalls++;
      if (prepareError) throw new Error(prepareError);
      if (prepared) {
        items.push({ id: "work-1", schedule_key: scheduledKey, metadata: { candidateId: "candidate-1" } });
        return { prepared: true, candidateId: "candidate-1" };
      }
      return { prepared: false, inspected: 2, eligible: 0, reason: prepareReason };
    } },
    "@/lib/naver-works/drive-sync": {},
    "@/lib/naver-works/job-runner": {
      async processNextPortfolioDownload() { return null; },
      async restorePcEligibleOversizedCandidates() { return 0; },
    },
    "@/lib/portfolio/job-runner": {
      async processNextPortfolioDraft() { draftCalls++; return null; },
      async processNextPortfolioMockup() { return null; },
    },
    "@/lib/portfolio/draft-budget": { PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS: 40_000, PORTFOLIO_DRAFT_FINALIZE_RESERVE_MS: 2_000 },
    "@/lib/content-ops/generate": {},
    "@/lib/gemini/automation": {},
    "@/lib/cron-auth": { authorizeCron: () => null },
    "@/lib/content-ops/deadline": {},
    "@/lib/content-ops/stuck-items": { async sweepStuckWorkItems() { return null; } },
    "@/lib/content-ops/portfolio-stall-notice": {
      ...notice,
      async notifyStalledPortfolios() { return null; },
      async notifyEmptyPortfolioSlot(...args) {
        if (noticeError) throw new Error(noticeError);
        return notice.notifyEmptyPortfolioSlot(...args);
      },
    },
    "@/lib/content-ops/status-history": {},
  });
  return {
    pushes, runs, claims,
    get prepareCalls() { return prepareCalls; },
    get draftCalls() { return draftCalls; },
    setTime(iso) { time = Date.parse(iso); },
    run() { return route.GET(new Request("https://example.test/api/cron/content-operations")); },
  };
}

test("a skipped portfolio prepare records its reason and sends only one slot notice across hourly cron runs", async () => {
  const h = harness();
  const response = await h.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  const attempt = body.localProgress.find(entry => entry?.stage === "deterministic_portfolio_prepare");
  assert.equal(attempt.status, "skipped");
  assert.equal(attempt.scheduleKey, scheduledKey);
  assert.equal(attempt.reason, "중복 확인 불가");
  assert.ok(h.pushes[0].body.includes(attempt.reason));
  h.setTime("2026-11-03T04:07:00Z");
  await h.run();
  assert.equal(h.prepareCalls, 2);
  assert.equal(h.pushes.length, 1);
  assert.equal(h.claims.filter(claim => claim.p_schedule_key === "2026-11-03:slot:design-tue").length, 2);
});

test("a failed prepare records the matching slot and sends the actual error", async () => {
  const error = "중복 검수 이미지 조회 실패: permission denied";
  const h = harness({ prepareError: error });
  const body = await (await h.run()).json();
  const attempt = body.localProgress.find(entry => entry?.stage === "deterministic_portfolio_prepare");
  assert.equal(attempt.status, "failed");
  assert.equal(attempt.slotKey, slot.key);
  assert.equal(attempt.scheduleKey, scheduledKey);
  assert.equal(attempt.reason, error);
  assert.equal(attempt.error, error);
  assert.ok(h.pushes[0].body.includes(error));
});

test("an empty portfolio slot notice includes every unreviewed publication in its count", async () => {
  const reason = "지문 없는 기존 기록 3건이 확인을 기다립니다. 중복 확인 불가";
  const h = harness({ prepareReason: reason });
  const body = await (await h.run()).json();
  assert.equal(h.pushes.length, 1);
  assert.equal(h.pushes[0].body, `11/03 오전 9시 디자인 포트폴리오 — ${reason}`);
  assert.equal(body.localProgress.find(entry => entry?.stage === "deterministic_portfolio_prepare").reason, reason);
  assert.equal(h.runs.get("portfolio_stall_notice:2026-11-03:slot:design-tue").metrics.reason, reason);
});

test("created and previously existing portfolio slots send no empty-slot notice", async () => {
  for (const options of [{ prepared: true }, { existing: true }]) {
    const h = harness(options);
    const body = await (await h.run()).json();
    assert.equal(body.success, true);
    assert.equal(h.pushes.length, 0);
    assert.equal(h.claims.filter(claim => claim.p_cron_name === "portfolio_stall_notice").length, 0);
  }
});

test("a future portfolio slot does not prepare or send an empty-slot notice", async () => {
  const h = harness();
  h.setTime("2026-11-02T23:07:00Z");
  await h.run();
  assert.equal(h.prepareCalls, 0);
  assert.equal(h.pushes.length, 0);
});

test("an empty-slot push failure does not kill subsequent portfolio processing or cron completion", async () => {
  const h = harness({ prepareError: "중복 확인 불가", pushError: "push transport offline" });
  const response = await h.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(h.draftCalls > 0);
  const notice = body.localProgress.find(entry => entry?.stage === "portfolio_stall_notice");
  assert.equal(notice.failed, 1);
  assert.ok(notice.errors[0].includes("push transport offline"));
  assert.equal(h.runs.get("portfolio_stall_notice:2026-11-03:slot:design-tue").status, "failed");
  const main = [...h.runs.entries()].find(([key]) => key.startsWith("content-operations:"))[1];
  assert.equal(main.status, "completed");
});

test("an unexpected empty-slot notice rejection does not change a skipped prepare or kill the cron", async () => {
  const h = harness({ noticeError: "notice module unavailable" });
  const response = await h.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(h.draftCalls > 0);
  const attempts = body.localProgress.filter(entry => entry?.stage === "deterministic_portfolio_prepare");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "skipped");
  const notice = body.localProgress.find(entry => entry?.stage === "portfolio_stall_notice");
  assert.equal(notice.status, "failed");
  assert.equal(notice.error, "notice module unavailable");
  assert.equal([...h.runs.values()].at(-1).status, "completed");
});
