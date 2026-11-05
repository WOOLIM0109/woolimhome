import assert from "node:assert/strict";
import test from "node:test";
import {
  foldSameOwnerEntities, matchProgram, oneEntityPerOwnerRule,
  rankDailyCandidates, SAME_OWNER_REASON, MATCHING_RULE_VERSION,
} from "./matching.ts";

const NOW = "2026-11-06T09:00:00+09:00";
const quote = (text) => `[source:public-attachment p.3] ${text}`;

/** 요건 한 벌. 근거는 값마다 자동으로 붙인다 (판정이 근거 없는 값을 안 쓴다). */
function requirements(changes = {}) {
  const value = {
    regions: ["전국"], target_types: ["중소기업"], business_age: null, size: null,
    support_fields: null, support_field_required: null,
    industries_included: null, industries_excluded: null, exclusion_rules: null,
    required_certifications: null, bonus_points: null,
    support_amount_text: null, self_pay_text: null, deadline_at: "2026-12-20T18:00:00+09:00",
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

/** 같은 대표(경동) 밑의 명의 하나. `ownerKey` 가 같으면 한 사람의 여러 명의다. */
function entity(changes = {}) {
  return {
    targetKind: "customer", targetId: "경동:main", targetName: "경동종합상사 ((주)경동코퍼레이션)",
    ownerKey: "경동", region: "부산광역시", foundedOn: "2023-03-01", businessType: "소기업",
    industries: ["제조업"], employees: 5, revenueKrw: 401_025_100,
    certifications: ["여성기업"], certificationsComplete: true,
    hasSupportHistory: false, missingFields: [], ...changes,
  };
}

const 법인 = entity();
const 본점 = entity({ targetId: "경동:본점", targetName: "경동종합상사 (본점)", foundedOn: "2018-02-01" });
const 지점 = entity({ targetId: "경동:지점", targetName: "경동종합상사 (지점)", foundedOn: "2019-05-01" });
/** 다른 고객사. 묶이지 않아야 한다. */
const 셀라벤토 = entity({ ownerKey: "셀라벤토", targetId: "셀라벤토", targetName: "주식회사 셀라벤토" });

// ── 공고가 스스로 "한 명의만" 이라고 적었는가 ────────────────────────────

test("대표자가 같으면 한 명의만 — 적힌 문장을 그대로 돌려준다", () => {
  const rule = "대표자가 같은 다수 기업(법인, 사업체)은 1개 기업만 신청 가능";
  assert.equal(oneEntityPerOwnerRule(requirements({ exclusion_rules: [rule] })), rule);
  assert.equal(oneEntityPerOwnerRule(requirements({
    exclusion_rules: ["대표자 1인당 한 사업장만 신청 가능"],
  })), "대표자 1인당 한 사업장만 신청 가능");
  assert.equal(oneEntityPerOwnerRule(requirements({
    exclusion_rules: ["공동대표일 경우 협의 후 위임대표가 한 사업장만 신청 가능"],
  })), "공동대표일 경우 협의 후 위임대표가 한 사업장만 신청 가능");
});

test("뜻이 다른 문장은 잡지 않는다", () => {
  // 실제로 섞여 들어오는 문장들 (2026-11-06 실측).
  for (const rule of [
    // 공동대표 자격 조건이다 — 명의를 줄이라는 말이 아니다
    "공동대표 또는 각자대표 체제는 대표자 전원이 신청 제한 사유에 해당하지 않아야 함",
    "공동대표 또는 각자대표 기업은 대표자 전원이 신청자격을 갖추고 신청 제외 대상에 해당하지 않아야 함",
    // 협회 선택이다
    "메인비즈와 이노비즈를 모두 보유한 기업은 1개 협회를 선택하여 1건만 신청",
    // 사람 수다
    "1개 기업당 1명 지원",
    "원칙적으로 (예비)창업기업의 대표자 1명만 신청 가능",
    // 다른 사업과의 중복이다
    "여타 정부/지자체 지원사업에 중복적인 지원 신청을 하지 않음(중복지원 금지 확약)",
    "중복 신청이 불가",
  ]) assert.equal(oneEntityPerOwnerRule(requirements({ exclusion_rules: [rule] })), null, rule);
});

test("여러 문장 중 하나만 해당해도 그 문장을 쓴다", () => {
  const rule = "대표자가 같은 다수 기업(법인, 사업체)은 1개 기업만 신청 가능";
  assert.equal(oneEntityPerOwnerRule(requirements({
    exclusion_rules: ["중복 신청이 불가", rule, "기지원 및 중복지원 불가 확인서 제출"],
  })), rule);
});

test("조건이 없으면 null", () => {
  assert.equal(oneEntityPerOwnerRule(requirements()), null);
  assert.equal(oneEntityPerOwnerRule(requirements({ exclusion_rules: [] })), null);
});

// ── 접기 ────────────────────────────────────────────────────────────────

test("같은 대표의 명의 셋 중 하나만 남는다", () => {
  const rows = matchProgram(requirements(), [법인, 본점, 지점], { now: NOW });
  const kept = rows.filter((row) => row.verdict !== "mismatch");
  assert.equal(kept.length, 1, "한 공고에 한 명의만 남는다");
  const folded = rows.filter((row) => row.verdict === "mismatch");
  assert.equal(folded.length, 2);
  for (const row of folded) {
    assert.ok(row.reasons[0].startsWith(SAME_OWNER_REASON), row.reasons[0]);
    assert.match(row.reasons[0], /로 신청하세요/);
    assert.match(row.reasons[0], new RegExp(kept[0].targetName.replace(/[()]/g, "\\$&")));
  }
  assert.match(kept[0].reasons[0], /다른 명의/, "남은 줄에 다른 명의를 적어 둔다");
});

test("접은 줄에도 판정 근거는 그대로 남는다", () => {
  const rows = matchProgram(requirements(), [법인, 본점], { now: NOW });
  const folded = rows.find((row) => row.verdict === "mismatch");
  assert.ok(folded.reasons.length > 1, "말머리 한 줄만 남기고 지우지 않는다");
});

test("공고가 한 명의만 받는다고 적었으면 그 문장을 근거로 적는다", () => {
  const rule = "대표자가 같은 다수 기업(법인, 사업체)은 1개 기업만 신청 가능";
  const rows = matchProgram(requirements({ exclusion_rules: [rule] }), [법인, 본점], { now: NOW });
  const folded = rows.find((row) => row.verdict === "mismatch");
  assert.match(folded.reasons[0], /공고가 한 명의만 받습니다/);
  assert.match(folded.reasons[0], /대표자가 같은 다수 기업/);
});

test("공고에 그런 조건이 없으면 우리 원칙으로 접었다고 적는다", () => {
  const rows = matchProgram(requirements(), [법인, 본점], { now: NOW });
  const folded = rows.find((row) => row.verdict === "mismatch");
  assert.match(folded.reasons[0], /한 공고에 한 명의만 냅니다/);
  assert.doesNotMatch(folded.reasons[0], /공고가 한 명의만 받습니다/);
});

test("다른 고객사는 묶이지 않는다", () => {
  const rows = matchProgram(requirements(), [법인, 본점, 셀라벤토], { now: NOW });
  const 셀라 = rows.find((row) => row.targetId === "셀라벤토");
  assert.notEqual(셀라.verdict, "mismatch");
  assert.ok(!셀라.reasons.some((reason) => reason.startsWith(SAME_OWNER_REASON)));
});

test("명의가 하나뿐이면 아무 말도 붙이지 않는다", () => {
  const rows = matchProgram(requirements(), [법인], { now: NOW });
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].reasons.some((reason) => reason.startsWith(SAME_OWNER_REASON)));
});

test("명의 묶음이 없는 자사 요건은 건드리지 않는다", () => {
  const self = (id) => ({ ...entity(), targetKind: "self", targetId: id, targetName: id, ownerKey: null });
  const rows = matchProgram(requirements(), [self("울림컴퍼니"), self("셀라벤토")], { now: NOW });
  assert.equal(rows.filter((row) => row.verdict === "mismatch").length, 0);
});

test("이미 제외된 명의는 접을 거리가 아니다", () => {
  // 지역이 안 맞아 이미 제외된 명의 둘. 접어도 달라지는 것이 없으니 말을 붙이지 않는다.
  const 서울공고 = requirements({ regions: ["서울특별시"] });
  const rows = foldSameOwnerEntities(
    [{ targetKind: "customer", targetId: "a", targetName: "가", verdict: "mismatch", reasons: ["지역 불일치"], score: 0 },
      { targetKind: "customer", targetId: "b", targetName: "나", verdict: "mismatch", reasons: ["지역 불일치"], score: 0 }],
    [entity({ targetId: "a" }), entity({ targetId: "b" })],
    oneEntityPerOwnerRule(서울공고),
  );
  for (const row of rows) assert.deepEqual(row.reasons, ["지역 불일치"]);
});

// ── 어느 명의를 남기나 ───────────────────────────────────────────────────

test("확정 후보가 확인 필요보다 먼저 남는다", () => {
  const rows = foldSameOwnerEntities(
    [{ targetKind: "customer", targetId: "a", targetName: "확인 필요 명의", verdict: "unknown", reasons: ["확인 필요"], score: 99 },
      { targetKind: "customer", targetId: "b", targetName: "후보 명의", verdict: "candidate", reasons: ["명백한 제외 요건에 해당하지 않음"], score: 1 }],
    [entity({ targetId: "a" }), entity({ targetId: "b" })],
    null,
  );
  assert.equal(rows.find((row) => row.verdict !== "mismatch").targetName, "후보 명의",
    "점수가 높아도 확인 필요는 후보를 밀어내지 못한다");
});

test("판정이 같으면 점수가 높은 명의가 남는다", () => {
  const row = (id, name, score) => ({ targetKind: "customer", targetId: id, targetName: name,
    verdict: "candidate", reasons: ["명백한 제외 요건에 해당하지 않음"], score });
  const rows = foldSameOwnerEntities(
    [row("a", "낮은 점수", 10), row("b", "높은 점수", 30)],
    [entity({ targetId: "a" }), entity({ targetId: "b" })], null);
  assert.equal(rows.find((item) => item.verdict !== "mismatch").targetName, "높은 점수");
});

test("점수까지 같으면 이름 순 — 돌릴 때마다 같은 답이 나온다", () => {
  const row = (id, name) => ({ targetKind: "customer", targetId: id, targetName: name,
    verdict: "candidate", reasons: ["명백한 제외 요건에 해당하지 않음"], score: 10 });
  const profiles = [entity({ targetId: "a" }), entity({ targetId: "b" })];
  const 앞 = foldSameOwnerEntities([row("a", "가 명의"), row("b", "나 명의")], profiles, null);
  const 뒤 = foldSameOwnerEntities([row("b", "나 명의"), row("a", "가 명의")],
    [profiles[1], profiles[0]], null);
  assert.equal(앞.find((item) => item.verdict !== "mismatch").targetName, "가 명의");
  assert.equal(뒤.find((item) => item.verdict !== "mismatch").targetName, "가 명의");
});

// ── 순위 ────────────────────────────────────────────────────────────────

test("명의 다섯 개가 후보 수를 다섯 배로 부풀리지 않는다", () => {
  const 명의들 = ["main", "본점", "지점", "창고", "온라인"].map((key) =>
    entity({ targetId: `경동:${key}`, targetName: `경동종합상사 (${key})` }));
  const 경동공고 = matchProgram(requirements(), 명의들, { now: NOW })
    .map((row) => ({ ...row, programId: "경동만 맞는 공고" }));
  const 둘다공고 = matchProgram(requirements(), [법인, 셀라벤토], { now: NOW })
    .map((row) => ({ ...row, programId: "두 고객사가 맞는 공고" }));
  const ranked = rankDailyCandidates([...경동공고, ...둘다공고]);
  assert.equal(ranked[0], "두 고객사가 맞는 공고",
    "경동 명의 다섯 개가 서로 다른 고객사 둘을 밀어내면 안 된다");
});

test("규칙 판이 5다 — 이미 추출한 공고를 추출 없이 다시 판정한다", () => {
  assert.equal(MATCHING_RULE_VERSION, 5);
});
