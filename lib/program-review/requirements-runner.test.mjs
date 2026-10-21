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

/** Run the real orchestrator and proof/matching logic; replace network/database boundaries only. */
function harness({ programCount = 1, generate, budget, profilesError, queryHook, incomplete = false } = {}) {
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
    openchat_program_matches: [],
  };
  if (incomplete) tables.openchat_program_attachments.push({
    id: "pending-other", program_id: "program-0", text_content: null, file_name: "미완료.pdf",
    file_ext: "pdf", parent_id: null, text_status: "pending",
  });
  const attempts = new Set();
  const queries = [], writes = [], calls = [], budgetCalls = [], rpcCalls = [], savedMatches = [];
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
          await queryHook?.({ table, action, values, ...context() });
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
          if (name === "list_openchat_requirement_work") {
            assert.match(args.p_review_date, /^\d{4}-\d{2}-\d{2}$/);
            assert.ok(args.p_limit > 0 && args.p_limit <= 20);
            const rows = tables.openchat_programs.filter((program) => program.status !== "excluded"
              && (!program.deadline_at || Date.parse(program.deadline_at) >= now)
              && (!args.p_program_ids?.length || args.p_program_ids.includes(program.id)))
              .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
              .slice(0, args.p_limit);
            return { data: rows.map((row) => ({ ...row })), error: null };
          }
          const existing = tables.openchat_program_requirements.find((row) => row.program_id === args.p_program_id);
          const key = `${args.p_program_id}:${args.p_input_hash}`;
          if (name === "claim_openchat_requirement") {
            if (attempts.has(key) || existing?.status === "processing") return { data: false, error: null };
            attempts.add(key);
            const values = { program_id: args.p_program_id, input_hash: args.p_input_hash, status: "processing", requirements: null };
            if (existing) Object.assign(existing, values);
            else tables.openchat_program_requirements.push(values);
            return { data: true, error: null };
          }
          if (name === "release_openchat_requirement_budget") {
            tables.openchat_program_requirements = tables.openchat_program_requirements.filter((row) =>
              !(row.program_id === args.p_program_id && row.input_hash === args.p_input_hash && row.status === "processing"));
            attempts.delete(key);
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
    "../gemini/client": { async generateGeminiText(input) {
      calls.push(input);
      assert.equal(input.attempts, 1);
      assert.ok(input.timeoutMs > 0 && input.timeoutMs <= 80_000);
      return generate ? generate(input, context()) : { text: JSON.stringify(VALID_REQUIREMENTS) };
    } },
    "../gemini/json": { parseGeminiJson },
    "../gemini/automation": { GEMINI_AUTOMATION_MODEL: "test-model", GeminiAutomationBlocked,
      async runBudgetedGeminiAutomation(input, work) {
        budgetCalls.push(input); assert.equal(input.plannedCalls, 1);
        return budget ? budget(input, work, context()) : work();
      } },
    "./requirements": requirementHelpers,
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
  return { tables, attempts, calls, budgetCalls, rpcCalls, writes, queries, savedMatches, advance,
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
  const second = await h.run();
  assert.equal(second.reused, 1);
  assert.equal(second.extracted, 0);
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.calls[0].parts[0].text, /프로필에만 있는 예시기업/);
  assert.equal(JSON.stringify(h.tables.openchat_programs), originalPrograms);
  assert.ok(h.writes.every((write) => write.table === "openchat_program_requirements"));
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
  assert.equal(summaries.reduce((sum, summary) => sum + summary.extracted, 0), 1);
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

test("한 실행의 신규 유료 호출은 기본 2건이며 미처리 공고는 다음 실행에서 처리한다", async () => {
  const h = harness({ programCount: 3 });
  assert.equal((await h.run()).extracted, 2);
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
    if (!delayed && table === "openchat_program_attachments" && action === "select") { advance(175_000); delayed = true; }
  } });
  const summary = await h.run();
  assert.equal(summary.stoppedForTime, true);
  assert.equal(h.calls.length, 0);
  assert.equal(h.attempts.size, 0);
});

test("예산 사전 조회가 늦어져도 callback 직전 재검사하고 무과금 claim을 해제한다", async () => {
  const h = harness({ budget: async (_input, work, { advance }) => { advance(160_000); return work(); } });
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
  const summary = await h.run();
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
  assert.equal(work.args.p_limit, 20);
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
    assert.equal((await h.run()).matched, 0);
    assert.equal(h.savedMatches.length, 0);
  }
});
