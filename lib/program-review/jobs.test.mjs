import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function harness(dispatch = (name) => ({ data: name.startsWith("claim_") ? JOB_ID : true, error: null })) {
  const calls = [];
  const admin = { rpc(name, args) {
    calls.push({ name, args });
    return { abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
      then(resolve, reject) { return Promise.resolve().then(() => dispatch(name, args)).then(resolve, reject); } };
  } };
  const compiled = ts.transpileModule(readFileSync(new URL("./jobs.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) { assert.equal(name, "node:crypto"); return crypto; }, AbortSignal, Date });
  return { ...exports, admin, calls };
}

test("review lease preserves the original result while logging only allowed counts, flags and a valid date", async () => {
  const h = harness();
  const result = { date: "2026-10-21", profiles: 5, queued: 50, remaining: 48, extracted: 2, matched: 2,
    failed: 0, stoppedForTime: false, refreshPending: false, providerResult: "sensitive-test-marker",
    customerName: "sensitive-test-marker", token: "sensitive-test-marker", error: "sensitive-test-marker" };
  assert.equal(await h.withReviewJob(h.admin, "requirements", async () => result), result);
  assert.equal(h.calls.length, 2);
  const [claim, finish] = h.calls;
  assert.equal(claim.name, "claim_openchat_program_review_job"); assert.equal(claim.args.p_task, "requirements");
  assert.match(claim.args.p_owner, UUID); assert.equal(finish.args.p_owner, claim.args.p_owner);
  assert.equal(finish.args.p_job_id, JOB_ID); assert.equal(finish.args.p_status, "completed");
  assert.equal(finish.args.p_error_code, null); assert.equal(finish.args.p_summary.extracted, 2);
  assert.equal(finish.args.p_summary.date, "2026-10-21");
  assert.doesNotMatch(JSON.stringify(finish.args.p_summary), /sensitive-test-marker|providerResult|customerName|token|error/);
});

test("an unavailable global lease skips work and never attempts a finish", async () => {
  const h = harness(() => ({ data: null, error: null })); let worked = false;
  const result = await h.withReviewJob(h.admin, "attachments", async () => { worked = true; return {}; });
  assert.equal(result.leaseBusy, true); assert.equal(result.status, "skipped");
  assert.equal(worked, false); assert.equal(h.calls.length, 1);
});

test("partial, blocked and completed statuses use a fixed priority over validated metrics", async () => {
  const cases = [[{ failed: 1, budgetSkipped: 2, refreshPending: true }, "partial"],
    [{ failed: 0, budgetSkipped: 1, refreshPending: true }, "blocked"], [{ refreshPending: true }, "partial"],
    [{ failed: 0, budgetSkipped: 0, stoppedForTime: true }, "completed"]];
  for (const [result, status] of cases) {
    const h = harness(); await h.withReviewJob(h.admin, "requirements", async () => result);
    assert.equal(h.calls[1].args.p_status, status);
  }
});

test("invalid count/date fields and arbitrary callback statuses are never persisted", async () => {
  const h = harness();
  await h.withReviewJob(h.admin, "attachments", async () => ({ failed: "sensitive-test-marker", processed: -1,
    extracted: Infinity, reused: NaN, expanded: 1.5, discovered: 2, zipCachePeakBytes: 100, leaseBusy: false,
    date: "2026-02-30", status: "sensitive-test-marker", error_code: "sensitive-test-marker" }));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1].args.p_summary)), { discovered: 2, zipCachePeakBytes: 100, leaseBusy: false });
  assert.equal(h.calls[1].args.p_status, "completed");
});

test("queue, token-budget and duration metrics are logged only as nonnegative safe integers", async () => {
  const h = harness();
  await h.withReviewJob(h.admin, "requirements", async () => ({ ready: 50, waitingAttachments: 4,
    eligible: 60, withText: 56, requirementsExtracted: 5, requirementsFailed: 1, pendingInputChars: 60_000,
    estimatedInputTokens: 20_000, estimatedOutputTokens: 16_000, remainingDailyCalls: 50,
    remainingMonthlyCalls: 500, elapsedMs: 1000, durationMs: 1100, remainingMs: 239_000,
    scopeProgramCount: 76, budgetRemainingCalls: -1, remainingDailyCost: 0.5, providerBudget: "sensitive-test-marker" }));
  const summary = h.calls[1].args.p_summary;
  for (const key of ["ready", "waitingAttachments", "eligible", "withText", "requirementsExtracted", "requirementsFailed",
    "pendingInputChars", "estimatedInputTokens", "estimatedOutputTokens", "remainingDailyCalls", "remainingMonthlyCalls",
    "elapsedMs", "durationMs", "remainingMs", "scopeProgramCount"]) assert.ok(Number.isSafeInteger(summary[key]) && summary[key] >= 0);
  assert.equal(summary.budgetRemainingCalls, undefined); assert.equal(summary.remainingDailyCost, undefined);
  assert.doesNotMatch(JSON.stringify(summary), /sensitive-test-marker|providerBudget/);
});

test("callback failures are rethrown unchanged only after a fixed-code failure record, without the error body", async () => {
  const h = harness(), original = new Error("provider body token=sensitive-test-marker");
  await assert.rejects(h.withReviewJob(h.admin, "requirements", async () => { throw original; }), error => error === original);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].args.p_status, "failed");
  assert.equal(h.calls[1].args.p_error_code, "REVIEW_JOB_FAILED");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1].args.p_summary)), {});
  assert.doesNotMatch(JSON.stringify(h.calls), /sensitive-test-marker/);
});

test("claim failures and malformed claim results never run work or disclose database diagnostics", async () => {
  const responses = [() => ({ data: null, error: { message: "sensitive-test-marker" } }),
    () => { throw new Error("sensitive-test-marker"); }, () => ({ data: "sensitive-test-marker", error: null }),
    () => ({ data: false, error: null })];
  for (const dispatch of responses) {
    const h = harness(dispatch); let worked = false;
    await assert.rejects(h.withReviewJob(h.admin, "requirements", async () => { worked = true; return {}; }),
      error => error.message === "REVIEW_JOB_CLAIM_FAILED");
    assert.equal(worked, false); assert.equal(h.calls.length, 1);
  }
});

test("finish failures produce one fixed error without retrying finish or rerunning work", async () => {
  for (const result of [false, { message: "sensitive-test-marker" }, "throw"]) {
    const h = harness((name) => {
      if (name.startsWith("claim_")) return { data: JOB_ID, error: null };
      if (result === "throw") throw new Error("sensitive-test-marker");
      return result === false ? { data: false, error: null } : { data: null, error: result };
    });
    let worked = 0;
    await assert.rejects(h.withReviewJob(h.admin, "attachments", async () => { worked++; return { processed: 1 }; }),
      error => error.message === "REVIEW_JOB_FINISH_FAILED");
    assert.equal(worked, 1); assert.equal(h.calls.length, 2);
  }
});

test("a failed failure-record write also hides the original provider diagnostics", async () => {
  const h = harness(name => ({ data: name.startsWith("claim_") ? JOB_ID : false, error: null }));
  await assert.rejects(h.withReviewJob(h.admin, "requirements", async () => { throw new Error("sensitive-test-marker"); }),
    error => error.message === "REVIEW_JOB_FINISH_FAILED");
  assert.equal(h.calls[1].args.p_status, "failed"); assert.equal(h.calls[1].args.p_error_code, "REVIEW_JOB_FAILED");
});

test("concurrent attachments and requirements share one lease; only the owner can finish", async () => {
  let activeOwner = null;
  const h = harness((name, args) => {
    if (name.startsWith("claim_")) {
      if (activeOwner) return { data: null, error: null };
      activeOwner = args.p_owner; return { data: JOB_ID, error: null };
    }
    assert.equal(args.p_owner, activeOwner); activeOwner = null; return { data: true, error: null };
  });
  let releaseWork;
  const running = h.withReviewJob(h.admin, "requirements", () => new Promise(resolve => { releaseWork = resolve; }));
  while (!releaseWork) await Promise.resolve();
  let secondWorked = false;
  const second = await h.withReviewJob(h.admin, "attachments", async () => { secondWorked = true; return {}; });
  assert.equal(second.leaseBusy, true); assert.equal(secondWorked, false);
  releaseWork({ extracted: 1 }); await running;
  assert.equal(activeOwner, null); assert.equal(h.calls.filter(call => call.name.startsWith("finish_")).length, 1);
});
