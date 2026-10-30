import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Exercise the real modules, including parameter properties that Node's
// strip-only loader cannot execute. This is the same CJS transform used by TS.
const nativeRequire = createRequire(import.meta.url), modules = new Map();
function load(url) {
  const key = String(url);
  if (modules.has(key)) return modules.get(key).exports;
  const compiledModule = { exports: {} }; modules.set(key, compiledModule);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const execute = new Function("module", "exports", "require", compiled);
  execute(compiledModule, compiledModule.exports, id => id.startsWith(".") ? load(new URL(id.endsWith(".ts") ? id : `${id}.ts`, url)) : nativeRequire(id));
  return compiledModule.exports;
}
const { ProgramAgentService } = load(new URL("./agent-api.ts", import.meta.url));
const { ProgramApiError } = load(new URL("./agent-auth.ts", import.meta.url));

const NOW = new Date("2026-10-21T01:00:00.000Z");
const DAY = "2026-10-21";
const SNAPSHOT = "2026-10-21T00:30:00.000Z";
const pid = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const aid = n => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Real DAL and DTO code, with only the Supabase I/O boundary replaced. */
function fixture() {
  const tables = {
    openchat_programs: [], openchat_program_matches: [], openchat_program_requirements: [],
    openchat_program_attachments: [], openchat_program_attachment_discovery: [],
    openchat_program_reviews: [], openchat_program_profile_proposals: [],
    openchat_program_match_context: [{ id: "current", revision: 7 }],
    openchat_program_self_profiles: ["woolim-company", "cellavento"].map((id, i) => ({
      id, name: `가상 승인기업 ${i + 1}`, aliases: [], profile: { region: null, certifications_complete: false,
        has_support_history: false, unexpected: "FAKE_PROFILE_INTERNAL" }, version: 1, updated_at: SNAPSHOT,
    })),
    openchat_match_profiles_cache: [{ fetched_at: SNAPSHOT, expires_at: "2026-10-22T01:00:00.000Z",
      payload: [{ id: "customer-fixture", name: "가상 고객사", region: null, foundedOn: null, hasSupportHistory: false }] }],
  };
  const queries = [], writes = [], rpcCalls = [];
  let sequence = 100;
  const selectFields = (row, fields) => {
    if (fields === "*") return structuredClone(row);
    const keys = fields.split(/,(?![^()]*\))/).map(field => field.trim().split(":")[0]);
    return Object.fromEntries(keys.map(key => [key, structuredClone(row[key] ?? null)]));
  };
  function from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    let action = "select", fields = "*", payload, result, single = false, start = 0, end = Infinity;
    const filters = [], orders = [], filterLog = [];
    const builder = {
      select(value = "*") { fields = value; return this; },
      insert(value) { action = "insert"; payload = value; return this; },
      update() { assert.fail("The agent DAL must not update records"); },
      upsert() { assert.fail("The agent DAL must not upsert records"); },
      delete() { assert.fail("The agent DAL must not delete records"); },
      eq(key, value) { filters.push(row => row[key] === value); filterLog.push(["eq", key, value]); return this; },
      neq(key, value) { filters.push(row => row[key] !== value); filterLog.push(["neq", key, value]); return this; },
      gte(key, value) { filters.push(row => row[key] != null && row[key] >= value); filterLog.push(["gte", key, value]); return this; },
      gt(key, value) { filters.push(row => row[key] != null && row[key] > value); filterLog.push(["gt", key, value]); return this; },
      in(key, values) { filters.push(row => values.includes(row[key])); filterLog.push(["in", key, values]); return this; },
      not(key, operator, value) { assert.equal(operator, "is"); assert.equal(value, null); filters.push(row => row[key] != null); return this; },
      or(expression) {
        assert.match(expression, /^deadline_at\.is\.null,deadline_at\.gte\./);
        const deadline = expression.slice("deadline_at.is.null,deadline_at.gte.".length);
        filters.push(row => row.deadline_at === null || Date.parse(row.deadline_at) >= Date.parse(deadline));
        filterLog.push(["or", expression]); return this;
      },
      ilike(key, pattern) {
        const term = pattern.slice(1, -1).replace(/\\([%_\\])/g, "$1").toLowerCase();
        filters.push(row => String(row[key]).toLowerCase().includes(term)); return this;
      },
      order(key, options = {}) { orders.push([key, options.ascending !== false]); return this; },
      range(first, last) { start = first; end = last; return this; },
      limit(value) { end = start + value - 1; return this; },
      single() { single = true; return this; }, maybeSingle() { single = true; return this; },
      overrideTypes() { return this; },
      abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
      then(resolve, reject) {
        result ||= Promise.resolve().then(() => {
          queries.push({ table, action, fields, filters: filterLog });
          let rows;
          if (action === "insert") {
            assert.ok(["openchat_program_reviews", "openchat_program_profile_proposals"].includes(table));
            const values = Array.isArray(payload) ? payload : [payload];
            rows = values.map(value => ({ ...structuredClone(value), id: pid(sequence++), created_at: NOW.toISOString() }));
            tables[table].push(...rows); writes.push({ table, action, values: structuredClone(values) });
          } else rows = tables[table].filter(row => filters.every(filter => filter(row)));
          rows = [...rows].sort((a, b) => {
            for (const [key, ascending] of orders) {
              const left = key === "score" ? Number(a[key]) : a[key], right = key === "score" ? Number(b[key]) : b[key];
              if (left < right) return ascending ? -1 : 1;
              if (left > right) return ascending ? 1 : -1;
            }
            return 0;
          }).slice(start, end === Infinity ? undefined : end + 1).map(row => selectFields(row, fields));
          return { data: single ? rows[0] ?? null : rows, error: null };
        });
        return result.then(resolve, reject);
      },
    };
    return builder;
  }
  const admin = { from, rpc(name, args) { rpcCalls.push({ name, args }); assert.fail("The agent may propose a profile but cannot apply it"); } };
  function addProgram(n, extra = {}) {
    const row = { id: pid(n), title: `공개 가상공고 ${n}`, source_id: pid(99),
      source_url: "https://public.example/notice?id=public&token=FAKE_DOWNLOAD_VALUE&api_key=FAKE_QUERY_VALUE#fragment",
      source: { name: "가상 공공기관", source_key: "fixture", category: "public", internal: "FAKE_SOURCE_INTERNAL" },
      applicant_summary: null, support_summary: null, application_method: null, application_period_text: null, starts_at: null,
      deadline_at: "2026-10-22T09:00:00.000Z", regions: ["전국"], categories: [], status: "review_required",
      created_at: "2026-10-20T00:00:00.000Z", updated_at: SNAPSHOT, internal: "FAKE_PROGRAM_INTERNAL", ...extra };
    tables.openchat_programs.push(row);
    tables.openchat_program_requirements.push({ program_id: row.id, status: "extracted", requirements: {
      regions: ["전국"], evidence: { "regions.0": "[source:public p.1] 전국 기업 대상", response_text: "FAKE_PROVIDER_RESPONSE" },
      response_text: "FAKE_PROVIDER_RESPONSE", business_age: { min_years: null, max_years: null, basis: null, private: "FAKE_NESTED_INTERNAL" },
    }, source_complete: true, input_truncated: false, extracted_at: SNAPSHOT, normalization_version: 3,
    source_checked_at: SNAPSHOT, updated_at: SNAPSHOT, matched_normalization_version: 3, matched_review_date: DAY,
    matched_source_checked_at: SNAPSHOT, matched_profile_revision: 7, matched_rule_version: 2,
    response_text: "FAKE_PROVIDER_RESPONSE", diagnostics: { internal: "FAKE_DIAGNOSTICS" } });
    tables.openchat_program_attachment_discovery.push({ program_id: row.id, checked_at: "2026-10-21T00:10:00.000Z", detail_text: "[para.1] 공개 본문" });
    return row;
  }
  function addMatch(n, extra = {}) {
    const row = { program_id: pid(n), target_kind: "self", target_id: "woolim-company", target_name: tables.openchat_program_self_profiles[0].name,
      verdict: "candidate", reasons: ["조건부 후보: 확인된 일치가 있으며 나머지 요건은 확인 필요"], score: 10,
      review_date: DAY, selected_for_reading: true, internal: "FAKE_MATCH_INTERNAL", ...extra };
    tables.openchat_program_matches.push(row); return row;
  }
  function addAttachment(n, program = n, extra = {}) {
    const row = { id: aid(n), program_id: pid(program), file_name: "공고.pdf", file_ext: "pdf", text_status: "extracted", text_chars: 100,
      created_at: "2026-10-20T00:00:00.000Z", extracted_at: "2026-10-21T00:00:00.000Z", processing_started_at: null,
      text_content: "[p.1]\n공개 첨부 원문", storage_path: "FAKE_STORAGE_PATH", source_url: "https://private.invalid/?signature=FAKE_DOWNLOAD_VALUE", ...extra };
    tables.openchat_program_attachments.push(row); return row;
  }
  return { service: new ProgramAgentService(admin, NOW), tables, queries, writes, rpcCalls, addProgram, addMatch, addAttachment };
}
const targetQuery = extra => new URLSearchParams({ target_kind: "self", target_id: "woolim-company", ...extra });
const errorIs = (status, code) => error => error instanceof ProgramApiError && error.status === status && error.code === code;

test("today keeps the live recent scope, ranks numerically, caps eight and returns minimized DTOs", async () => {
  const f = fixture();
  for (let n = 1; n <= 14; n++) { f.addProgram(n); f.addMatch(n, { score: String(n) }); f.addAttachment(n); }
  f.tables.openchat_programs.find(row => row.id === pid(14)).status = "excluded";
  f.tables.openchat_programs.find(row => row.id === pid(13)).deadline_at = "2026-10-21T00:59:59.999Z";
  f.tables.openchat_programs.find(row => row.id === pid(12)).created_at = "2026-08-01T00:00:00.000Z";
  const output = await f.service.today();
  assert.deepEqual(output.programs.map(row => row.id), [11, 10, 9, 8, 7, 6, 5, 4].map(pid));
  assert.ok(output.programs.every(row => row.matches_stale === false));
  assert.ok(output.programs.every(row => row.matches[0].verdict_label === "조건부 후보" && !Object.hasOwn(row.matches[0], "reasons")));
  assert.deepEqual([...new URL(output.programs[0].source_url).searchParams.keys()], ["id"]);
  assert.equal(new URL(output.programs[0].source_url).hash, "");
  assert.doesNotMatch(JSON.stringify(output), /FAKE_|response_text|diagnostics|storage_path|text_content/);
  assert.equal(f.writes.length, 0);
});

test("target top lists default to nonexcluded unexpired recent programs and score-sort candidates before unknown fallback", async () => {
  const f = fixture();
  for (let n = 1; n <= 7; n++) f.addProgram(n);
  f.addMatch(1, { score: "9.5" }); f.addMatch(2, { score: "12" });
  f.addMatch(3, { verdict: "unknown", reasons: ["확인 필요"], score: 999 });
  f.addMatch(4, { verdict: "mismatch", reasons: ["명시된 지역 제한 불일치"], score: 9999 });
  f.addMatch(5, { score: 9998 }); f.addMatch(6, { score: 9997 }); f.addMatch(7, { score: 9996 });
  f.tables.openchat_programs.find(row => row.id === pid(5)).status = "excluded";
  f.tables.openchat_programs.find(row => row.id === pid(6)).deadline_at = "2026-10-21T00:59:59.999Z";
  f.tables.openchat_programs.find(row => row.id === pid(7)).created_at = "2026-08-01T00:00:00.000Z";
  const result = await f.service.searchPrograms(targetQuery({ limit: "10" }));
  assert.deepEqual(result.programs.map(row => row.id), [pid(2), pid(1)]);
  assert.ok(result.programs.every(row => row.match.verdict_label === "조건부 후보"));
  assert.equal(result.has_more, false);
  const historic = await f.service.searchPrograms(targetQuery({ eligible: "false" }));
  assert.deepEqual(historic.programs.slice(0, 2).map(row => row.id), [pid(5), pid(6)]);
  f.tables.openchat_program_matches.find(row => row.program_id === pid(1)).verdict = "mismatch";
  f.tables.openchat_program_matches.find(row => row.program_id === pid(2)).verdict = "mismatch";
  const fallback = await f.service.searchPrograms(targetQuery());
  assert.deepEqual(fallback.programs.map(row => row.id), [pid(3)]);
  assert.equal(fallback.programs[0].match.verdict_label, "확인 필요");
  assert.equal(f.writes.length, 0);
});

test("more than 500 target matches retain true global score order across bounded ID chunks and later pages", async () => {
  const f = fixture();
  for (let n = 1; n <= 550; n++) { f.addProgram(n); f.addMatch(n, { score: n }); }
  f.tables.openchat_programs.find(row => row.id === pid(550)).status = "excluded";
  f.tables.openchat_programs.find(row => row.id === pid(549)).deadline_at = "2026-10-21T00:59:59.999Z";
  f.tables.openchat_programs.find(row => row.id === pid(548)).created_at = "2026-08-01T00:00:00.000Z";
  const first = await f.service.searchPrograms(targetQuery({ limit: "10" }));
  assert.deepEqual(first.programs.map(row => row.id), Array.from({ length: 10 }, (_, i) => pid(547 - i)));
  assert.equal(first.has_more, true);
  const chunks = f.queries.filter(query => query.table === "openchat_programs")
    .map(query => query.filters.find(filter => filter[0] === "in" && filter[1] === "id")?.[2]);
  assert.equal(chunks.length, 6);
  assert.ok(chunks.every(chunk => Array.isArray(chunk) && chunk.length <= 100));
  assert.equal(new Set(chunks.flat()).size, 550);
  const later = await f.service.searchPrograms(targetQuery({ limit: "10", offset: "510" }));
  assert.deepEqual(later.programs.map(row => row.id), Array.from({ length: 10 }, (_, i) => pid(37 - i)));
  assert.equal(later.has_more, true);
  const last = await f.service.searchPrograms(targetQuery({ limit: "10", offset: "545" }));
  assert.deepEqual(last.programs.map(row => row.id), [pid(2), pid(1)]);
  assert.equal(last.has_more, false);
});

test("detail and text enforce recent program scope and attachment-to-program ownership", async () => {
  const f = fixture(); f.addProgram(1); f.addProgram(2); f.addMatch(1); f.addAttachment(1); f.addAttachment(2);
  await assert.rejects(f.service.text(pid(1), aid(2)), errorIs(404, "ATTACHMENT_NOT_FOUND"));
  const full = await f.service.text(pid(1));
  assert.equal(full.detail_text, "[para.1] 공개 본문");
  assert.deepEqual(full.attachments.map(row => row.id), [aid(1)]);
  assert.equal(full.attachments[0].text_content, "[p.1]\n공개 첨부 원문");
  assert.doesNotMatch(JSON.stringify(full), /FAKE_|storage_path|source_url/);
  const one = await f.service.text(pid(1), aid(1)); assert.equal(one.detail_text, null);
  const detail = await f.service.detail(pid(1));
  assert.equal(detail.matches_stale, false);
  assert.equal(detail.requirements.regions[0], "전국");
  assert.doesNotMatch(JSON.stringify(detail), /FAKE_|response_text|diagnostics|storage_path|text_content/);
  f.tables.openchat_program_attachments[0].text_status = "failed";
  assert.equal((await f.service.text(pid(1), aid(1))).attachments[0].text_content, null);
  const cutoff = new Date(NOW.getTime() - 60 * 86400000).toISOString();
  f.addProgram(3, { created_at: cutoff }); await f.service.detail(pid(3));
  f.addProgram(4, { created_at: new Date(Date.parse(cutoff) - 1).toISOString() });
  await assert.rejects(f.service.detail(pid(4)), errorIs(404, "PROGRAM_NOT_FOUND"));
  await assert.rejects(f.service.detail("bad-id"), errorIs(400, "INVALID_ID"));
});

test("actual discovery and attachment changes invalidate old matches even when both canonical checkpoints remain equal", async () => {
  for (const field of ["checked_at", "created_at", "extracted_at", "processing_started_at"]) {
    const f = fixture(); f.addProgram(1); f.addMatch(1); f.addAttachment(1);
    assert.equal((await f.service.detail(pid(1))).matches_stale, false);
    if (field === "checked_at") f.tables.openchat_program_attachment_discovery[0][field] = "2026-10-21T00:45:00.000Z";
    else f.tables.openchat_program_attachments[0][field] = "2026-10-21T00:45:00.000Z";
    assert.equal((await f.service.detail(pid(1))).matches_stale, true, field);
    assert.equal((await f.service.today()).programs[0].matches_stale, true, field);
    assert.equal((await f.service.searchPrograms(targetQuery())).programs[0].matches_stale, true, field);
  }
  for (const patch of [{ matched_profile_revision: 6 }, { matched_rule_version: 1 },
    { matched_review_date: "2026-10-20" }, { matched_normalization_version: 2 }, { matched_source_checked_at: "2026-10-21T00:00:00.000Z" }]) {
    const f = fixture(); f.addProgram(1); f.addMatch(1);
    Object.assign(f.tables.openchat_program_requirements[0], patch);
    assert.equal((await f.service.detail(pid(1))).matches_stale, true);
  }
});

test("search rejects invalid calendar dates, duplicate filters, unknown statuses and partial target identifiers", async () => {
  const f = fixture();
  for (const query of ["since=2026-02-30", "since=2026-10-01T99:00:00Z", "limit=0", "offset=5001", "status=anything", "eligible=maybe", "q=one&q=two", "untrusted=field", "target_kind=self"]) {
    await assert.rejects(f.service.searchPrograms(new URLSearchParams(query)), error => error instanceof ProgramApiError && error.status === 400, query);
  }
  assert.equal(f.writes.length, 0);
});

test("reviews append twice under the canonical target name and cannot edit programs or impersonate a reviewer", async () => {
  const f = fixture(); f.addProgram(1); f.addMatch(1);
  const before = JSON.stringify({ programs: f.tables.openchat_programs, matches: f.tables.openchat_program_matches, requirements: f.tables.openchat_program_requirements });
  const body = { target_kind: "self", target_id: "woolim-company", conclusion: "확인 필요", review_markdown: "공개 근거를 다시 확인합니다.", missing_documents: ["신청서"], next_actions: ["담당자 확인"] };
  await f.service.appendReview(pid(1), body);
  await f.service.appendReview(pid(1), { ...body, review_markdown: "추가 확인 내용을 누적합니다." });
  assert.equal(f.tables.openchat_program_reviews.length, 2);
  assert.notEqual(f.tables.openchat_program_reviews[0].id, f.tables.openchat_program_reviews[1].id);
  assert.ok(f.tables.openchat_program_reviews.every(row => row.target_name === "가상 승인기업 1" && row.reviewer === "ai:gongo-matcher"));
  await assert.rejects(f.service.appendReview(pid(1), { ...body, target_name: "다른 기업" }), errorIs(400, "TARGET_NAME_MISMATCH"));
  await assert.rejects(f.service.appendReview(pid(1), { ...body, reviewer: "administrator" }), errorIs(400, "UNKNOWN_FIELD"));
  assert.equal(JSON.stringify({ programs: f.tables.openchat_programs, matches: f.tables.openchat_program_matches, requirements: f.tables.openchat_program_requirements }), before);
  assert.ok(f.writes.every(write => write.table === "openchat_program_reviews" && write.action === "insert"));
});

test("profile proposals remain pending and never apply facts, versions or matching context", async () => {
  const f = fixture();
  const before = JSON.stringify({ profiles: f.tables.openchat_program_self_profiles, context: f.tables.openchat_program_match_context });
  const body = { base_version: 1, patch: { region: "대전광역시", founded_on: null }, reason: "대표 확인이 필요한 가상 제안" };
  const result = await f.service.proposeProfile("woolim-company", body);
  assert.equal(result.proposal.status, "pending");
  assert.equal(f.tables.openchat_program_profile_proposals[0].status, "pending");
  assert.equal(f.tables.openchat_program_profile_proposals[0].submitted_by, "ai:gongo-matcher");
  assert.equal(JSON.stringify({ profiles: f.tables.openchat_program_self_profiles, context: f.tables.openchat_program_match_context }), before);
  assert.equal(f.rpcCalls.length, 0);
  await assert.rejects(f.service.proposeProfile("woolim-company", { ...body, status: "approved" }), errorIs(400, "UNKNOWN_FIELD"));
  await assert.rejects(f.service.proposeProfile("woolim-company", { ...body, base_version: 2 }), errorIs(409, "PROFILE_VERSION_CONFLICT"));
  await assert.rejects(f.service.proposeProfile("woolim-company", { ...body, patch: { founded_on: "2025-02-29" } }), errorIs(400, "INVALID_FIELD"));
  assert.equal(f.tables.openchat_program_profile_proposals.length, 1);
  assert.ok(f.writes.every(write => write.table === "openchat_program_profile_proposals"));
  assert.doesNotMatch(JSON.stringify(await f.service.profiles()), /FAKE_PROFILE_INTERNAL/);
});

test("교육·행사로 보이는 공고는 정독 목록에서 뒤로 밀리고, 수집 원자료는 새어 나가지 않는다", async () => {
  const f = fixture();
  for (let n = 1; n <= 4; n++) { f.addProgram(n); f.addMatch(n, { score: String(n) }); }
  // 점수가 가장 높은 공고가 교육·행사다. 거르지 않고 순서만 양보시킨다.
  f.tables.openchat_programs.find(row => row.id === pid(4)).raw_payload = {
    collector: "gonggo-monitor", event_like: true, collector_conditions: { secret: "FAKE_RAW_PAYLOAD" } };
  const output = await f.service.today();
  assert.deepEqual(output.programs.map(row => row.id), [3, 2, 1, 4].map(pid),
    "교육·행사는 점수가 높아도 맨 뒤로 간다");
  assert.equal(output.programs.at(-1).event_like, true, "화면이 표시를 달 수 있어야 한다");
  assert.equal(output.programs[0].event_like, false);
  assert.doesNotMatch(JSON.stringify(output), /FAKE_RAW_PAYLOAD|collector_conditions/,
    "수집기가 담아 둔 원자료를 그대로 내보내면 안 된다");
});
