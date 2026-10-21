import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as requirementHelpers from "./requirements.ts";
import { parseGeminiJson } from "../gemini/json.ts";
import { matchProgram } from "./matching.ts";

const compiled = ts.transpileModule(readFileSync(new URL("./requirements-runner.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

const SOURCE = "[para.1] 부산광역시 소재 중소기업을 지원한다.";
const VALID_REQUIREMENTS = {
  regions: ["부산광역시"], target_types: ["중소기업"],
  evidence: {
    "regions.0": "[source:0:detail para.1] 부산광역시 소재 중소기업을 지원한다.",
    "target_types.0": "[source:0:detail para.1] 부산광역시 소재 중소기업을 지원한다.",
  },
};
const PROFILE = {
  targetKind: "self", targetId: "self-example", targetName: "프로필에만 있는 예시기업",
  region: null, foundedOn: null, businessType: null, industries: null, employees: null,
  revenueKrw: null, certifications: null, hasSupportHistory: false,
  missingFields: ["region", "foundedOn", "industries", "certifications"],
};

class GeminiAutomationBlocked extends Error {}
class MatchProfilesError extends Error {
  constructor(code, message = "고객 조회 상세 진단") { super(message); this.code = code; }
}
class RequirementGenerationError extends Error {
  constructor(safeDiagnostics) { super("공고 요건 응답 생성 실패"); this.safeDiagnostics = safeDiagnostics; }
}

/** Run the real orchestrator and proof/matching logic; replace network/database boundaries only. */
function harness({ programCount = 1, generate, budget, profilesError, queryHook, rpcHook, incomplete = false, leaseBusy = false, normalizeError = false } = {}) {
  let now = Date.parse("2026-10-21T12:30:00+09:00");
  const tables = {
    openchat_programs: Array.from({ length: programCount }, (_, index) => ({
      id: `program-${index}`, deadline_at: null, status: "review_required",
      created_at: new Date(now - index * 1000).toISOString(),
    })),
    openchat_program_attachment_discovery: Array.from({ length: programCount }, (_, index) => ({
      program_id: `program-${index}`, status: "found", detail_text: SOURCE,
    })),
    openchat_program_attachments: Array.from({ length: programCount }, (_, index) => ({
      id: `attachment-${index}`, program_id: `program-${index}`, text_content: "[p.1]\n공개 공고 첨부 문서",
      sha256: "public-document-content-hash", file_name: "공고문.pdf", file_ext: "pdf", parent_id: null, text_status: "extracted",
    })),
    openchat_program_requirements: [],
    openchat_program_requirement_attempts: [],
    openchat_program_requirement_recoveries: [],
    openchat_program_matches: [],
  };
  if (incomplete) tables.openchat_program_attachments.push({
    id: "pending-other", program_id: "program-0", text_content: null, file_name: "미완료.pdf",
    file_ext: "pdf", parent_id: null, text_status: "pending",
  });
  const attempts = new Set();
  const queries = [], writes = [], calls = [], budgetCalls = [], rpcCalls = [], savedMatches = [], jobCalls = [];
  let leaseHeld = leaseBusy;
  const advance = (milliseconds) => { now += milliseconds; };
  const context = () => ({ advance, tables, attempts, calls, writes, savedMatches });

  function query(table) {
    assert.ok(table in tables, `Unexpected table ${table}`);
    let action = "select", values, single = false, maximum = Infinity, outcome, fields;
    const filters = [], orders = [];
    const builder = {
      select(value) { if (value) fields = value; return this; },
      update(value) { action = "update"; values = value; return this; },
      insert(value) { action = "insert"; values = value; return this; },
      upsert(value) { action = "upsert"; values = value; return this; },
      delete() { action = "delete"; return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; },
      neq(key, value) { filters.push((row) => row[key] !== value); return this; },
      gte(key, value) { filters.push((row) => row[key] >= value); return this; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return this; },
      or(expression) {
        assert.equal(typeof expression, "string");
        if (table === "openchat_programs") filters.push((row) => !row.deadline_at || Date.parse(row.deadline_at) >= now);
        return this;
      },
      order(key, options = {}) { orders.push([key, options.ascending !== false]); return this; },
      limit(value) { maximum = value; return this; },
      abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
      maybeSingle() { single = true; return this; },
      single() { single = true; return this; },
      then(resolve, reject) {
        outcome ||= Promise.resolve().then(async () => {
          queries.push({ table, action, fields, maximum });
          const hook = await queryHook?.({ table, action, values, ...context() });
          if (hook?.result) return hook.result;
          let rows = tables[table].filter((row) => filters.every((filter) => filter(row)));
          if (action === "update") rows.forEach((row) => Object.assign(row, values));
          if (action === "delete") tables[table] = tables[table].filter((row) => !rows.includes(row));
          if (action === "insert" || action === "upsert") {
            rows = Array.isArray(values) ? values : [values];
            tables[table].push(...rows);
          }
          if (action !== "select") writes.push({ table, action, values });
          rows = [...rows].sort((a, b) => {
            for (const [key, ascending] of orders) {
              if (a[key] < b[key]) return ascending ? -1 : 1;
              if (a[key] > b[key]) return ascending ? 1 : -1;
            }
            return 0;
          }).slice(0, maximum);
          return { data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map((row) => ({ ...row })), error: null };
        });
        return outcome.then(resolve, reject);
      },
    };
    return builder;
  }

  function rpc(name, args) {
    let outcome;
    return {
      abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
      then(resolve, reject) {
        outcome ||= Promise.resolve().then(() => {
          rpcCalls.push({ name, args });
          const hook = rpcHook?.({ name, args, ...context() });
          if (hook?.result) return hook.result;
          if (name === "list_openchat_requirement_work") {
            assert.match(args.p_review_date, /^\d{4}-\d{2}-\d{2}$/);
            assert.ok(args.p_limit > 0 && args.p_limit <= 100);
            assert.equal(typeof args.p_include_excluded, "boolean");
            const rows = tables.openchat_programs.filter((program) => (args.p_include_excluded || program.status !== "excluded")
              && (!program.deadline_at || Date.parse(program.deadline_at) >= now)
              && (!args.p_program_ids?.length || args.p_program_ids.includes(program.id)))
              .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
              .slice(0, args.p_limit);
            return { data: rows.map((row) => ({ ...row })), error: null };
          }
          if (name === "openchat_review_queue_status") {
            const rows = tables.openchat_programs.filter((program) => (args.p_include_excluded || program.status !== "excluded")
              && (!program.deadline_at || Date.parse(program.deadline_at) >= now));
            const statuses = rows.map((program) => tables.openchat_program_requirements.find((row) => row.program_id === program.id)?.status);
            const withText = rows.filter((program) => tables.openchat_program_attachments.some((a) => a.program_id === program.id && a.text_status === "extracted")).length;
            return { data: { eligible: rows.length, withText, waitingAttachments: rows.length - withText,
              requirementsExtracted: statuses.filter((status) => status === "extracted").length,
              requirementsFailed: statuses.filter((status) => status === "failed").length,
              ready: statuses.filter((status) => status === undefined).length,
              remaining: statuses.filter((status) => status !== "extracted").length, pendingInputChars: withText * 100 }, error: null };
          }
          const existing = tables.openchat_program_requirements.find((row) => row.program_id === args.p_program_id);
          const key = `${args.p_program_id}:${args.p_input_hash}`;
          if (name === "claim_openchat_requirement") {
            if (attempts.has(key) || existing?.status === "processing") return { data: false, error: null };
            attempts.add(key);
            tables.openchat_program_requirement_attempts.push({ program_id: args.p_program_id, input_hash: args.p_input_hash });
            const values = { program_id: args.p_program_id, input_hash: args.p_input_hash, status: "processing", requirements: null };
            if (existing) Object.assign(existing, values);
            else tables.openchat_program_requirements.push(values);
            return { data: true, error: null };
          }
          if (name === "release_openchat_requirement_budget") {
            tables.openchat_program_requirements = tables.openchat_program_requirements.filter((row) =>
              !(row.program_id === args.p_program_id && row.input_hash === args.p_input_hash && row.status === "processing"));
            attempts.delete(key);
            tables.openchat_program_requirement_attempts = tables.openchat_program_requirement_attempts.filter((row) =>
              !(row.program_id === args.p_program_id && row.input_hash === args.p_input_hash));
            return { data: null, error: null };
          }
          if (name === "claim_openchat_requirement_recovery") {
            if (existing?.input_hash !== args.p_input_hash || existing.status !== "failed"
              || tables.openchat_program_requirement_recoveries.some((row) => row.program_id === args.p_program_id && row.input_hash === args.p_input_hash)) return { data: null, error: null };
            const recovery = { id: `recovery-${tables.openchat_program_requirement_recoveries.length}`, program_id: args.p_program_id, input_hash: args.p_input_hash };
            tables.openchat_program_requirement_recoveries.push(recovery);
            Object.assign(existing, { status: "processing", requirements: null, error: null });
            return { data: recovery.id, error: null };
          }
          if (name === "release_openchat_requirement_recovery_budget") {
            const recovery = tables.openchat_program_requirement_recoveries.find((row) => row.id === args.p_recovery_id && !row.responded_at);
            if (recovery) {
              tables.openchat_program_requirement_recoveries = tables.openchat_program_requirement_recoveries.filter((row) => row !== recovery);
              const canonical = tables.openchat_program_requirements.find((row) => row.program_id === recovery.program_id && row.input_hash === recovery.input_hash);
              if (canonical) canonical.status = "failed";
            }
            return { data: null, error: null };
          }
          if (name === "save_openchat_program_matches") {
            if (args.p_input_hash !== undefined && (!existing || existing.input_hash !== args.p_input_hash || existing.status !== "extracted")) {
              return { data: false, error: null };
            }
            savedMatches.push(structuredClone(args));
            return { data: true, error: null };
          }
          assert.fail(`Unexpected RPC ${name}`);
        });
        return outcome.then(resolve, reject);
      },
    };
  }
  const admin = { from: query, rpc };
  const exports = {};
  const dependencies = {
    "@supabase/supabase-js": { createClient() { assert.fail("Real database client is forbidden in runner tests"); } },
    "../supabase/admin": { createAdminClient() { assert.fail("Real database access is forbidden in runner tests"); } },
    "../gemini/json": { parseGeminiJson },
    "../gemini/automation": { GEMINI_AUTOMATION_MODEL: "test-model", GeminiAutomationBlocked,
      async runBudgetedGeminiAutomation(input, work) {
        budgetCalls.push(input); assert.equal(input.plannedCalls, 1);
        return budget ? budget(input, work, context()) : work();
      } },
    "./requirements": { ...requirementHelpers, normalizeRequirements: (...args) => {
      if (normalizeError) throw new Error("private proof diagnostic");
      return requirementHelpers.normalizeRequirements(...args);
    } },
    "./requirements-generation": { REQUIREMENTS_RESPONSE_MAX_TOKENS: 16_000, RequirementGenerationError,
      async generateRequirementResponse(input, options) {
        const request = { input, timeoutMs: options.timeoutMs, attempts: 1, parts: [{ text: requirementHelpers.requirementsPrompt(input) }] };
        calls.push(request);
        assert.ok(request.timeoutMs > 0 && request.timeoutMs <= 80_000);
        const result = generate ? await generate(request, context()) : { text: JSON.stringify(VALID_REQUIREMENTS) };
        return { rawText: result.rawText ?? result.text, finishReason: result.finishReason === undefined ? "STOP" : result.finishReason,
          safeDiagnostics: result.safeDiagnostics ?? { code: null, status: 200, finishReason: result.finishReason ?? "STOP", usage: { inputTokens: 100, outputTokens: 50 } } };
      } },
    "./jobs": { async withReviewJob(client, task, work) {
      assert.equal(client, admin); assert.equal(task, "requirements"); jobCalls.push(task);
      if (leaseHeld) return { leaseBusy: true, status: "skipped" };
      leaseHeld = true;
      try { return await work(); } finally { leaseHeld = false; }
    } },
    "./profiles-run": { MatchProfilesError, async loadMatchProfiles() {
      if (profilesError) throw profilesError;
      return [structuredClone(PROFILE)];
    } },
    "./matching": { matchProgram },
  };
  vm.runInNewContext(compiled, {
    exports, require(name) { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
    Buffer, AbortSignal, Date, Error, Math, process: { env: {} },
    fetch() { assert.fail("Real network requests are forbidden in runner tests"); },
  });
  return { tables, attempts, calls, budgetCalls, rpcCalls, writes, queries, savedMatches, jobCalls, advance,
    run: (options = {}) => exports.runRequirementsTask({ admin, now: () => now, ...options }) };
}

test("동일 원문은 유료 호출 1회 뒤 재사용하고 프로필 정보는 모델에 보내지 않는다", async () => {
  const h = harness();
  const originalPrograms = JSON.stringify(h.tables.openchat_programs);
  const first = await h.run();
  assert.equal(first.extracted, 1);
  assert.equal(first.matched, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.tables.openchat_program_requirements[0].status, "extracted");
  assert.equal(h.tables.openchat_program_requirements[0].normalization_version, requirementHelpers.REQUIREMENTS_NORMALIZATION_VERSION);
  const second = await h.run();
  assert.equal(second.reused, 1);
  assert.equal(second.extracted, 0);
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.calls[0].parts[0].text, /프로필에만 있는 예시기업/);
  assert.equal(JSON.stringify(h.tables.openchat_programs), originalPrograms);
  assert.ok(h.writes.every((write) => ["openchat_program_requirements", "openchat_program_requirement_attempts"].includes(write.table)));
});

test("첨부 글자 변경 때만 새로운 입력 해시로 다시 1회 추출한다", async () => {
  const h = harness();
  await h.run();
  const originalHash = h.tables.openchat_program_requirements[0].input_hash;
  h.tables.openchat_program_attachments[0].text_content += "\n[p.2]\n정정 공고문이 추가되었다.";
  const second = await h.run();
  assert.equal(second.extracted, 1);
  assert.notEqual(h.tables.openchat_program_requirements[0].input_hash, originalHash);
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(h.attempts.size, 2);
});

test("동시 실행도 같은 원문에 대한 모델 호출과 결과 저장은 한 번이다", async () => {
  const h = harness();
  const summaries = await Promise.all([h.run(), h.run()]);
  assert.equal(h.calls.length, 1);
  assert.equal(summaries.reduce((sum, summary) => sum + (summary.extracted ?? 0), 0), 1);
  assert.equal(summaries.filter((summary) => summary.leaseBusy).length, 1);
  assert.equal(h.attempts.size, 1);
});

test("예산 거부는 Gemini를 호출하지 않고 claim을 해제하여 다음 실행에서 재개한다", async () => {
  let blocked = true;
  const h = harness({ budget: async (_input, work) => {
    if (blocked) throw new GeminiAutomationBlocked("예산 한도");
    return work();
  } });
  const first = await h.run();
  assert.equal(first.budgetSkipped, 1);
  assert.equal(first.failed, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.attempts.size, 0);
  blocked = false;
  assert.equal((await h.run()).extracted, 1);
  assert.equal(h.calls.length, 1);
});

test("모델 실패·잘린 JSON은 고정 실패 이력으로 남기고 같은 원문을 재호출하지 않는다", async () => {
  for (const generate of [async () => { throw new Error("provider diagnostic that must not escape"); }, async () => ({ text: '{"broken":' })]) {
    const h = harness({ generate });
    const first = await h.run();
    assert.equal(first.failed, 1);
    assert.equal(first.extracted, 0);
    assert.equal(h.savedMatches.length, 0);
    assert.equal(h.tables.openchat_program_requirements[0].status, "failed");
    assert.doesNotMatch(h.tables.openchat_program_requirements[0].error, /provider diagnostic|broken/);
    const second = await h.run();
    assert.equal(second.alreadyAttempted, 1);
    assert.equal(h.calls.length, 1);
  }
});

test("명시한 batch 제한을 지키며 미처리 공고는 다음 실행에서 처리한다", async () => {
  const h = harness({ programCount: 3 });
  assert.equal((await h.run({ limit: 2 })).extracted, 2);
  assert.equal(h.calls.length, 2);
  assert.equal(h.attempts.size, 2);
  const second = await h.run();
  assert.equal(second.reused, 2);
  assert.equal(second.extracted, 1);
  assert.equal(h.calls.length, 3);
});

test("고객 프로필 갱신 보류·실패 상태에서 요건 호출이나 임의 자사 전용 매칭을 하지 않는다", async () => {
  const pending = harness({ profilesError: new MatchProfilesError("refresh_pending") });
  assert.equal((await pending.run()).refreshPending, true);
  assert.equal(pending.calls.length, 0);
  assert.equal(pending.queries.length, 0);
  const failed = harness({ profilesError: new MatchProfilesError("api_auth") });
  await assert.rejects(() => failed.run(), { message: "고객 프로필을 확인하지 못해 요건 추출·매칭을 보류했습니다." });
  assert.equal(failed.calls.length, 0);
  assert.equal(failed.savedMatches.length, 0);
});

test("위조 근거는 null로 정규화되고 근거 부족·프로필 부족은 unknown 이유로 남는다", async () => {
  const h = harness({ generate: async () => ({ text: JSON.stringify({
    regions: ["서울"], target_types: ["대학"], evidence: {
      "regions.0": "[source:0:detail p.999] 서울만 가능하다.",
      "target_types.0": "[source:0:detail para.1] 대학만 가능하다.",
    },
  }) }) });
  await h.run();
  const saved = h.tables.openchat_program_requirements[0].requirements;
  assert.equal(saved.regions, null);
  assert.equal(saved.target_types, null);
  assert.equal(saved.evidence, null);
  assert.equal(h.savedMatches[0].p_matches[0].verdict, "unknown");
  assert.match(h.savedMatches[0].p_matches[0].reasons.join(" "), /확정 근거 정보 부족/);
});

test("원문 조회 지연 후 호출 여유가 부족하면 claim·유료 호출을 시작하지 않는다", async () => {
  let delayed = false;
  const h = harness({ queryHook: ({ table, action, advance }) => {
    if (!delayed && table === "openchat_program_attachments" && action === "select") { advance(185_000); delayed = true; }
  } });
  const summary = await h.run();
  assert.equal(summary.stoppedForTime, true);
  assert.equal(h.calls.length, 0);
  assert.equal(h.attempts.size, 0);
});

test("예산 사전 조회가 늦어져도 callback 직전 재검사하고 무과금 claim을 해제한다", async () => {
  const h = harness({ budget: async (_input, work, { advance }) => { advance(185_000); return work(); } });
  const summary = await h.run();
  assert.equal(summary.stoppedForTime, true);
  assert.equal(h.calls.length, 0);
  assert.equal(h.attempts.size, 0);
  assert.equal(h.savedMatches.length, 0);
});

test("다른 입력 버전이 행을 바꾸어 저장 UPDATE가 0행이면 옛 요건 매칭을 저장하지 않는다", async () => {
  let replaced = false;
  const h = harness({ queryHook: ({ table, action, values, tables }) => {
    if (!replaced && table === "openchat_program_requirements" && action === "update" && values.status === "extracted") {
      tables.openchat_program_requirements[0].input_hash = "newer-input-version";
      tables.openchat_program_requirements[0].status = "processing";
      replaced = true;
    }
  } });
  const summary = await h.run();
  assert.equal(summary.extracted, 0);
  assert.equal(h.savedMatches.length, 0);
  assert.equal(h.tables.openchat_program_requirements[0].input_hash, "newer-input-version");
});

test("첨부가 일부 미완료이면 추출 원문의 배제 판정도 unknown과 정독 사유로 보수화한다", async () => {
  const h = harness({ incomplete: true, generate: async () => ({ text: JSON.stringify({
    target_types: ["대학"], evidence: { "target_types.0": "[source:0:detail para.1] 대학만 신청할 수 있다." },
  }) }) });
  h.tables.openchat_program_attachment_discovery[0].detail_text = "[para.1] 대학만 신청할 수 있다.";
  await h.run();
  assert.equal(h.tables.openchat_program_requirements[0].source_complete, false);
  const match = h.savedMatches[0].p_matches[0];
  assert.equal(match.verdict, "unknown");
  assert.match(match.reasons.join(" "), /첨부 일부 미추출/);
  assert.match(match.reasons.join(" "), /기관.*전용/);
});

test("60000자 절단 상태를 기록하고 확정 배제 대신 unknown·절단 사유를 남긴다", async () => {
  const h = harness({ generate: async () => ({ text: JSON.stringify({
    target_types: ["대학"], evidence: { "target_types.0": "[source:0:detail para.1] 대학만 신청할 수 있다." },
  }) }) });
  h.tables.openchat_program_attachment_discovery[0].detail_text = "[para.1] 대학만 신청할 수 있다.\n[para.2] " + "공개 자료 ".repeat(15_000);
  await h.run();
  const row = h.tables.openchat_program_requirements[0];
  assert.equal(row.input_truncated, true);
  assert.equal(row.source_complete, true);
  assert.equal(h.savedMatches[0].p_matches[0].verdict, "unknown");
  assert.match(h.savedMatches[0].p_matches[0].reasons.join(" "), /6만 자 절단/);
});

test("미추출 ZIP 부모의 실패를 다른 PDF 성공으로 완전 원문이라고 표시하지 않는다", async () => {
  const h = harness();
  h.tables.openchat_program_attachments.push({ id: "failed-archive", program_id: "program-0", parent_id: null,
    file_name: "추가서류.zip", file_ext: "zip", text_status: "failed", text_content: null, error: "ZIP 해제 실패" });
  await h.run();
  assert.equal(h.tables.openchat_program_requirements[0].source_complete, false);
  assert.equal(h.savedMatches[0].p_matches[0].verdict, "unknown");
  assert.match(h.savedMatches[0].p_matches[0].reasons.join(" "), /첨부 일부 미추출/);
});

test("요건 저장과 매칭 저장은 같은 입력 해시를 전달한다", async () => {
  const h = harness();
  await h.run();
  assert.match(h.savedMatches[0].p_input_hash, /^[a-f0-9]{64}$/);
  assert.equal(h.savedMatches[0].p_input_hash, h.tables.openchat_program_requirements[0].input_hash);
});

test("같은 텍스트 재사용 때 새 미완료 첨부의 완전성 메타와 매칭 사유를 갱신한다", async () => {
  const h = harness();
  await h.run();
  assert.equal(h.tables.openchat_program_requirements[0].source_complete, true);
  h.tables.openchat_program_attachments.push({ id: "new-pending", program_id: "program-0", parent_id: null,
    file_name: "추가.pdf", file_ext: "pdf", text_status: "pending", text_content: null });
  const second = await h.run();
  assert.equal(second.reused, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.tables.openchat_program_requirements[0].source_complete, false);
  assert.match(h.savedMatches.at(-1).p_matches[0].reasons.join(" "), /첨부 일부 미추출/);
});

test("제외되었거나 이미 마감된 공고의 요건 추출·매칭을 시작하지 않는다", async () => {
  const h = harness({ programCount: 2 });
  h.tables.openchat_programs[0].status = "excluded";
  h.tables.openchat_programs[1].deadline_at = "2026-10-20T18:00:00+09:00";
  const summary = await h.run({ includeExcluded: false });
  assert.equal(summary.considered, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.savedMatches.length, 0);
  assert.equal(h.attempts.size, 0);
});

test("DB 작업목록 RPC로 대상 ID를 전달하며 최신 공고 80개 직접 조회에 의존하지 않는다", async () => {
  const h = harness({ programCount: 3 });
  await h.run({ programIds: ["program-2"] });
  const work = h.rpcCalls.find((rpc) => rpc.name === "list_openchat_requirement_work");
  assert.ok(work);
  assert.equal(work.args.p_review_date, "2026-10-21");
  assert.equal(work.args.p_limit, 100);
  assert.equal(work.args.p_include_excluded, true);
  assert.deepEqual(Array.from(work.args.p_program_ids), ["program-2"]);
  assert.ok(h.queries.every((query) => query.table !== "openchat_programs" || query.fields === "status,deadline_at"));
  assert.equal(h.calls.length, 1);
  assert.equal(h.tables.openchat_program_requirements[0].program_id, "program-2");
});

test("요건 생성 도중 마감 시각이 지나면 매칭을 저장하지 않는다", async () => {
  const h = harness({ generate: async (_input, { advance }) => {
    advance(40_000);
    return { text: JSON.stringify(VALID_REQUIREMENTS) };
  } });
  h.tables.openchat_programs[0].deadline_at = "2026-10-21T12:30:30+09:00";
  const summary = await h.run();
  assert.equal(summary.extracted, 1);
  assert.equal(summary.matched, 0);
  assert.equal(h.savedMatches.length, 0);
});

test("생성 도중 공고가 제외되거나 마감값이 바뀌면 저장 직전 최신 상태를 확인한다", async () => {
  for (const mutate of [(program) => { program.status = "excluded"; }, (program) => { program.deadline_at = "2026-10-20T18:00:00+09:00"; }]) {
    const h = harness({ generate: async (_input, { tables }) => {
      mutate(tables.openchat_programs[0]);
      return { text: JSON.stringify(VALID_REQUIREMENTS) };
    } });
    assert.equal((await h.run({ includeExcluded: false })).matched, 0);
    assert.equal(h.savedMatches.length, 0);
  }
});

test("기본 batch는 50개 이상을 처리하고 최대 100개를 넘지 않는다", async () => {
  const h = harness({ programCount: 55 });
  const result = await h.run();
  assert.equal(result.extracted, 55);
  assert.equal(result.matched, 55);
  assert.equal(result.queued, 55);
  assert.equal(result.scopeProgramCount, 55);
  assert.equal(result.requirementsExtracted, 55);
  assert.equal(result.remaining, 0);
  assert.equal(h.calls.length, 55);
  assert.ok(h.budgetCalls.every((call) => call.estimatedOutputTokens === 16_000));
  const capped = harness({ programCount: 101 });
  assert.equal((await capped.run({ limit: 1000 })).extracted, 100);
  assert.equal(capped.calls.length, 100);
});

test("수동 검토는 기존 제외 상태도 처리하며 76개 대상 ID와 전체·범위 건수를 구분한다", async () => {
  const h = harness({ programCount: 80 });
  h.tables.openchat_programs[0].status = "excluded";
  const programIds = Array.from({ length: 76 }, (_, index) => `program-${index}`);
  const result = await h.run({ programIds });
  assert.equal(result.extracted, 76);
  assert.equal(result.matched, 76);
  assert.equal(result.eligible, 80);
  assert.equal(result.remaining, 4);
  assert.equal(result.scopeProgramCount, 76);
  assert.equal(result.queued, 76);
  assert.equal(h.tables.openchat_programs[0].status, "excluded");
  assert.deepEqual(Array.from(h.rpcCalls.find((rpc) => rpc.name === "list_openchat_requirement_work").args.p_program_ids), programIds);
});

test("전역 lease가 사용 중이면 원문·프로필·모델 처리를 시작하지 않는다", async () => {
  const h = harness({ leaseBusy: true });
  const result = await h.run();
  assert.equal(result.leaseBusy, true);
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(h.queries.length, 0);
  assert.deepEqual(h.jobCalls, ["requirements"]);
});

test("유료 호출 전 원문 메타를 저장하고 MAX_TOKENS 원문은 파싱 전에 보존한다", async () => {
  const rawText = '{"regions":["부산광역시"],"unfinished":';
  const h = harness({ generate: async (_request, { tables }) => {
    const row = tables.openchat_program_requirements[0];
    assert.equal(row.source_complete, true);
    assert.equal(row.input_truncated, false);
    assert.equal(row.source_manifest.length, 2);
    assert.equal(row.source_checked_at, "2026-10-21T03:30:00.000Z");
    assert.equal(row.diagnostics.stage, "before_call");
    return { rawText, finishReason: "MAX_TOKENS", safeDiagnostics: {
      code: null, status: 200, finishReason: "MAX_TOKENS", usage: { outputTokens: 16000 },
    } };
  } });
  const result = await h.run();
  const row = h.tables.openchat_program_requirements[0];
  const artifact = h.tables.openchat_program_requirement_attempts[0];
  assert.equal(result.failed, 1);
  assert.equal(row.error, "REQUIREMENTS_MAX_TOKENS");
  assert.equal(row.diagnostics.stage, "finish_failed");
  assert.equal(row.diagnostics.finishReason, "MAX_TOKENS");
  assert.equal(artifact.response_text, rawText);
  assert.ok(artifact.responded_at);
  assert.equal(h.savedMatches.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /unfinished|response_text|diagnostics|source_manifest/);
  assert.equal((await h.run()).alreadyAttempted, 1);
  assert.equal(h.calls.length, 1);
});

test("STOP 이외 종료는 완성 JSON이어도 고정 실패이며 원문을 보존한다", async () => {
  for (const finishReason of [null, "SAFETY", "RECITATION"]) {
    const h = harness({ generate: async () => ({ text: JSON.stringify(VALID_REQUIREMENTS), finishReason }) });
    const result = await h.run();
    assert.equal(result.extracted, 0);
    assert.equal(result.failed, 1);
    assert.equal(h.tables.openchat_program_requirements[0].error, "REQUIREMENTS_FINISH_INCOMPLETE");
    assert.equal(h.tables.openchat_program_requirement_attempts[0].response_text, JSON.stringify(VALID_REQUIREMENTS));
    assert.equal(h.savedMatches.length, 0);
  }
});

test("JSON 오류와 근거 검증 오류를 구분하며 양쪽 모두 먼저 원문을 저장한다", async () => {
  for (const [options, expectedCode, expectedStage] of [
    [{ generate: async () => ({ text: '{"broken":' }) }, "REQUIREMENTS_JSON_INVALID", "json_invalid"],
    [{ normalizeError: true }, "REQUIREMENTS_PROOF_INVALID", "proof_invalid"],
  ]) {
    const h = harness(options);
    assert.equal((await h.run()).failed, 1);
    const row = h.tables.openchat_program_requirements[0];
    assert.equal(row.error, expectedCode);
    assert.equal(row.diagnostics.stage, expectedStage);
    const artifactIndex = h.writes.findIndex((write) => write.table === "openchat_program_requirement_attempts");
    const failureIndex = h.writes.findIndex((write) => write.values.status === "failed");
    assert.ok(artifactIndex >= 0 && failureIndex > artifactIndex);
    assert.ok(h.tables.openchat_program_requirement_attempts[0].responded_at);
    assert.doesNotMatch(JSON.stringify(row), /private proof diagnostic/);
  }
});

test("provider 실패는 허용 진단과 응답 시각만 저장하고 오류 메시지를 노출하지 않는다", async () => {
  const h = harness({ generate: async () => { throw new RequirementGenerationError({
    code: "GEMINI_RATE_LIMIT", status: 429, finishReason: null, usage: { inputTokens: 0 },
  }); } });
  const result = await h.run();
  assert.equal(result.failed, 1);
  const artifact = h.tables.openchat_program_requirement_attempts[0];
  assert.equal(artifact.response_text, null);
  assert.equal(artifact.diagnostics.code, "GEMINI_RATE_LIMIT");
  assert.equal(artifact.diagnostics.status, 429);
  assert.equal(artifact.diagnostics.stage, "generation_failed");
  assert.ok(artifact.responded_at);
  assert.ok(!h.rpcCalls.some((rpc) => rpc.name.startsWith("release_")));
});

test("명시적 실패 복구만 같은 해시를 한 번 더 호출하고 원래 시도 응답을 보존한다", async () => {
  let valid = false;
  const h = harness({ generate: async () => ({ text: valid ? JSON.stringify(VALID_REQUIREMENTS) : '{"broken":' }) });
  assert.equal((await h.run()).failed, 1);
  const original = structuredClone(h.tables.openchat_program_requirement_attempts[0]);
  assert.equal((await h.run()).alreadyAttempted, 1);
  valid = true;
  assert.equal((await h.run({ recoveryProgramId: "program-0" })).extracted, 1);
  assert.equal(h.calls.length, 2);
  assert.equal(JSON.stringify(h.tables.openchat_program_requirement_attempts[0]), JSON.stringify(original));
  assert.equal(h.tables.openchat_program_requirement_recoveries.length, 1);
  assert.equal(h.tables.openchat_program_requirement_recoveries[0].response_text, JSON.stringify(VALID_REQUIREMENTS));
  assert.equal(h.tables.openchat_program_requirements[0].diagnostics.stage, "stored");
  assert.equal((await h.run({ recoveryProgramId: "program-0" })).alreadyAttempted, 1);
  assert.equal(h.calls.length, 2);
});

test("복구 호출 전 예산·시간 보류는 복구 claim만 해제하고 원래 시도는 유지한다", async () => {
  for (const mode of ["budget", "time"]) {
    let deferred = false;
    const h = harness({ generate: async () => ({ text: '{"broken":' }), budget: async (_input, work, { advance }) => {
      if (deferred && mode === "budget") throw new GeminiAutomationBlocked("고정 예산 보류");
      if (deferred && mode === "time") advance(185_000);
      return work();
    } });
    await h.run();
    deferred = true;
    const result = await h.run({ recoveryProgramId: "program-0" });
    assert.equal(mode === "budget" ? result.budgetSkipped : result.stoppedForTime, mode === "budget" ? 1 : true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.attempts.size, 1);
    assert.equal(h.tables.openchat_program_requirement_attempts.length, 1);
    assert.equal(h.tables.openchat_program_requirement_recoveries.length, 0);
    assert.equal(h.tables.openchat_program_requirements[0].status, "failed");
    assert.equal(h.rpcCalls.filter((rpc) => rpc.name === "release_openchat_requirement_recovery_budget").length, 1);
    assert.equal(h.rpcCalls.filter((rpc) => rpc.name === "release_openchat_requirement_budget").length, 0);
  }
});

test("복구 네트워크 오류는 이미 소비한 복구를 해제하거나 재호출하지 않는다", async () => {
  let failNetwork = false;
  const h = harness({ generate: async () => {
    if (failNetwork) throw new Error("private provider diagnostic");
    return { text: '{"broken":' };
  } });
  await h.run();
  failNetwork = true;
  assert.equal((await h.run({ recoveryProgramId: "program-0" })).failed, 1);
  const recovery = h.tables.openchat_program_requirement_recoveries[0];
  assert.equal(recovery.response_text, null);
  assert.ok(recovery.responded_at);
  assert.equal((await h.run({ recoveryProgramId: "program-0" })).alreadyAttempted, 1);
  assert.equal(h.calls.length, 2);
  assert.ok(!h.rpcCalls.some((rpc) => rpc.name.startsWith("release_")));
  assert.doesNotMatch(JSON.stringify(h.tables.openchat_program_requirements), /private provider diagnostic/);
});

test("예산 조회 후 남은 시간에 맞게 모델 timeout을 줄이고 16000 토큰을 예산에 반영한다", async () => {
  const h = harness({ budget: async (_input, work, { advance }) => { advance(150_000); return work(); } });
  assert.equal((await h.run()).extracted, 1);
  assert.equal(h.calls[0].timeoutMs, 65_000);
  assert.equal(h.budgetCalls[0].estimatedOutputTokens, 16_000);
});

test("응답 원문 저장 실패는 고정 저장 오류로 중단하고 추가 모델 호출을 하지 않는다", async () => {
  const h = harness({ programCount: 2, queryHook: ({ table, action }) => {
    if (table === "openchat_program_requirement_attempts" && action === "update") return { result: { data: null, error: { message: "private database diagnostic" } } };
  } });
  await assert.rejects(() => h.run(), { message: "요건 응답 원문 저장 실패" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.tables.openchat_program_requirements[0].diagnostics.stage, "artifact_save_failed");
  assert.equal(h.savedMatches.length, 0);
  assert.doesNotMatch(JSON.stringify(h.tables.openchat_program_requirements), /private database diagnostic/);
});

test("canonical 저장 실패는 원문 응답을 보존하고 저장 단계 실패로 기록한다", async () => {
  const h = harness({ queryHook: ({ table, action, values }) => {
    if (table === "openchat_program_requirements" && action === "update" && values.status === "extracted") return { result: { data: null, error: { message: "private database diagnostic" } } };
  } });
  assert.equal((await h.run()).failed, 1);
  assert.equal(h.tables.openchat_program_requirements[0].error, "REQUIREMENTS_RESULT_SAVE_FAILED");
  assert.equal(h.tables.openchat_program_requirements[0].diagnostics.stage, "result_save_failed");
  assert.equal(h.tables.openchat_program_requirement_attempts[0].response_text, JSON.stringify(VALID_REQUIREMENTS));
  assert.equal(h.savedMatches.length, 0);
  assert.equal((await h.run()).alreadyAttempted, 1);
  assert.equal(h.calls.length, 1);
});

test("원문 확인 시각은 조회 시작이며 생성 도중 변경을 결과 저장 시각으로 가리지 않는다", async () => {
  const h = harness({ queryHook: ({ table, action, advance }) => {
    if (table === "openchat_program_attachments" && action === "select") advance(5_000);
  }, generate: async (_request, { advance, tables }) => {
    advance(5_000);
    tables.openchat_program_attachments[0].text_content += "\n[p.2]\n변경된 공개 첨부";
    return { text: JSON.stringify(VALID_REQUIREMENTS) };
  } });
  await h.run();
  const row = h.tables.openchat_program_requirements[0];
  assert.equal(row.source_checked_at, "2026-10-21T03:30:00.000Z");
  assert.equal(row.updated_at, "2026-10-21T03:30:10.000Z");
  assert.ok(Date.parse(row.source_checked_at) < Date.parse(row.updated_at));
  const latest = requirementHelpers.buildRequirementInput([
    { id: "0:detail", text: SOURCE }, { id: "1:attachment:attachment-0", text: h.tables.openchat_program_attachments[0].text_content },
  ]);
  assert.notEqual(row.input_hash, latest.inputHash);
});

test("같은 해시의 구버전 성공 JSON은 유료 재호출 없이 정규화2로 저장하고 다시 매칭한다", async () => {
  const base = "공고일 기준 업력 7년 이하 법인 및 예비창업자";
  const exception = "초격차 10대 분야 등 딥테크 분야 스타트업의 경우 업력 10년 이하";
  const h = harness();
  h.tables.openchat_program_attachment_discovery[0].detail_text = `${SOURCE}\n[para.2] ${base}\n[para.3] ${exception}`;
  await h.run();
  const row = h.tables.openchat_program_requirements[0];
  const hash = row.input_hash;
  row.normalization_version = 1;
  row.requirements = { ...row.requirements, business_age: { min_years: null, max_years: 7, basis: base },
    evidence: { ...row.requirements.evidence, "business_age.max_years": `[source:0:detail para.2] ${base}`,
      "business_age.basis": `[source:0:detail para.2] ${base}` } };
  const result = await h.run();
  assert.equal(result.reused, 1);
  assert.equal(result.extracted, 0);
  assert.equal(result.matched, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.attempts.size, 1);
  assert.equal(row.input_hash, hash);
  assert.equal(row.normalization_version, requirementHelpers.REQUIREMENTS_NORMALIZATION_VERSION);
  assert.equal(row.requirements.business_age.max_years, null);
  assert.equal(row.requirements.business_age.basis, null);
  assert.match(h.savedMatches.at(-1).p_matches[0].reasons.join(" "), /업력.*(?:경계|예외).*정독/);
  assert.equal(h.savedMatches.at(-1).p_matches[0].verdict, "unknown");
});

test("재정규화 canonical 저장 뒤 매칭 RPC가 실패해도 다음 실행은 같은 응답을 무과금 재사용하여 복구한다", async () => {
  let failMatch = false;
  const h = harness({ rpcHook: ({ name }) => failMatch && name === "save_openchat_program_matches"
    ? { result: { data: null, error: { code: "57014", message: "private database timeout diagnostic" } } } : null });
  await h.run();
  const row = h.tables.openchat_program_requirements[0];
  const hash = row.input_hash;
  const artifacts = JSON.stringify(h.tables.openchat_program_requirement_attempts);
  row.normalization_version = 2;
  failMatch = true;
  await assert.rejects(() => h.run(), { message: "대상별 매칭 저장 실패" });
  assert.equal(row.status, "extracted");
  assert.equal(row.normalization_version, requirementHelpers.REQUIREMENTS_NORMALIZATION_VERSION);
  assert.equal(row.input_hash, hash);
  assert.equal(h.calls.length, 1);
  assert.equal(h.savedMatches.length, 1);
  assert.equal(JSON.stringify(h.tables.openchat_program_requirement_attempts), artifacts);
  failMatch = false;
  const resumed = await h.run();
  assert.equal(resumed.reused, 1);
  assert.equal(resumed.matched, 1);
  assert.equal(resumed.extracted, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.savedMatches.length, 2);
  assert.equal(h.savedMatches.at(-1).p_input_hash, hash);
  assert.equal(JSON.stringify(h.tables.openchat_program_requirement_attempts), artifacts);
  assert.equal(h.tables.openchat_program_requirement_recoveries.length, 0);
});
