import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// `agent-auth.ts` 에 Node 의 strip-only 로더가 못 읽는 모양이 있다.
// 저장소의 다른 검사(`agent-api.test.mjs`)와 같은 변환을 쓴다.
const nativeRequire = createRequire(import.meta.url), modules = new Map();
function load(url) {
  const key = String(url);
  if (modules.has(key)) return modules.get(key).exports;
  const compiledModule = { exports: {} }; modules.set(key, compiledModule);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const execute = new Function("module", "exports", "require", compiled);
  execute(compiledModule, compiledModule.exports,
    id => id.startsWith(".") ? load(new URL(id.endsWith(".ts") ? id : `${id}.ts`, url)) : nativeRequire(id));
  return compiledModule.exports;
}
const { fetchWoolimworksCustomers, isConsultingCustomer, missingFields, parseSave } =
  load(new URL("./customer-profiles.ts", import.meta.url));
const { ProgramApiError } = load(new URL("./agent-auth.ts", import.meta.url));

/** assert.throws 는 오류를 돌려주지 않는다. 어디가 틀렸는지 보려면 잡아야 한다. */
function throws(run) {
  try { run(); } catch (error) {
    assert.ok(error instanceof ProgramApiError, `ProgramApiError 가 아니다: ${error}`);
    return error;
  }
  assert.fail("오류가 나지 않았다");
}

const 기본 = {
  customer_id: "cust-1", entity_key: "main", entity_name: "울림컴퍼니",
  business_number: "123-45-67890",
  profile: { region: "부산", founded_on: "2021-03-02", industries: ["경영컨설팅업"], employees: 3 },
};

test("화면에서 온 값을 저장소가 받는 모양으로 바꾼다", () => {
  const saved = parseSave({ ...기본 });
  assert.equal(saved.customer_id, "cust-1");
  assert.equal(saved.business_number, "123-45-67890");
  assert.deepEqual(saved.profile.industries, ["경영컨설팅업"]);
  assert.equal(saved.profile.employees, 3);
  assert.equal(saved.active, true, "따로 끄지 않으면 켜 둔다");
});

test("숫자를 '1,200' 처럼 적어도 받는다", () => {
  const saved = parseSave({ ...기본, profile: { employees: "1,200", revenue_krw: "350000000" } });
  assert.equal(saved.profile.employees, 1200);
  assert.equal(saved.profile.revenue_krw, 350000000);
});

test("비운 칸은 '모른다' 로 남는다 — 0 이나 빈 글자로 바꾸지 않는다", () => {
  // 모르는 것을 아는 것처럼 저장하면 판정이 조용히 틀린다.
  const saved = parseSave({ ...기본, profile: { employees: "", revenue_krw: null, region: "" } });
  assert.equal(saved.profile.employees, null);
  assert.equal(saved.profile.revenue_krw, null);
  assert.equal(saved.profile.region, null);
});

test("모르는 칸은 받지 않는다", () => {
  // 조용히 버리면 화면에 적은 값이 사라진다.
  const error = throws(() => parseSave({ ...기본, profile: { 매출: 100 } }));
  assert.equal(error.code, "INVALID_CUSTOMER_PROFILE:profile.매출");
  assert.equal(throws(() => parseSave({ ...기본, 엉뚱한칸: 1 })).code,
    "INVALID_CUSTOMER_PROFILE:엉뚱한칸");
});

test("어디가 틀렸는지 칸 이름으로 알려 준다", () => {
  assert.equal(throws(() => parseSave({ ...기본, profile: { founded_on: "2021년 3월" } })).code,
    "INVALID_CUSTOMER_PROFILE:profile.founded_on");
  assert.equal(throws(() => parseSave({ ...기본, profile: { employees: "세 명" } })).code,
    "INVALID_CUSTOMER_PROFILE:profile.employees");
  assert.equal(throws(() => parseSave({ ...기본, business_number: "1234567890" })).code,
    "INVALID_CUSTOMER_PROFILE:business_number");
  assert.equal(throws(() => parseSave({ ...기본, entity_name: "  " })).code,
    "INVALID_CUSTOMER_PROFILE:entity_name");
});

test("직원수는 음수나 소수가 될 수 없다", () => {
  assert.equal(throws(() => parseSave({ ...기본, profile: { employees: -1 } })).code,
    "INVALID_CUSTOMER_PROFILE:profile.employees");
  assert.equal(throws(() => parseSave({ ...기본, profile: { employees: 1.5 } })).code,
    "INVALID_CUSTOMER_PROFILE:profile.employees");
});

test("무엇을 더 적어야 하는지 알려 준다", () => {
  assert.deepEqual(missingFields({ region: "부산", industries: ["경영컨설팅업"] }),
    ["founded_on", "business_type", "employees", "revenue_krw", "certifications"]);
  assert.deepEqual(missingFields({ region: "부산", founded_on: "2021-03-02", business_type: "소상공인",
    industries: ["경영컨설팅업"], employees: 3, revenue_krw: 1, certifications: ["여성기업"] }), []);
  assert.deepEqual(missingFields({ industries: [] }).includes("industries"), true,
    "빈 목록은 적은 것이 아니다");
});

// ── 울림웍스에서 고객 목록 읽기 ────────────────────────────────────────

function 가짜울림웍스(customers) {
  return async () => new Response(JSON.stringify({ customers }), {
    status: 200, headers: { "Content-Type": "application/json" } });
}

test("협력사와 끊긴 고객은 목록에서 뺀다", async () => {
  process.env.WOOLIMWORKS_AGENT_TOKEN = "테스트-값-아님";
  const rows = await fetchWoolimworksCustomers(가짜울림웍스([
    { id: "a", name: "가게", companyName: "주식회사 가게", region: "부산", foundedOn: "2020-01-01",
      displayStatus: "active", contractStatus: "contracted", supportProjectCount: 2 },
    { id: "b", name: "협력사", customerKind: "partner" },
    { id: "c", name: "끊긴 곳", active: false },
    { id: "", name: "식별자 없음" },
  ]));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { id: "a", name: "주식회사 가게", region: "부산", founded_on: "2020-01-01",
    display_status: "active", contract_status: "contracted", support_projects: 2 });
});

test("설정이 없으면 조용히 빈 목록을 주지 않는다", async () => {
  delete process.env.WOOLIMWORKS_AGENT_TOKEN;
  await assert.rejects(() => fetchWoolimworksCustomers(가짜울림웍스([])),
    (error) => error instanceof ProgramApiError && error.code === "WOOLIMWORKS_TOKEN_MISSING");
});

// ── 컨설팅 고객사 ──────────────────────────────────────────────────────
// 실측(2026-10-30): 468곳 중 진행 중 10 · 지원사업 이력 8 · 합쳐 12곳.

test("컨설팅 고객사만 가려낸다", () => {
  const 고객 = (extra) => ({ id: "x", name: "가게", region: null, founded_on: null,
    display_status: "completed", contract_status: "none", support_projects: 0, ...extra });
  assert.equal(isConsultingCustomer(고객({ display_status: "active" })), true);
  assert.equal(isConsultingCustomer(고객({ contract_status: "contracted" })), true);
  assert.equal(isConsultingCustomer(고객({ support_projects: 1 })), true);
  assert.equal(isConsultingCustomer(고객()), false, "끝난 고객은 대상이 아니다");
});
