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
