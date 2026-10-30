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
const { entityTargetId, entityTargetName, fetchWoolimworksCustomers, isConsultingCustomer,
  missingFields, parseSave } = load(new URL("./customer-profiles.ts", import.meta.url));
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
    industries: ["경영컨설팅업"], employees: 3, revenue_krw: 1,
    certifications: ["여성기업"], certifications_complete: true }), []);
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

// ── 적어 둔 요건이 판정에 실리는가 ──────────────────────────────────────
// 여기가 틀리면 대표님이 적은 값이 조용히 무시된다.

const { customerEntityMatchProfile } = load(new URL("./profiles.ts", import.meta.url));

const 고객 = { id: "cust-1", name: "주식회사 가게", region: "서울", foundedOn: "2019-01-01",
  hasSupportHistory: false };

test("적어 둔 요건이 판정 프로필에 그대로 실린다", () => {
  const 판정 = customerEntityMatchProfile(고객,
    { entityKey: "main", entityName: "가게 본사", profile: {
      region: "부산 북구", founded_on: "2021-03-02", business_type: "소상공인",
      industries: ["경영컨설팅업", "광고 대행업"], employees: 3, revenue_krw: 120000000,
      certifications: ["여성기업"], certifications_complete: true } },
    { targetId: "cust-1:main", several: false });
  assert.equal(판정.targetKind, "customer");
  assert.equal(판정.targetId, "cust-1:main");
  assert.equal(판정.targetName, "가게 본사");
  assert.equal(판정.region, "부산 북구", "적은 값이 울림웍스 값을 이긴다");
  assert.equal(판정.foundedOn, "2021-03-02");
  assert.equal(판정.businessType, "소상공인");
  assert.deepEqual(판정.industries, ["경영컨설팅업", "광고 대행업"]);
  assert.equal(판정.employees, 3);
  assert.equal(판정.revenueKrw, 120000000);
  assert.deepEqual(판정.certifications, ["여성기업"]);
  assert.deepEqual(판정.missingFields, [], "다 적었으면 '확인 필요' 가 없어야 한다");
});

test("안 적은 칸은 null 로 남는다 — 0 으로 바뀌지 않는다", () => {
  // 직원수를 0 으로 읽으면 '근로자 상한 5명 이하' 공고에 잘못 적합이 된다.
  const 판정 = customerEntityMatchProfile(고객,
    { entityKey: "main", entityName: "가게", profile: { region: "부산" } },
    { targetId: "cust-1:main", several: false });
  assert.equal(판정.employees, null);
  assert.equal(판정.revenueKrw, null);
  assert.equal(판정.industries, null);
  assert.equal(판정.businessType, null);
  assert.deepEqual(판정.missingFields,
    ["businessType", "industries", "employees", "revenueKrw", "certifications"]);
});

test("안 적은 지역·설립일은 울림웍스 값을 쓴다", () => {
  const 판정 = customerEntityMatchProfile(고객,
    { entityKey: "main", entityName: "가게", profile: {} },
    { targetId: "cust-1:main", several: false });
  assert.equal(판정.region, "서울");
  assert.equal(판정.foundedOn, "2019-01-01");
});

test("'확인 필요' 라고 적은 것은 적은 것이 아니다", () => {
  const 판정 = customerEntityMatchProfile(고객,
    { entityKey: "main", entityName: "가게", profile: { business_type: "확인 필요", industries: [] } },
    { targetId: "cust-1:main", several: false });
  assert.equal(판정.businessType, null);
  assert.equal(판정.industries, null);
});

test("인증은 '이게 전부' 라고 확인해야 다 적은 것으로 본다", () => {
  // 확인하지 않으면 '인증 없음' 으로 판정해 버릴 수 있다.
  const 적음 = customerEntityMatchProfile(고객,
    { entityKey: "main", entityName: "가게", profile: { certifications: ["여성기업"] } },
    { targetId: "cust-1:main", several: false });
  assert.ok(적음.missingFields.includes("certifications"));
  assert.equal(적음.certificationsComplete, false);
});

test("사업자가 여럿이면 어느 사업자인지 이름에 보인다", () => {
  const 하나 = customerEntityMatchProfile(고객,
    { entityKey: "shop", entityName: "가맹점", profile: {} },
    { targetId: "cust-1:shop", several: true });
  assert.equal(하나.targetName, "주식회사 가게 · 가맹점");
});

test("대상 이름은 고객 id 와 사업자를 함께 가리킨다", () => {
  assert.equal(entityTargetId("cust-1", "main"), "cust-1:main");
  assert.equal(entityTargetName("가게", "본사", false), "본사");
  assert.equal(entityTargetName("가게", "본사", true), "가게 · 본사");
});

// ── 인증 '없음' 을 적을 수 있는가 ───────────────────────────────────────
// 확인하지 않으면 '필수 인증' 공고가 영영 '확인 필요' 로 남는다.

test("인증은 '확인했고 없음' 을 적을 수 있다", () => {
  const saved = parseSave({ ...기본,
    profile: { certifications: [], certifications_complete: true } });
  assert.deepEqual(saved.profile.certifications, [], "빈 목록을 null 로 바꾸면 안 된다");
  assert.equal(saved.profile.certifications_complete, true);
  assert.ok(!missingFields(saved.profile).includes("certifications"));
});

test("확인에 체크하지 않으면 인증은 아직 안 적은 것으로 본다", () => {
  // 화면 기준이 판정 기준(matching.ts)과 달라지면
  // 화면은 '다 찼다' 는데 판정은 '확인 필요' 로 남는다.
  assert.ok(missingFields({ certifications: ["여성기업"] }).includes("certifications"));
  assert.ok(!missingFields({ certifications: ["여성기업"], certifications_complete: true })
    .includes("certifications"));
});
