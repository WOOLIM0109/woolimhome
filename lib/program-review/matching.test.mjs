import assert from "node:assert/strict";
import test from "node:test";
import { matchProgram, rankDailyCandidates, matchVerdictLabel, MATCHING_RULE_VERSION } from "./matching.ts";
import { normalizeRequirements } from "./requirements.ts";

const NOW = "2026-10-21T09:00:00+09:00";
const quote = (text) => `[source:public-attachment p.3] ${text}`;
function requirements(changes = {}) {
  const value = {
    regions: ["전국"], target_types: ["중소기업"], business_age: null, size: null,
    industries_included: null, industries_excluded: null, required_certifications: null, bonus_points: null,
    support_amount_text: null, self_pay_text: null, deadline_at: "2026-11-20T18:00:00+09:00",
    submission_documents: null, evaluation: null, contact: null, ...changes,
  };
  const evidence = {};
  const visit = (item, path) => {
    if (item === null || item === undefined) return;
    if (typeof item === "object") for (const [key, child] of Object.entries(item)) visit(child, path ? `${path}.${key}` : key);
    else evidence[path] = quote(String(item));
  };
  visit(value, "");
  return { ...value, evidence };
}
function profile(changes = {}) {
  return { targetKind: "customer", targetId: "customer-1", targetName: "검증 고객사", region: "부산광역시",
    foundedOn: "2020-10-21", businessType: "법인", industries: ["디자인업"], employees: 3, revenueKrw: 30_000_000,
    certifications: [], hasSupportHistory: false, missingFields: [], ...changes };
}
const match = (req, target = profile(), options = {}) => matchProgram(req, [target], { now: NOW, ...options })[0];
function conditional(row) {
  assert.equal(row.verdict, "candidate");
  assert.equal(matchVerdictLabel(row), "조건부 후보");
  assert.match(row.reasons.join(" "), /확인 필요/);
}
function age(min, max, asOf = "2026-10-21") {
  return { min_years: min, max_years: max, basis: "사업자등록일 기준", ...(asOf === null ? {} : { as_of: asOf }) };
}

test("confirmed nonrestrictive notice is a candidate while nationwide positives and blank self profiles are explicitly conditional without deductions", () => {
  const req = requirements({ support_amount_text: "지원금 최대 5천만원" });
  const known = profile();
  const missing = profile({ targetKind: "self", targetId: "self-woolim", targetName: "울림컴퍼니",
    region: null, foundedOn: null, industries: null, employees: null, revenueKrw: null, certifications: null,
    missingFields: ["region", "founded_on", "industries", "certifications"] });
  const result = matchProgram(req, [known, missing], { now: NOW });
  assert.equal(result[0].verdict, "candidate"); conditional(result[1]);
  assert.match(result[1].reasons.join(" "), /정보 부족/); assert.equal(result[0].score, result[1].score);
});

test("past deadlines reject every target; document evidence takes priority over an older stored deadline", () => {
  const past = requirements({ deadline_at: "2026-10-21T08:59:59+09:00" });
  assert.ok(matchProgram(past, [profile(), profile({ region: null })], { now: NOW }).every(row => row.verdict === "mismatch"));
  assert.equal(match(requirements(), profile(), { programDeadlineAt: "2026-01-01T00:00:00+09:00" }).verdict, "candidate");
  const noEvidence = requirements({ deadline_at: "2020-01-01T00:00:00+09:00" }); delete noEvidence.evidence.deadline_at;
  conditional(match(noEvidence));
  assert.equal(match(noEvidence, profile(), { programDeadlineAt: "2026-01-01T00:00:00+09:00" }).verdict, "mismatch");
  assert.equal(match(requirements({ deadline_at: NOW })).verdict, "candidate");
});

test("date-only deadline includes the whole KST calendar day and invalid time data cannot reject a target", () => {
  assert.equal(match(requirements({ deadline_at: "2026-10-21" }), profile(), { now: "2026-10-21T23:59:00+09:00" }).verdict, "candidate");
  assert.equal(match(requirements({ deadline_at: "2026-10-20" })).verdict, "mismatch");
  conditional(match(requirements({ deadline_at: "2026-02-30" })));
  conditional(match(requirements({ deadline_at: "2026-10-01T00:00:00" })));
  assert.equal(match(requirements(), profile(), { now: "invalid-date" }).verdict, "unknown");
});

test("only explicitly institution-only targets reject all companies; mixed and affiliated enterprise cases do not", () => {
  assert.equal(match(requirements({ target_types: ["대학교", "정부출연연구기관", "지자체"] })).verdict, "mismatch");
  assert.equal(match(requirements({ target_types: ["대학", "중소기업"] })).verdict, "candidate");
  assert.equal(match(requirements({ target_types: ["대학발 창업기업"] })).verdict, "candidate");
  const mixedEvidence = requirements({ target_types: ["연구기관"] });
  mixedEvidence.evidence["target_types.0"] = quote("연구기관과 공동 참여하는 중소기업");
  conditional(match(mixedEvidence));
  const unproven = requirements({ target_types: ["대학"] }); delete unproven.evidence["target_types.0"];
  conditional(match(unproven));
});

test("regional exclusion requires every target to have a clear broad-region mismatch", () => {
  const req = requirements({ regions: ["경기도"] });
  const known = [profile(), profile({ targetId: "customer-2", region: "서울특별시 강남구" })];
  assert.ok(matchProgram(req, known, { now: NOW }).every(row => row.verdict === "mismatch"));
  const withUnknown = matchProgram(req, [...known, profile({ targetKind: "self", targetId: "self", region: null })], { now: NOW });
  assert.ok(withUnknown.every(row => row.verdict === "unknown"));
  const withMatch = matchProgram(req, [profile(), profile({ targetId: "customer-2", region: "경기도" })], { now: NOW });
  assert.equal(withMatch[0].verdict, "unknown"); assert.equal(withMatch[1].verdict, "candidate");
  assert.equal(match(requirements({ regions: ["부산", "경기"] }), profile({ region: "서울" })).verdict, "unknown");
  assert.equal(match(requirements({ regions: ["전국"] }), profile({ region: "서울" })).verdict, "candidate");
});

test("district restrictions, relocation exceptions, ambiguous place names and missing evidence cannot cause regional rejection", () => {
  for (const regions of [["경기도 성남시"], ["수도권"], ["광주(경기)"]]) {
    assert.equal(match(requirements({ regions })).verdict, "unknown");
  }
  const moving = requirements({ regions: ["서울"] }); moving.evidence["regions.0"] = quote("서울 소재 또는 이전 예정 기업");
  assert.equal(match(moving).verdict, "unknown");
  const unproven = requirements({ regions: ["서울"] }); unproven.evidence["regions.0"] = "출처 없는 서울";
  assert.equal(match(unproven).verdict, "unknown");
  assert.equal(match(requirements({ regions: ["경기"] }), profile({ region: "부산진구" })).verdict, "unknown");
  assert.equal(match(requirements({ regions: ["경기"] }), profile({ region: "광주시" })).verdict, "unknown");
  assert.equal(match(requirements({ regions: ["경기"] }), profile({ region: "광주" })).verdict, "unknown");
  for (const text of ["서울 소재 기업이 아니어도 신청할 수 있다.", "서울 소재와 무관하게 신청할 수 있다.", "서울 소재는 필수 요건이 아니며 신청 가능"]) {
    const unrestricted = requirements({ regions: ["서울"] });
    unrestricted.evidence["regions.0"] = quote(text);
    assert.notEqual(match(unrestricted).verdict, "mismatch");
  }
});

test("business age uses the evidenced notice date and exact anniversaries, never today's date as a substitute", () => {
  const req = requirements({ business_age: age(null, 7, "2025-10-21") });
  assert.equal(match(req, profile({ foundedOn: "2018-10-21" })).verdict, "candidate");
  assert.equal(match(req, profile({ foundedOn: "2018-10-20" })).verdict, "mismatch");
  assert.equal(match(req, profile({ foundedOn: "2018-10-22" })).verdict, "candidate");
  const minimum = requirements({ business_age: age(3, null) });
  assert.equal(match(minimum, profile({ foundedOn: "2023-10-21" })).verdict, "candidate");
  assert.equal(match(minimum, profile({ foundedOn: "2023-10-22" })).verdict, "mismatch");
  const unspecifiedDate = requirements({ business_age: age(null, 7, null) });
  const uncertain = match(unspecifiedDate, profile({ foundedOn: "2000-01-01" }));
  conditional(uncertain); assert.match(uncertain.reasons.join(" "), /원문 기준일/);
  assert.equal(uncertain.score, match(requirements(), profile({ foundedOn: "2000-01-01" })).score);
});

test("age exceptions remain manual conditions even when a separate nationwide criterion is positive", () => {
  for (const business_age of [age(8, 7), age(null, 0.5), { ...age(null, 7), basis: null }]) {
    conditional(match(requirements({ business_age }), profile({ foundedOn: "2000-01-01" })));
  }
  const exception = requirements({ business_age: age(null, 7) });
  exception.evidence["business_age.max_years"] = quote("창업 7년 이내, 다만 신산업은 10년 이내");
  conditional(match(exception, profile({ foundedOn: "2017-01-01" })));
  conditional(match(requirements({ business_age: age(null, 7) }), profile({ foundedOn: "2028-01-01" })));
});

test("strict boundaries and exceptions never become an unconditional age pass at an exact seven-year anniversary", () => {
  for (const [text, basis, evidence] of [
    ["[p.1]\n2026.10.21. 기준 창업 7년 미만 기업", "2026.10.21. 기준", "[source:public p.1] 2026.10.21. 기준 창업 7년 미만 기업"],
    ["[p.1]\n2026.10.21. 기준 창업 7년 이하 기업\n[p.2]\n딥테크 분야 스타트업의 경우 업력 10년 이하", "2026.10.21. 기준", "[source:public p.1] 2026.10.21. 기준 창업 7년 이하 기업"],
  ]) {
    const normalized = normalizeRequirements({ business_age: { min_years: null, max_years: 7, basis, as_of: "2026-10-21" }, evidence: {
      "business_age.max_years": evidence, "business_age.basis": evidence, "business_age.as_of": evidence,
    } }, [{ id: "public", text }]);
    const req = requirements();
    req.business_age = normalized.business_age;
    Object.assign(req.evidence, normalized.evidence);
    for (const foundedOn of ["2019-10-21", "2017-10-21"]) {
      const result = match(req, profile({ foundedOn }));
      conditional(result);
      assert.match(result.reasons.join(" "), /업력.*(?:경계|예외).*정독/);
    }
  }
  const inclusive = requirements({ business_age: age(null, 7) });
  assert.equal(match(inclusive, profile({ foundedOn: "2019-10-21" })).verdict, "candidate");
});

test("age anniversary comparisons handle leap days without silently changing the notice reference date", () => {
  const maximum = requirements({ business_age: age(null, 5, "2024-02-29") });
  assert.equal(match(maximum, profile({ foundedOn: "2019-02-28" })).verdict, "mismatch");
  assert.equal(match(maximum, profile({ foundedOn: "2019-03-01" })).verdict, "candidate");
  const minimum = requirements({ business_age: age(5, null, "2025-02-28") });
  assert.equal(match(minimum, profile({ foundedOn: "2020-02-29" })).verdict, "candidate");
});

test("excluded industries require an evidenced and unambiguous match; partial categories stay unknown", () => {
  const req = requirements({ industries_excluded: ["유흥", "도박"] });
  assert.equal(match(req, profile({ industries: ["일반유흥주점업"] })).verdict, "mismatch");
  assert.equal(match(req, profile({ industries: ["디자인업"] })).verdict, "candidate");
  conditional(match(req, profile({ industries: null })));
  const broad = requirements({ industries_excluded: ["제조업"] });
  conditional(match(broad, profile({ industries: ["가구제조업"] })));
  delete req.evidence["industries_excluded.0"];
  conditional(match(req, profile({ industries: ["일반유흥주점업"] })));
});

test("required certificates compare current complete inventories, never past history or incomplete lists", () => {
  const req = requirements({ required_certifications: ["여성기업"] });
  assert.equal(match(req, profile({ certifications: ["여성기업확인서"] })).verdict, "candidate");
  assert.equal(match(req, profile({ certifications: [] })).verdict, "mismatch");
  conditional(match(req, profile({ certifications: null, hasSupportHistory: true })));
  conditional(match(req, profile({ certifications: [], missingFields: ["certifications"] })));
  delete req.evidence["required_certifications.0"];
  conditional(match(req, profile({ certifications: [] })));
});

test("alternative, optional and exempt certificates are not interpreted as mandatory AND conditions", () => {
  for (const text of ["여성기업 또는 벤처기업 중 하나", "여성기업 확인서 보유 시 우대", "해당 시 제출, 창업기업 면제"]) {
    const req = requirements({ required_certifications: ["여성기업", "벤처기업"] });
    req.evidence["required_certifications.0"] = quote(text);
    conditional(match(req, profile({ certifications: ["벤처기업"] })));
  }
});

test("only a single explicit grant amount scores; loans, overall budgets and multiple tracks do not", () => {
  const cases = [["지원금 500만원", 5], ["기업당 지원금 1,000만원", 10], ["지원금 최대 5천만원", 20],
    ["사업화자금 최대 1억원", 30], ["지원금 1억5천만원", 30], ["기업당 지원 50백만원", 20],
    ["대출 지원금 최대 1억원", 0], ["총 사업비 1억원", 0], ["지원금 총 예산 1억원", 0],
    ["최대 1억원", 0], ["지원금 A형 1억원, B형 5천만원", 0]];
  for (const [text, points] of cases) {
    const req = requirements({ support_amount_text: text, deadline_at: "2026-10-22T09:00:00+09:00" });
    assert.equal(match(req).score, points, text);
  }
  const missingEvidence = requirements({ support_amount_text: "지원금 1억원", deadline_at: "2026-10-22T09:00:00+09:00" });
  delete missingEvidence.evidence.support_amount_text; assert.equal(match(missingEvidence).score, 0);
});

test("seven-day margin, proven current certificate bonus and history score independently of missing profile data", () => {
  const req = requirements({ deadline_at: "2026-10-28T09:00:00+09:00", bonus_points: [{ item: "여성기업", points: 2 }] });
  assert.equal(match(req, profile({ certifications: ["여성기업확인서"], hasSupportHistory: true })).score, 12);
  assert.equal(match(req, profile({ certifications: null, hasSupportHistory: true, region: null })).score, 10);
  assert.equal(match(req, profile({ certifications: [], hasSupportHistory: true })).score, 10);
  req.deadline_at = "2026-10-28T08:59:59+09:00";
  assert.equal(match(req).score, 0);
  const duplicates = requirements({ bonus_points: [{ item: "여성기업", points: 2 }, { item: "여성기업", points: 2 }] });
  assert.equal(match(duplicates, profile({ certifications: ["여성기업"] })).score, 7);
});

test("size and included industries outside automatic exclusion rules stay reviewable instead of becoming new rejection rules", () => {
  const req = requirements({ size: { max_employees: 2, max_revenue_krw: 10_000_000, text: "상한" }, industries_included: ["제조업"] });
  const row = match(req);
  conditional(row); assert.match(row.reasons.join(" "), /정독 확인/);
});

test("matching is pure and mixed target results retain explicit per-target reasons", () => {
  const req = requirements({ required_certifications: ["여성기업"] });
  const profiles = [profile({ certifications: [] }), profile({ targetId: "unknown", certifications: null }),
    profile({ targetId: "matches", certifications: ["여성기업"] })];
  const before = JSON.stringify({ req, profiles });
  const output = matchProgram(req, profiles, { now: new Date(NOW) });
  assert.deepEqual(output.map(row => row.verdict), ["mismatch", "candidate", "candidate"]);
  conditional(output[1]);
  assert.ok(output.every(row => row.reasons.length && row.targetName && Number.isFinite(row.score)));
  assert.equal(JSON.stringify({ req, profiles }), before);
});

test("daily reading slots are unique program IDs, include unknowns, cap at eight and have deterministic ties", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ ...match(requirements()), programId: `p${String(index).padStart(2, "0")}`,
    score: index === 11 ? 50 : 10, verdict: index === 11 ? "mismatch" : index % 2 ? "unknown" : "candidate" }));
  rows.push({ ...rows[0], targetId: "second-target", score: 20 });
  const expected = ["p00", "p01", "p02", "p03", "p04", "p05", "p06", "p07"];
  assert.deepEqual(rankDailyCandidates(rows), expected);
  assert.deepEqual(rankDailyCandidates([...rows].reverse()), expected);
  assert.deepEqual(rankDailyCandidates(rows, 100), expected);
  assert.deepEqual(rankDailyCandidates(rows, 2), expected.slice(0, 2));
  assert.deepEqual(rankDailyCandidates(rows, 0), []);
  assert.deepEqual(rankDailyCandidates([{ ...rows[1], programId: "only-unknown", score: NaN }]), ["only-unknown"]);
});

test("known nationwide eligibility is conditional with missing facts, while score and deadline alone never make a positive", () => {
  assert.equal(MATCHING_RULE_VERSION, 2);
  const unknownProfile = profile({ region: null, foundedOn: null, industries: null, certifications: null,
    missingFields: ["region", "foundedOn", "industries", "certifications"] });
  conditional(match(requirements(), unknownProfile));
  const onlyScore = requirements({ regions: null, target_types: null, support_amount_text: "지원금 1억원" });
  const row = match(onlyScore, unknownProfile);
  assert.equal(row.verdict, "unknown");
  assert.equal(matchVerdictLabel(row), "확인 필요");
  assert.ok(row.score > 0);
  assert.deepEqual(rankDailyCandidates([{ ...row, programId: "needs-review" }]), ["needs-review"]);
});

test("a verified held certificate earns a bonus with an incomplete inventory, but unconfirmed absence cannot reject", () => {
  const req = requirements({ required_certifications: ["여성기업"], bonus_points: [{ item: "연구개발전담부서", points: 2 }] });
  const partial = profile({ certifications: ["연구개발전담부서"], certificationsComplete: false, missingFields: ["certifications"] });
  const result = match(req, partial);
  conditional(result);
  assert.equal(result.score, 7);
  assert.match(result.reasons.join(" "), /현재 인증과 일치.*연구개발전담부서/);
  assert.match(result.reasons.join(" "), /필수 인증.*확인 필요/);
  assert.equal(match(req, profile({ certifications: [], certificationsComplete: true })).verdict, "mismatch");
  const noInventedWomenCertificate = match(requirements({ bonus_points: [{ item: "여성기업", points: 3 }] }), partial);
  assert.equal(noInventedWomenCertificate.score, 5);
});

test("one confirmed regional mismatch among 469 profiles cannot become conditional because the other regions are unknown", () => {
  const req = requirements({ regions: ["서울"], size: { max_employees: 10, max_revenue_krw: null, text: null } });
  req.evidence["regions.0"] = quote("서울 소재 기업만 신청할 수 있다.");
  const profiles = [profile({ targetId: "known-busan" }), ...Array.from({ length: 468 }, (_, index) => profile({
    targetId: `unknown-${index}`, region: null, employees: null, missingFields: ["region", "employees"],
  }))];
  const result = matchProgram(req, profiles, { now: NOW });
  assert.equal(result[0].verdict, "mismatch");
  assert.equal(matchVerdictLabel(result[0]), "제외");
  assert.match(result[0].reasons.join(" "), /소재지 제한.*불일치/);
  assert.ok(result.slice(1).every(row => row.verdict === "unknown"));
  assert.ok(rankDailyCandidates(result.map(row => ({ ...row, programId: row.targetId }))).every(id => id !== "known-busan"));
  req.evidence["regions.0"] = quote("지역: 서울");
  const metadataOnly = matchProgram(req, profiles, { now: NOW })[0];
  conditional(metadataOnly);
  assert.match(metadataOnly.reasons.join(" "), /지역 요건 추가 확인/);
});

test("confirmed age, industry and certificate exclusions always outrank positive region and missing information", () => {
  for (const [req, target] of [
    [requirements({ business_age: age(null, 7) }), profile({ foundedOn: "2010-01-01", certifications: null, missingFields: ["certifications"] })],
    [requirements({ industries_excluded: ["유흥"] }), profile({ industries: ["일반유흥주점업"], foundedOn: null, missingFields: ["foundedOn"] })],
    [requirements({ required_certifications: ["여성기업"] }), profile({ certifications: [], employees: null, missingFields: ["employees"] })],
  ]) {
    const row = match(req, target);
    assert.equal(row.verdict, "mismatch");
    assert.equal(matchVerdictLabel(row), "제외");
    assert.deepEqual(rankDailyCandidates([{ ...row, programId: "excluded" }]), []);
  }
});

// ── 사업자 유형의 포함 관계 ────────────────────────────────────────────
// 소상공인 ⊂ 소기업 ⊂ 중소기업. 소상공인은 중소기업확인서도 받을 수 있다.
// 글자가 똑같을 때만 맞다고 보면 받을 수 있는 공고에서 가점을 못 받는다.

const 유형일치 = (row) => row.reasons.join(" ").includes("사업자 유형 일치");

test("소상공인은 중소기업 공고에서도 사업자 유형이 맞는다", () => {
  assert.ok(유형일치(match(requirements({ target_types: ["중소기업"] }),
    profile({ businessType: "소상공인" }))));
  assert.ok(유형일치(match(requirements({ target_types: ["소기업"] }),
    profile({ businessType: "소상공인" }))));
  assert.ok(유형일치(match(requirements({ target_types: ["소상공인"] }),
    profile({ businessType: "소상공인" }))));
});

test("중기업은 소기업·소상공인이 아니다", () => {
  // '중소기업' 글자 안에 '소기업' 이 들어 있어서 단순 비교로는 둔갑한다.
  assert.ok(유형일치(match(requirements({ target_types: ["중소기업"] }),
    profile({ businessType: "중소기업" }))));
  assert.ok(!유형일치(match(requirements({ target_types: ["소기업"] }),
    profile({ businessType: "중소기업" }))), "중소기업이 소기업으로 둔갑하면 안 된다");
  assert.ok(!유형일치(match(requirements({ target_types: ["소상공인"] }),
    profile({ businessType: "중소기업" }))));
  assert.ok(유형일치(match(requirements({ target_types: ["중소기업"] }),
    profile({ businessType: "중기업" }))));
  assert.ok(!유형일치(match(requirements({ target_types: ["소기업"] }),
    profile({ businessType: "중기업" }))));
});

test("확인서 제목을 그대로 적어도 알아듣는다", () => {
  // 대표님이 확인서에 적힌 대로 옮겨 적는 경우가 많다.
  for (const 적은값 of ["중소기업(소상공인)", "소기업(소상공인)", "중소기업 확인서(중기업)"]) {
    assert.ok(유형일치(match(requirements({ target_types: ["중소기업"] }),
      profile({ businessType: 적은값 }))), `${적은값} → 중소기업`);
  }
  assert.ok(유형일치(match(requirements({ target_types: ["소상공인"] }),
    profile({ businessType: "중소기업(소상공인)" }))));
  assert.ok(!유형일치(match(requirements({ target_types: ["소상공인"] }),
    profile({ businessType: "중소기업 확인서(중기업)" }))));
});

test("유형이 안 맞아도 부적합이 되지는 않는다", () => {
  // 이 칸은 가점일 뿐이다. 틀려도 떨어뜨리지 않는다.
  const row = match(requirements({ target_types: ["사회적기업"] }),
    profile({ businessType: "소상공인" }));
  assert.notEqual(row.verdict, "mismatch");
  assert.ok(!유형일치(row));
});
