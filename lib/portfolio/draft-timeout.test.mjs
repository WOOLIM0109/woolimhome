import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as checkpoint from "./checkpoint.ts";
import * as budget from "./draft-budget.ts";
import * as draftState from "./draft-state.ts";
import * as generation from "./pipeline-generation.ts";
import { portfolioDisplayState } from "./display-state.ts";

const compiled = ts.transpileModule(readFileSync(new URL("./job-runner.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledWriter = ts.transpileModule(readFileSync(new URL("./draft.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const NOW = 1_800_000_000_000;
const clone = (value) => JSON.parse(JSON.stringify(value));

function harness({ attempts = 0, continuations = 0, createDraft, onJobUpdate } = {}) {
  let now = NOW;
  let generationCalls = 0;
  let budgetCalls = 0;
  const updates = [];
  const metadata = {
    portfolioGenerationId: "generation-a",
    portfolioSourceFingerprint: "source-a",
    portfolioRuleVersion: "rule-a",
    portfolioStage: "design_completed",
  };
  const assets = ["thumbnail", "body_image"].map((kind, index) => ({
    kind, bucket: "rendered", path: `${kind}.png`, url: `https://example.test/${kind}.png`,
    caption: kind, slideIndexes: [index],
  }));
  const rows = {
    content_jobs: [{
      id: "draft-a", job_type: "draft", candidate_id: "candidate-a", work_item_id: "work-a",
      status: "queued", attempts, max_attempts: 3, result: { portfolioDraftContinuations: continuations },
      payload: { portfolioGenerationId: metadata.portfolioGenerationId },
      started_at: null, next_retry_at: null, error_message: null,
      created_at: new Date(NOW - 60_000).toISOString(), updated_at: new Date(NOW - 60_000).toISOString(),
    }, {
      id: "mockup-a", job_type: "mockup", candidate_id: "candidate-a", status: "completed",
      result: {
        sourceFingerprint: metadata.portfolioSourceFingerprint,
        portfolioRuleVersion: metadata.portfolioRuleVersion,
        portfolioGenerationId: metadata.portfolioGenerationId,
        visualReview: { suitable: true }, assets, portfolioMockup: {},
        localRedactionManifest: { slideCount: 2 }, redactionProof: {},
      },
    }],
    content_work_items: [{ id: "work-a", status: "draft_waiting", metadata, updated_at: new Date(NOW - 60_000).toISOString() }],
    portfolio_candidates: [{ id: "candidate-a", status: "processed", metadata: {}, updated_at: new Date(NOW - 60_000).toISOString() }],
  };
  const draft = { title: "제목", summary: "요약", bodyHtml: "<p>본문</p>", faq: [], tags: [], imageCaptions: [] };
  const output = { draft, validation: { issues: [] } };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.values = null; this.singleRow = false; }
    select() { return this; }
    update(values) { this.values = values; return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    neq(key, value) { this.filters.push((row) => row[key] !== value); return this; }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
    lt(key, value) { this.filters.push((row) => row[key] != null && row[key] < value); return this; }
    contains(key, values) { this.filters.push((row) => Object.entries(values).every(([name, value]) => row[key]?.[name] === value)); return this; }
    or() { return this; }
    order() { return this; }
    limit() { return this; }
    single() { this.singleRow = true; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    then(resolve, reject) {
      try {
        const matched = rows[this.table].filter((row) => this.filters.every((filter) => filter(row)));
        if (this.values) {
          updates.push({ table: this.table, values: clone(this.values), matched: matched.length });
          for (const row of matched) {
            Object.assign(row, clone(this.values));
            if (this.table === "content_jobs") onJobUpdate?.(row, this.values, { advance: (ms) => { now += ms; }, rows });
          }
        }
        return Promise.resolve({ data: clone(this.singleRow ? matched[0] || null : matched), error: null }).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    }
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const modules = {
    "@/lib/content-ops/data": { contentAdmin: () => ({ from: (table) => new Query(table) }) },
    "./restart-control": { assertPortfolioRestartApproved: async () => {} },
    "./draft-state": draftState,
    "./draft-budget": budget,
    "./checkpoint": checkpoint,
    "./pipeline-generation": generation,
    "./redaction-proof": {
      parseLocalRedactionManifest: (value) => value,
      isVerifiedPortfolioRedactionProof: () => true,
    },
    "../pc-worker/redaction-manifest": { manifestPublicTitles: () => [] },
    "./production-image-projection.ts": { assertLegacyPortfolioImageWriteAllowed: () => {} },
    "../content-ops/style-revision-rules": { createStyleRevisionStamp: () => ({}) },
    "@/lib/gemini/automation": {
      runBudgetedGeminiAutomation: async (options, work) => {
        budgetCalls += 1;
        assert.equal(options.plannedCalls, 3);
        return work();
      },
    },
    "./draft": {
      createPortfolioDraft: async (input) => {
        generationCalls += 1;
        return createDraft ? createDraft(input, { advance: (ms) => { now += ms; }, output, rows }) : output;
      },
    },
  };
  const context = { exports: {}, require: (id) => modules[id] || {}, Date: Clock, Error, console };
  vm.runInNewContext(compiled, context);
  return {
    run: (deadlineAt = now + 225_000) => context.exports.processNextPortfolioDraft(undefined, { deadlineAt }),
    advance: (ms) => { now += ms; }, rows, updates,
    job: rows.content_jobs[0], item: rows.content_work_items[0],
    get generationCalls() { return generationCalls; },
    get budgetCalls() { return budgetCalls; },
  };
}

test("a draft that cannot fit one image request is left queued without claiming or calling Gemini", async () => {
  for (const remaining of [65_001, budget.PORTFOLIO_DRAFT_VISION_TIMEOUT_MS, budget.PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS]) {
    const h = harness();
    assert.equal(await h.run(NOW + remaining), null);
    assert.equal(h.job.status, "queued");
    assert.equal(h.job.attempts, 0);
    assert.equal(h.generationCalls, 0);
    assert.equal(h.budgetCalls, 0);
    assert.equal(h.updates.length, 0);
  }
});

test("time spent saving the initial checkpoint yields before budgeted Gemini automation", async () => {
  const h = harness({
    onJobUpdate(_row, values, clock) {
      if (values.result?.draftStartedAt) clock.advance(90_000);
    },
  });
  const result = await h.run();
  assert.equal(result.checkpointed, true);
  assert.equal(h.job.status, "queued");
  assert.equal(h.job.started_at, null);
  assert.equal(h.job.attempts, 0);
  assert.equal(h.job.result.portfolioDraftContinuations, 1);
  assert.equal(h.generationCalls, 0);
  assert.equal(h.budgetCalls, 0);
});

test("saved draft progress survives repeated time yields without consuming failure attempts", async () => {
  const seenProgress = [];
  const h = harness({
    attempts: 1,
    createDraft: async (input, clock) => {
      seenProgress.push(input.progress?.attempt ?? 0);
      await input.onProgress({ attempt: (input.progress?.attempt || 0) + 1, generated: clock.output.draft, validation: { issues: ["보정 대기"] } });
      clock.advance(90_000);
      checkpoint.yieldPortfolioCheckpointIfNeeded(input.shouldYield);
      assert.fail("the next Gemini call must yield");
    },
  });
  for (let index = 0; index < 4; index += 1) {
    const result = await h.run();
    assert.equal(result.checkpointed, true);
    assert.equal(h.job.status, "queued");
    assert.equal(h.job.attempts, 1);
    assert.equal(h.job.result.portfolioDraftContinuations, index + 1);
    assert.equal(h.job.result.portfolioDraftProgress.attempt, index + 1);
  }
  assert.deepEqual(seenProgress, [0, 1, 2, 3]);
  assert.equal(h.generationCalls, 4);
});

test("an actual provider error counts one failed draft attempt and retains its original reason", async () => {
  const error = Object.assign(new Error("provider rejected the request"), { code: "GEMINI_PROVIDER_ERROR" });
  const h = harness({ attempts: 1, createDraft: async () => { throw error; } });
  await h.run();
  assert.equal(h.job.status, "draft_waiting");
  assert.equal(h.job.attempts, 2);
  assert.equal(h.job.last_error_code, error.code);
  assert.equal(h.job.error_message, error.message);
  assert.equal(h.job.result.portfolioDraftContinuations, 0);
  assert.equal(h.generationCalls, 1);
  assert.match(h.item.review_note, /provider rejected the request/);
});

test("the continuation cap stops automatic work with its own stored and visible reason", async () => {
  const h = harness({
    attempts: 1,
    continuations: draftState.PORTFOLIO_DRAFT_MAX_CONTINUATIONS - 1,
    createDraft: async (input, clock) => {
      clock.advance(90_000);
      checkpoint.yieldPortfolioCheckpointIfNeeded(input.shouldYield);
    },
  });
  await h.run();
  assert.equal(h.job.status, "draft_waiting");
  assert.equal(h.job.attempts, 1);
  assert.equal(h.job.result.portfolioDraftContinuations, draftState.PORTFOLIO_DRAFT_MAX_CONTINUATIONS);
  assert.equal(h.job.last_error_code, "PORTFOLIO_DRAFT_CONTINUATION_LIMIT");
  assert.ok(h.job.error_message);
  assert.ok(h.job.completed_at);
  assert.equal(h.item.metadata.draftLastErrorCode, h.job.last_error_code);
  assert.match(portfolioDisplayState(h.item).detail, /이어서|계속/);
  const calls = h.generationCalls;
  assert.equal(await h.run(), null);
  assert.equal(h.generationCalls, calls);
});

test("a completed draft retains the failure count while storing its generated result", async () => {
  const h = harness({ attempts: 1 });
  const result = await h.run();
  assert.equal(result.stage, "draft_completed");
  assert.equal(h.job.status, "completed");
  assert.equal(h.job.attempts, 1);
  assert.equal(h.job.result.generated.title, "제목");
  assert.equal(h.item.status, "review_required");
  assert.equal(h.generationCalls, 1);
});

test("yielding cannot overwrite a draft claimed by a newer execution", async () => {
  const h = harness({
    createDraft: async (input, clock) => {
      clock.rows.content_jobs[0].started_at = new Date(NOW + 1).toISOString();
      clock.advance(90_000);
      checkpoint.yieldPortfolioCheckpointIfNeeded(input.shouldYield);
    },
  });
  assert.equal(await h.run(), null);
  assert.equal(h.job.status, "running");
  assert.equal(h.job.started_at, new Date(NOW + 1).toISOString());
  assert.equal(h.job.result.portfolioDraftContinuations, 0);
});

test("one draft attempt reserves more time than either unchanged Gemini request timeout", () => {
  assert.equal(budget.PORTFOLIO_DRAFT_VISION_TIMEOUT_MS, 130_000);
  assert.equal(budget.PORTFOLIO_DRAFT_TEXT_TIMEOUT_MS, 55_000);
  assert.ok(budget.PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS > budget.PORTFOLIO_DRAFT_VISION_TIMEOUT_MS);
  assert.equal(budget.PORTFOLIO_DRAFT_ATTEMPT_BUDGET_MS,
    budget.PORTFOLIO_DRAFT_VISION_TIMEOUT_MS + budget.PORTFOLIO_DRAFT_FINALIZE_RESERVE_MS);
});

function writerHarness({ images = true, onImageDownload, generated } = {}) {
  const calls = [];
  let reads = 0;
  const validDraft = {
    title: "제목", summary: "요약",
    bodyHtml: Array.from({ length: 12 }, (_, index) => `${index < 5 ? "<h2>설명</h2>" : ""}<p>${"내용".repeat(110)}</p>`).join(""),
    faq: Array.from({ length: 4 }, () => ({ question: "질문", answer: "답변" })), tags: [], imageCaptions: ["그림"],
  };
  const query = {
    select() { reads += 1; return this; }, eq() { return this; }, neq() { return this; }, order() { return this; },
    limit: async () => ({ data: [], error: null }),
  };
  const modules = {
    "@/lib/content-ops/data": { contentAdmin: () => ({
      from: () => query,
      storage: { from: () => ({ download: async () => {
        onImageDownload?.();
        return { data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, error: null };
      } }) },
    }) },
    "./naver-blog": { fetchExistingDesignBlogTitles: async () => [] },
    "./gemini": { generateGeminiJson: async (parts, options) => { calls.push({ parts, options }); return generated || validDraft; } },
    "./draft-budget": budget,
    "./checkpoint": checkpoint,
    "@/lib/content-ops/editorial-style": { FRIENDLY_EDITORIAL_STYLE_RULES: "" },
    "@/lib/content-ops/editorial-policy": { editorialPublicationIssues: () => [] },
    "@/lib/content-ops/sentence-breaks-html": { insertSentenceBreaks: (value) => value },
    "@/lib/content-ops/portfolio-rules": { validatePortfolioBodyHtml: () => [] },
    "@/lib/security/html": { sanitizeGeneratedHtml: (value) => value, sanitizeInlineHtml: (value) => value },
    sharp: { default: () => ({ resize() { return this; }, jpeg() { return this; }, toBuffer: async () => Buffer.from("image") }) },
  };
  const context = { exports: {}, require: (id) => { assert.ok(modules[id], id); return modules[id]; }, Buffer, Error, console: { info() {} } };
  vm.runInNewContext(compiledWriter, context);
  return {
    calls, get reads() { return reads; },
    run: (extra = {}) => context.exports.createPortfolioDraft({
      review: { slideAssessments: [] },
      assets: images ? [{ kind: "body_image", bucket: "rendered", path: "image.png", url: "https://example.test/image.png", caption: "그림" }] : [],
      ...extra,
    }),
  };
}

test("the real draft writer uses the shared image and text request timeouts", async () => {
  for (const images of [true, false]) {
    const h = writerHarness({ images });
    await h.run();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].options.timeoutMs,
      images ? budget.PORTFOLIO_DRAFT_VISION_TIMEOUT_MS : budget.PORTFOLIO_DRAFT_TEXT_TIMEOUT_MS);
    assert.equal(h.calls[0].options.attempts, 1);
    assert.equal(h.calls[0].options.jsonAttempts, 1);
    assert.equal(h.calls[0].parts.some((part) => part.inlineData), images);
  }
});

test("the real draft writer yields before reads when no request can fit", async () => {
  const h = writerHarness();
  await assert.rejects(h.run({ shouldYield: () => true }), checkpoint.PortfolioCheckpointYield);
  assert.equal(h.calls.length, 0);
  assert.equal(h.reads, 0);
});

test("the real draft writer rechecks time after image preparation before its first paid call", async () => {
  let exhausted = false;
  const h = writerHarness({ onImageDownload: () => { exhausted = true; } });
  await assert.rejects(h.run({ shouldYield: () => exhausted }), checkpoint.PortfolioCheckpointYield);
  assert.equal(h.calls.length, 0);
});

test("the real draft writer saves one response then yields before a correction call that no longer fits", async () => {
  let exhausted = false;
  const progress = [];
  const h = writerHarness({ generated: { title: "제목", summary: "요약", bodyHtml: "<p>짧은 본문</p>", faq: [], tags: [], imageCaptions: [] } });
  await assert.rejects(h.run({
    shouldYield: () => exhausted,
    onProgress: (value) => { progress.push(value); exhausted = true; },
  }), checkpoint.PortfolioCheckpointYield);
  assert.equal(h.calls.length, 1);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].attempt, 1);
  assert.equal(progress[0].generated.title, "제목");
});
