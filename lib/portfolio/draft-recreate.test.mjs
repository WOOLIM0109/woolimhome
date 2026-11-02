import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as draftState from "./draft-state.ts";
import * as conversionState from "./conversion-retry.ts";
import * as checkpoint from "./checkpoint.ts";
import * as draftBudget from "./draft-budget.ts";
import * as generation from "./pipeline-generation.ts";
import { isCurrentPortfolioRedactionProof, LOCAL_REDACTION_MANIFEST_METHOD } from "./redaction-proof.ts";

const compiled = ts.transpileModule(readFileSync(new URL("./job-runner.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const NOW = "2026-11-02T00:00:00.000Z";
const clone = (value) => JSON.parse(JSON.stringify(value));

function harness({ jobs = [], status = "creating", metadata = {}, enabled = true, runDraft = false, budgetError, beforeInsert } = {}) {
  const assets = Array.from({ length: 5 }, (_, index) => ({
    kind: index === 0 ? "thumbnail" : "body_image",
    bucket: "portfolio-rendered", path: `saved-${index}.png`,
    url: `https://example.test/saved-${index}.png`, caption: `이미지 ${index + 1}`,
    slideIndexes: [index],
  }));
  const item = {
    id: "work-a", format: "portfolio", status, updated_at: NOW,
    metadata: {
      candidateId: "candidate-a", portfolioStage: "design_completed",
      portfolioAssets: assets, portfolioReview: { suitable: true },
      portfolioMockup: { bodyBoardCount: 4 }, portfolioSourceFingerprint: "source-a",
      portfolioRuleVersion: "rule-a", portfolioGenerationId: "generation-a",
      redactionProof: {
        version: 2, method: LOCAL_REDACTION_MANIFEST_METHOD, verified: true,
        sourceFingerprint: "source-a", manifestHash: "a".repeat(64),
        slides: assets.map((asset) => ({
          slideIndex: asset.slideIndexes[0], sourceHash: "b".repeat(64), redactedHash: "b".repeat(64),
          regionCount: 0, changedPixelRatio: 0,
        })),
      },
      ...metadata,
    },
  };
  const rows = {
    content_work_items: [item], content_jobs: clone(jobs), content_review_assets: [],
    portfolio_candidates: [{ id: "candidate-a", status: "processed", metadata: {}, updated_at: NOW }],
  };
  const writes = [];
  const calls = { draft: [], mockup: [], restart: 0, budget: 0, generation: 0, generatedAssets: [] };
  let nextId = 0;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.operation = "read"; this.singleRow = false; }
    select() { return this; }
    update(values) { this.operation = "update"; this.values = values; return this; }
    insert(values) { this.operation = "insert"; this.values = values; return this; }
    upsert(values, options = {}) { this.operation = "upsert"; this.values = values; this.options = options; return this; }
    delete() { this.operation = "delete"; return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    neq(key, value) { this.filters.push((row) => row[key] !== value); return this; }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
    is(key, value) { this.filters.push((row) => (row[key] ?? null) === value); return this; }
    not(key, operation, value) { assert.equal(operation, "is"); this.filters.push((row) => (row[key] ?? null) !== value); return this; }
    lt(key, value) { this.filters.push((row) => row[key] != null && row[key] < value); return this; }
    contains(key, values) { this.filters.push((row) => Object.entries(values).every(([name, value]) => row[key]?.[name] === value)); return this; }
    or() { return this; }
    order() { return this; }
    limit(count) { this.count = count; return this; }
    single() { this.singleRow = true; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    then(resolve, reject) {
      return (async () => {
        assert.ok(rows[this.table], `Unexpected table: ${this.table}`);
        let matched = rows[this.table].filter((row) => this.filters.every((filter) => filter(row)));
        if (this.count) matched = matched.slice(0, this.count);
        if (this.operation === "insert" || this.operation === "upsert") {
          await beforeInsert?.(this.values);
          matched = [];
          const values = Array.isArray(this.values) ? this.values : [this.values];
          for (const value of values) {
            const existing = value.id && rows[this.table].find((row) => row.id === value.id);
            if (existing && this.operation === "insert") {
              return { data: null, error: { code: "23505", message: "duplicate job id" } };
            }
            if (existing && this.options?.ignoreDuplicates) continue;
            const row = existing || { id: `created-${++nextId}`, created_at: NOW };
            Object.assign(row, clone(value));
            if (!existing) rows[this.table].push(row);
            matched.push(row);
          }
        } else if (this.operation === "update") {
          matched.forEach((row) => Object.assign(row, clone(this.values)));
        } else if (this.operation === "delete") {
          rows[this.table] = rows[this.table].filter((row) => !matched.includes(row));
        }
        if (this.operation !== "read") writes.push({ table: this.table, operation: this.operation, values: clone(this.values ?? null), matched: matched.length });
        return { data: clone(this.singleRow ? matched[0] || null : matched), error: null };
      })().then(resolve, reject);
    }
  }
  const modules = {
    "node:crypto": { createHash },
    "@/lib/content-ops/data": { contentAdmin: () => ({ from: (table) => new Query(table) }) },
    "./restart-control": { assertPortfolioRestartApproved: async () => { calls.restart += 1; } },
    "./draft-state": draftState,
    "./draft-budget": draftBudget,
    "./checkpoint": checkpoint,
    "./pipeline-generation": generation,
    "./conversion-retry": conversionState,
    "@/lib/gemini/protection": { geminiRuntimeStatus: () => ({ enabled, reason: enabled ? null : "API key missing" }) },
    "./production-image-projection.ts": { assertLegacyPortfolioImageWriteAllowed: () => {} },
    "./redaction-proof": { parseLocalRedactionManifest: (value) => value, isVerifiedPortfolioRedactionProof: () => true, isCurrentPortfolioRedactionProof },
    "../pc-worker/capabilities": { isCurrentLocalRedactionWorkerVersion: () => true },
    "../pc-worker/redaction-manifest": { automaticDesignEligibleSlideIndexes: () => [0, 1, 2, 3, 4], manifestPublicTitles: () => [] },
    "../content-ops/style-revision-rules": { createStyleRevisionStamp: () => ({}) },
    "@/lib/gemini/automation": {
      runBudgetedGeminiAutomation: async (_options, work) => {
        calls.budget += 1;
        if (budgetError) throw budgetError;
        return work();
      },
    },
    "./draft": { createPortfolioDraft: async (input) => {
      calls.generation += 1;
      calls.generatedAssets.push(clone(input.assets));
      return { draft: { title: "새 원고", summary: "새 요약", bodyHtml: "<p>새 본문</p>", faq: [], tags: [] }, validation: { issues: [] } };
    } },
  };
  const context = { exports: {}, require: (id) => modules[id] || {}, Date, Error, console };
  vm.runInNewContext(compiled, context);
  if (!runDraft) {
    context.processNextPortfolioDraft = async (candidateId) => {
      calls.draft.push(candidateId);
      return { candidateId, stage: "design_completed" };
    };
  }
  context.processNextPortfolioMockup = async (candidateId) => {
    calls.mockup.push(candidateId);
    return { candidateId, stage: "design_completed" };
  };
  return {
    rows, writes, calls, item,
    retry: () => context.exports.retryPortfolioDraft(item.id),
    runNextDraft: () => context.exports.processNextPortfolioDraft("candidate-a"),
    rebuild: (options) => context.exports.rebuildPortfolioDraft(item.id, options),
  };
}

function job(type, extra = {}) {
  return {
    id: `${type}-a`, candidate_id: "candidate-a", work_item_id: "work-a", job_type: type,
    status: "draft_waiting", attempts: 2, max_attempts: 3,
    result: {}, payload: {}, created_at: NOW, updated_at: NOW,
    ...extra,
  };
}

function completedAutomaticMockup() {
  return job("mockup", { status: "completed", result: {
    sourceFingerprint: "source-a", portfolioRuleVersion: "rule-a", portfolioGenerationId: "generation-a",
    visualReview: { suitable: true }, portfolioMockup: { bodyBoardCount: 4 }, redactionProof: {},
    localRedactionManifest: { slideCount: 5 },
    assets: Array.from({ length: 5 }, (_, index) => ({
      kind: index === 0 ? "thumbnail" : "body_image", bucket: "portfolio-rendered",
      path: `old-auto-${index}.png`, url: `https://example.test/old-auto-${index}.png`,
      caption: `이전 자동 이미지 ${index + 1}`, slideIndexes: [index],
    })),
  } });
}

test("retry creates a draft job for an unpublished portfolio with five saved images and no jobs", async () => {
  const h = harness();
  await h.retry();
  const drafts = h.rows.content_jobs.filter((row) => row.job_type === "draft");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].candidate_id, "candidate-a");
  assert.equal(drafts[0].work_item_id, "work-a");
  assert.equal(drafts[0].status, "queued");
  assert.equal(drafts[0].attempts, 0);
  assert.equal(h.calls.draft.length, 0);
  assert.equal(h.item.metadata.portfolioAssets.length, 5);
});

test("retry with no jobs uses the saved design to finish a body through the budgeted draft runner", async () => {
  const h = harness({ runDraft: true });
  await h.retry();
  const result = await h.runNextDraft();
  assert.equal(result.stage, "draft_completed");
  assert.equal(h.calls.budget, 1);
  assert.equal(h.calls.generation, 1);
  assert.equal(h.item.metadata.generated.bodyHtml, "<p>새 본문</p>");
  assert.equal(h.item.status, "review_required");
  assert.equal(h.rows.content_jobs.find((row) => row.job_type === "draft").status, "completed");
});

test("a recreated body uses the current manually approved images instead of the old automatic mockup job", async () => {
  const h = harness({ jobs: [completedAutomaticMockup()], metadata: { manualMockupOverride: { approvedAt: NOW } }, runDraft: true });
  const currentAssets = clone(h.item.metadata.portfolioAssets);
  await h.retry();
  assert.equal((await h.runNextDraft()).stage, "draft_completed");
  assert.deepEqual(h.calls.generatedAssets, [currentAssets]);
  assert.deepEqual(h.item.metadata.portfolioAssets, currentAssets);
  assert.equal(h.item.metadata.manualMockupOverride.approvedAt, NOW);
});

test("invalid current manual-image proof cannot fall back to an old automatic mockup", async () => {
  const h = harness({ jobs: [completedAutomaticMockup()], metadata: { manualMockupOverride: { approvedAt: NOW }, redactionProof: null }, runDraft: true });
  const currentAssets = clone(h.item.metadata.portfolioAssets);
  await h.retry();
  assert.equal(await h.runNextDraft(), null);
  assert.equal(h.calls.budget, 0);
  assert.equal(h.calls.generation, 0);
  assert.deepEqual(h.item.metadata.portfolioAssets, currentAssets);
  assert.equal(h.rows.content_jobs.find((row) => row.job_type === "draft").last_error_code, "PORTFOLIO_REDACTION_UPGRADE_REQUIRED");
});

test("a recreated draft keeps the budget gate and stores its original denial", async () => {
  const denial = Object.assign(new Error("test budget limit reached"), { code: "GEMINI_BUDGET_EXCEEDED" });
  const h = harness({ runDraft: true, budgetError: denial });
  await h.retry();
  await h.runNextDraft();
  assert.equal(h.calls.budget, 1);
  assert.equal(h.calls.generation, 0);
  const draft = h.rows.content_jobs.find((row) => row.job_type === "draft");
  assert.equal(draft.status, "draft_waiting");
  assert.equal(draft.last_error_code, denial.code);
  assert.equal(draft.error_message, denial.message);
  assert.equal(h.item.metadata.generated, undefined);
});

test("retry resets the existing draft instead of inserting another one", async () => {
  const h = harness({ jobs: [
    job("draft", { error_message: "previous error", result: { generated: { bodyHtml: "old" } } }),
    job("mockup", { status: "completed", result: { portfolioDraftProgress: { generated: { bodyHtml: "old" } }, sourceFingerprint: "keep" } }),
  ] });
  await h.retry();
  assert.equal(h.rows.content_jobs.filter((row) => row.job_type === "draft").length, 1);
  const draft = h.rows.content_jobs.find((row) => row.job_type === "draft");
  assert.equal(draft.id, "draft-a");
  assert.equal(draft.status, "queued");
  assert.equal(draft.attempts, 0);
  assert.equal(draft.error_message, null);
  assert.equal(draft.result.generated, undefined);
  const mockup = h.rows.content_jobs.find((row) => row.job_type === "mockup");
  assert.equal(mockup.result.portfolioDraftProgress, undefined);
  assert.equal(mockup.result.sourceFingerprint, "keep");
  assert.equal(h.writes.filter((entry) => entry.operation === "insert" && entry.values?.job_type === "draft").length, 0);
});

test("retry can finish an existing draft even when its old mockup job is missing", async () => {
  const h = harness({ jobs: [job("draft")], runDraft: true });
  const result = await h.retry();
  assert.equal(result.stage, "draft_completed");
  assert.equal(h.rows.content_jobs.length, 1);
  assert.equal(h.rows.content_jobs[0].id, "draft-a");
  assert.equal(h.calls.budget, 1);
  assert.equal(h.item.metadata.generated.title, "새 원고");
});

test("retry does not reset or duplicate a running draft", async () => {
  const running = job("draft", { status: "running", started_at: NOW });
  const h = harness({ jobs: [running] });
  await h.retry();
  assert.deepEqual(h.rows.content_jobs, [running]);
  assert.equal(h.calls.draft.length, 0);
});

test("concurrent retry requests create at most one draft for the same portfolio", async () => {
  const h = harness();
  await Promise.allSettled([h.retry(), h.retry()]);
  assert.equal(h.rows.content_jobs.filter((row) => row.job_type === "draft").length, 1);
});

test("a retry entering after the first claim but before its insert reuses the same draft id", async () => {
  let secondRetry;
  const h = harness({ beforeInsert: async (values) => {
    if (values.job_type === "draft" && !secondRetry) {
      secondRetry = h.retry();
      await secondRetry;
    }
  } });
  const first = await h.retry();
  const second = await secondRetry;
  assert.equal(first.workItemId, "work-a");
  assert.equal(second.workItemId, "work-a");
  assert.equal(h.rows.content_jobs.filter((row) => row.job_type === "draft").length, 1);
});

test("retry refuses published portfolios before creating or resetting jobs", async () => {
  const h = harness({ status: "published" });
  await assert.rejects(h.retry(), /이미 발행된 작업은 본문을 다시 생성할 수 없습니다/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.calls.draft.length, 0);
});

test("retry leaves a new draft waiting with the unchanged disabled Gemini reason", async () => {
  const h = harness({ enabled: false, runDraft: true });
  await h.retry();
  const draft = h.rows.content_jobs.find((row) => row.job_type === "draft");
  assert.ok(draft);
  assert.equal(draft.status, "draft_waiting");
  assert.equal(draft.last_error_code, "GEMINI_DISABLED");
  assert.equal(draft.error_message, "API key missing");
  assert.equal(await h.runNextDraft(), null);
  assert.equal(h.calls.budget, 0);
  assert.equal(h.calls.generation, 0);
});

test("a recreated draft does not use saved images with an invalid redaction proof", async () => {
  const h = harness({ metadata: { redactionProof: null }, runDraft: true });
  await h.retry();
  assert.equal(await h.runNextDraft(), null);
  assert.equal(h.calls.budget, 0);
  assert.equal(h.calls.generation, 0);
  assert.equal(h.rows.content_jobs.find((row) => row.job_type === "draft").last_error_code, "PORTFOLIO_REDACTION_UPGRADE_REQUIRED");
});

test("retry cannot create a draft when saved portfolio images are incomplete", async () => {
  const h = harness({ metadata: { portfolioAssets: [] } });
  await assert.rejects(h.retry(), /완성된 목업 이미지가 없어/);
  assert.equal(h.rows.content_jobs.length, 0);
  assert.equal(h.calls.draft.length, 0);
});

function rebuildJobs(extra = {}) {
  return [job("convert", {
    status: "completed", result: { bucket: "portfolio-rendered", slidePaths: ["0.png", "1.png", "2.png", "3.png", "4.png"],
      localRedactionManifest: { sourceSlideCount: 5, slideCount: 5 }, workerVersion: "current" },
  }), job("mockup", { status: "completed", ...extra })];
}

test("full rebuild without a body clears old mockup-only flags before continuing creation", async () => {
  const h = harness({ status: "review_required", jobs: rebuildJobs({
    result: { mockupOnly: true, portfolioDraftProgress: { generated: { bodyHtml: "stale" } } },
    payload: { mockupOnly: true },
  }) });
  const result = await h.rebuild();
  assert.equal(result.stage, "design_completed");
  assert.equal(h.calls.mockup.length, 1);
  const mockup = h.rows.content_jobs.find((row) => row.job_type === "mockup");
  assert.notEqual(mockup.result.mockupOnly, true);
  assert.notEqual(mockup.payload.mockupOnly, true);
  assert.equal(mockup.result.portfolioDraftProgress, undefined);
});

test("full rebuild after a completed mockup creates the missing draft instead of waiting for a nonexistent job", async () => {
  const h = harness({ jobs: rebuildJobs() });
  await h.rebuild();
  assert.equal(h.rows.content_jobs.filter((row) => row.job_type === "draft").length, 1);
  assert.equal(h.calls.draft.length + h.calls.mockup.length, 1);
});

test("full rebuild converts a queued mockup-only request without a body into complete creation", async () => {
  const h = harness({ jobs: rebuildJobs({ status: "queued", result: { mockupOnly: true }, payload: { mockupOnly: true } }) });
  await h.rebuild();
  const mockup = h.rows.content_jobs.find((row) => row.job_type === "mockup");
  assert.notEqual(mockup.result.mockupOnly, true);
  assert.notEqual(mockup.payload.mockupOnly, true);
  assert.equal(h.rows.content_jobs.filter((row) => row.job_type === "draft").length, 1);
  assert.equal(h.calls.mockup.length, 1);
});

test("full rebuild still requires confirmation before discarding manually uploaded images", async () => {
  const h = harness({ metadata: { manualMockupOverride: { approvedAt: NOW } }, jobs: rebuildJobs() });
  await assert.rejects(h.rebuild(), (error) => error.name === "PortfolioManualAssetsPresent");
  assert.equal(h.writes.length, 0);
  assert.equal(h.calls.mockup.length, 0);
});

test("full rebuild refuses published portfolios before changing any jobs", async () => {
  const h = harness({ status: "published", jobs: rebuildJobs() });
  await assert.rejects(h.rebuild(), /이미 발행된 작업은 자동으로 다시 만들 수 없습니다/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.calls.mockup.length, 0);
});
