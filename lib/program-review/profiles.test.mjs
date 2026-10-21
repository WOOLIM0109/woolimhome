import assert from "node:assert/strict";
import test from "node:test";
import {
  SELF_PROFILES, WOOLIMWORKS_API_FIELD_NAMES, CUSTOMER_ACTIVITY_BASIS,
  selfMatchProfiles, customerMatchProfile, customerActivityCutoff,
  hasRecentRegisteredProject, activeCustomerProfile,
} from "./profiles.ts";

const now = new Date("2026-10-21T09:00:00+09:00");
const customer = { id: "fixture-customer", name: "가상 고객사", region: null, foundedOn: null };
const project = (overrides = {}) => ({
  id: "fixture-project", customerId: customer.id, projectCategory: "design",
  createdAt: "2024-01-01T00:00:00Z", ...overrides,
});

test("자사 프로필 두 개는 확인 전까지 사실 필드를 비워 두며 로닛 별칭만 둔다", () => {
  assert.deepEqual(SELF_PROFILES.map((row) => row.name), ["울림컴퍼니", "셀라벤토"]);
  assert.deepEqual(SELF_PROFILES[1].aliases, ["로닛"]);
  for (const row of SELF_PROFILES) {
    for (const key of ["region", "founded_on", "business_type", "industries", "employees", "revenue_band", "certifications", "notes"]) {
      assert.equal(row[key], null, key);
    }
  }
  assert.equal(selfMatchProfiles().length, 2);
  assert.ok(selfMatchProfiles().every((row) => row.missingFields.includes("region") && row.certifications === null));
});

test("최근 18개월은 한국 시각의 달력 월과 등록일 경계를 사용한다", () => {
  assert.equal(customerActivityCutoff(now).toISOString(), "2025-04-21T00:00:00.000Z");
  const cutoff = customerActivityCutoff(now).getTime();
  assert.equal(hasRecentRegisteredProject([project({ createdAt: new Date(cutoff).toISOString() })], now), true);
  assert.equal(hasRecentRegisteredProject([project({ createdAt: new Date(cutoff - 1).toISOString() })], now), false);
  assert.equal(hasRecentRegisteredProject([project({ createdAt: new Date(now.getTime() + 1).toISOString() })], now), false);
  assert.equal(hasRecentRegisteredProject([project({ updatedAt: now.toISOString(), lastActivityAt: now.toISOString() })], now), false);
  assert.match(CUSTOMER_ACTIVITY_BASIS, /createdAt 등록일/);
});

test("18개월 전 월말을 다음 달로 넘기지 않고 말일에 맞춘다", () => {
  assert.equal(customerActivityCutoff(new Date("2026-08-31T00:30:00+09:00")).toISOString(), "2025-02-27T15:30:00.000Z");
  assert.equal(customerActivityCutoff(new Date("2025-08-31T23:30:00+09:00")).toISOString(), "2024-02-29T14:30:00.000Z");
});

test("오래된 고객사 지원사업·인증·legacy 이력은 포함하고 자사 지원사업만 있으면 포함하지 않는다", () => {
  assert.equal(activeCustomerProfile(customer, [project()], false, now), null);
  assert.equal(activeCustomerProfile(customer, [project({ projectCategory: "support_company" })], false, now), null);
  assert.equal(activeCustomerProfile(customer, [project({ projectCategory: "support_client" })], false, now)?.hasSupportHistory, true);
  assert.equal(activeCustomerProfile(customer, [project({ projectCategory: "certification" })], false, now)?.hasSupportHistory, true);
  assert.equal(activeCustomerProfile(customer, [], true, now)?.hasSupportHistory, true);
  assert.equal(activeCustomerProfile(customer, [project({ createdAt: now.toISOString() })], false, now)?.hasSupportHistory, false);
});

test("고객 요약의 최근 활동·진행 건수만으로 활성 판정하지 않는다", () => {
  const summaryOnly = { ...customer, activeProjectCount: 99, supportProjectCount: 99, lastActivityAt: now.toISOString() };
  assert.equal(activeCustomerProfile(summaryOnly, [], false, now), null);
});

test("API에 없는 업종·직원·매출·현재 인증은 null이며 점수나 감점을 만들어 내지 않는다", () => {
  const cached = activeCustomerProfile({ ...customer, region: "부산", foundedOn: "2020" }, [], true, now);
  const profile = customerMatchProfile(cached);
  assert.deepEqual(profile.missingFields, ["businessType", "industries", "employees", "revenueKrw", "certifications"]);
  for (const key of profile.missingFields) assert.equal(profile[key], null);
  assert.equal(profile.hasSupportHistory, true);
  assert.equal(Object.hasOwn(profile, "score"), false);
  assert.equal(Object.hasOwn(profile, "penalty"), false);
});

test("최소 고객 캐시에는 허용된 신원·지역·설립일·이력 판별값만 남긴다", () => {
  const input = { ...customer, contactName: "가짜 담당자", staffContact: "000-0000-0000", memo: "FAKE_PRIVATE_MEMO", businessRegistrationNumber: "0000000000" };
  const cached = activeCustomerProfile(input, [], true, now);
  assert.deepEqual(Object.keys(cached).sort(), ["id", "name", "region", "foundedOn", "hasSupportHistory"].sort());
  assert.ok(!JSON.stringify(cached).includes("FAKE_PRIVATE_MEMO"));
  assert.ok(WOOLIMWORKS_API_FIELD_NAMES.customers.includes("lastActivityAt"));
  assert.ok(WOOLIMWORKS_API_FIELD_NAMES.projects.includes("createdAt"));
  assert.deepEqual(WOOLIMWORKS_API_FIELD_NAMES.customerDetail, ["customer", "projects", "legacyPrograms", "quoteRequests"]);
});

test("승인된 비공개 자사 프로필만 매칭에 쓰고 연도·확인 필요·불확실 인증은 사실로 보완하지 않는다", () => {
  const rows = SELF_PROFILES.map((row, index) => ({ id: row.id, name: `가상 승인기업 ${index}`, version: 2, profile: {
    region: index === 0 ? "부산 (확인 필요: 구 단위)" : "대전광역시", founded_on: index === 0 ? "2018" : "2024-02-29",
    business_type: index === 0 ? "확인 필요" : "법인", industries: ["가상업종"], employees: index === 0 ? "확인 필요" : 3,
    revenue_krw: null, revenue_band: "매출 발생 전 (확인 필요)", certifications: index === 0 ? ["가상인증 유효기간 확인 필요"] : ["검증된 가상인증"],
    certifications_complete: false, has_support_history: index === 1,
  } }));
  const output = selfMatchProfiles([...rows].reverse());
  assert.equal(output[0].region, "부산");
  assert.equal(output[0].foundedOn, null);
  assert.equal(output[0].businessType, null);
  assert.equal(output[0].employees, null);
  assert.deepEqual(output[0].certifications, []);
  assert.equal(output[1].foundedOn, "2024-02-29");
  assert.equal(output[1].employees, 3);
  assert.equal(output[1].revenueKrw, null);
  assert.deepEqual(output[1].certifications, ["검증된 가상인증"]);
  assert.equal(output[1].certificationsComplete, false);
  assert.ok(output[1].missingFields.includes("certifications"));
  assert.ok(output.every(row => row.revenueKrw === null));
  assert.equal(output[1].hasSupportHistory, true);
  assert.equal(Object.hasOwn(output[1], "notes"), false);
  assert.equal(SELF_PROFILES[0].region, null);
});

test("비공개 프로필의 누락·중복·없는 대상·잘못된 숫자는 고정 오류로 중단한다", () => {
  const rows = SELF_PROFILES.map(row => ({ id: row.id, name: "가상 기업", version: 1, profile: {} }));
  for (const invalid of [[], [rows[0], rows[0]], [{ ...rows[0], id: "untrusted" }, rows[1]],
    [{ ...rows[0], profile: { employees: -1 } }, rows[1]], [{ ...rows[0], version: 0 }, rows[1]]]) {
    assert.throws(() => selfMatchProfiles(invalid), { message: "자사 프로필 형식이 올바르지 않습니다." });
  }
  const invalidDay = selfMatchProfiles([{ ...rows[0], profile: { founded_on: "2025-02-29" } }, rows[1]]);
  assert.equal(invalidDay[0].foundedOn, null);
});
