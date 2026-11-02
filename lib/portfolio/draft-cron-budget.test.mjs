import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS,
  PORTFOLIO_DRAFT_FINALIZE_RESERVE_MS,
} from "./draft-budget.ts";

function harness({
  mockupDurationMs = 0, mockupsAvailable = true, earlierWorkMs = 0,
  draftResults = [null, { stage: "draft", status: "checkpoint" }],
  draftDurationMs = 0, mockupIgnoresDeadline = false,
  stallError = null,
} = {}) {
  const start = Date.parse("2026-11-02T01:00:00Z");
  let now = start;
  const calls = [];
  const updates = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const admin = {
    async rpc() { return { data: "cron-run", error: null }; },
    from(table) {
      assert.equal(table, "content_automation_runs");
      return { update(values) {
        updates.push(values);
        return { async eq() { return { error: null }; } };
      } };
    },
  };
  const dependencies = {
    "next/server": { NextResponse: Response },
    "@/lib/content-ops/config": { EDITORIAL_SLOTS: [] },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/naver-works/portfolio-pipeline": {},
    "@/lib/naver-works/drive-sync": {},
    "@/lib/naver-works/job-runner": {
      async restorePcEligibleOversizedCandidates() { now += earlierWorkMs; return 0; },
      async processNextPortfolioDownload() { calls.push({ stage: "download", now }); return null; },
    },
    "@/lib/portfolio/job-runner": {
      async processNextPortfolioMockup(candidateId, { deadlineAt }) {
        assert.equal(candidateId, undefined);
        calls.push({ stage: "mockup", now, deadlineAt });
        if (!mockupsAvailable) return null;
        now = mockupIgnoresDeadline ? now + mockupDurationMs : Math.min(now + mockupDurationMs, deadlineAt);
        return { stage: "mockup", status: "checkpoint" };
      },
      async processNextPortfolioDraft(candidateId, { deadlineAt }) {
        assert.equal(candidateId, undefined);
        const result = draftResults.shift() || null;
        calls.push({ stage: "draft", now, deadlineAt, processed: Boolean(result) });
        if (result) now += draftDurationMs;
        return result;
      },
    },
    "@/lib/portfolio/draft-budget": {
      PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS,
      PORTFOLIO_DRAFT_FINALIZE_RESERVE_MS,
    },
    "@/lib/content-ops/generate": {},
    "@/lib/gemini/automation": {},
    "@/lib/cron-auth": { authorizeCron: () => null },
    "@/lib/content-ops/deadline": {},
    "@/lib/content-ops/stuck-items": { async sweepStuckWorkItems() { return null; } },
    "@/lib/content-ops/portfolio-stall-notice": {
      async notifyStalledPortfolios() {
        if (stallError) throw new Error(stallError);
        return null;
      },
    },
    "@/lib/content-ops/status-history": {},
  };
  const exports = {};
  const compiled = ts.transpileModule(readFileSync("app/api/cron/content-operations/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    Date: Clock,
    Error,
    Response,
    process: { env: { CONTENT_AUTO_GENERATION: "false" } },
  });
  return { start, calls, updates, run: () => exports.GET(new Request("https://example.test/api/cron/content-operations")) };
}

test("slow mockups receive an earlier deadline and leave a full draft call plus checkpoint time", async () => {
  const h = harness({ mockupDurationMs: 1_000_000 });
  const response = await h.run();
  assert.equal(response.status, 200);
  const mockups = h.calls.filter(call => call.stage === "mockup");
  const draft = h.calls.find(call => call.stage === "draft" && call.processed);
  assert.equal(mockups.length, 1);
  assert.ok(draft, "the draft must still run after mockups use their entire allotted time");
  assert.equal(draft.deadlineAt, h.start + 280_000);
  assert.equal(mockups[0].deadlineAt,
    draft.deadlineAt - PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS - PORTFOLIO_DRAFT_FINALIZE_RESERVE_MS);
  assert.ok(draft.deadlineAt - draft.now > PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS);
  assert.equal(h.updates.at(-1).status, "completed");
});

test("the existing four-mockup limit still leaves the reserved draft budget", async () => {
  const h = harness({ mockupDurationMs: 1_000 });
  await h.run();
  assert.equal(h.calls.filter(call => call.stage === "mockup").length, 4);
  const draft = h.calls.find(call => call.stage === "draft" && call.processed);
  assert.ok(draft);
  assert.ok(draft.deadlineAt - draft.now > PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS);
});

test("earlier work that uses the mockup allowance skips mockups while preserving draft time", async () => {
  const h = harness({ earlierWorkMs: 280_000 - PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS - 1 });
  await h.run();
  assert.equal(h.calls.filter(call => call.stage === "mockup").length, 0);
  const draft = h.calls.find(call => call.stage === "draft" && call.processed);
  assert.ok(draft);
  assert.equal(draft.deadlineAt - draft.now, PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS + 1);
});

test("an empty mockup queue passes the untouched full deadline to the draft", async () => {
  const h = harness({ mockupsAvailable: false, draftResults: [{ stage: "draft", status: "checkpoint" }] });
  await h.run();
  const draft = h.calls.find(call => call.stage === "draft" && call.processed);
  assert.ok(draft);
  assert.equal(draft.now, h.start);
  assert.equal(draft.deadlineAt, h.start + 280_000);
});

test("the follow-up draft is skipped when earlier work leaves only the exact shared cutoff", async () => {
  const h = harness({ earlierWorkMs: 280_000 - PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS });
  await h.run();
  assert.equal(h.calls.filter(call => call.stage === "mockup").length, 0);
  assert.equal(h.calls.filter(call => call.stage === "draft").length, 1);
  assert.equal(h.calls.filter(call => call.stage === "draft" && call.processed).length, 0);
});

test("an existing draft runs before a mockup that ignores its advisory deadline", async () => {
  const h = harness({
    draftResults: [{ stage: "draft", status: "checkpoint" }],
    draftDurationMs: 130_000,
    mockupDurationMs: 300_000,
    mockupIgnoresDeadline: true,
  });
  await h.run();
  assert.equal(h.calls[0].stage, "draft");
  assert.equal(h.calls[0].processed, true);
  assert.equal(h.calls[0].deadlineAt, h.start + 280_000);
  const mockup = h.calls.find(call => call.stage === "mockup");
  assert.ok(mockup);
  assert.equal(mockup.now, h.start + 130_000);
  assert.equal(mockup.deadlineAt, h.start + 280_000);
  assert.equal(h.calls.filter(call => call.stage === "draft").length, 1);
});

test("a stall notification failure leaves normal portfolio processing alive", async () => {
  const h = harness({
    stallError: "push transport offline",
    mockupsAvailable: false,
    draftResults: [{ stage: "draft", status: "checkpoint" }],
  });
  const response = await h.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  const notice = body.localProgress.find(entry => entry.stage === "portfolio_stall_notice");
  assert.equal(notice.status, "failed");
  assert.equal(notice.error, "push transport offline");
  assert.ok(h.calls.some(call => call.stage === "draft" && call.processed));
  assert.ok(h.calls.some(call => call.stage === "mockup"));
  assert.equal(h.updates.at(-1).status, "completed");
});
