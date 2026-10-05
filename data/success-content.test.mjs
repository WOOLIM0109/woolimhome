import assert from "node:assert/strict";
import test from "node:test";
import "../lib/testing/server-only.mjs";
const { getConsultingCases, getPptCases, getQuickWins, getCaseHighlights } = await import("./success-content.ts");
import { getSuccessLedger } from "./success-ledger.ts";

test("확정 선정 사례만 노출하고 모든 금액을 원장으로부터 구성한다", async () => {
  const cases = await getConsultingCases();
  assert.equal(cases.length, 3);
  assert.equal(cases.some((item) => item.slug === "sleep-tech-rnd"), false);
  const featured = cases.find((item) => item.slug === "ai-platform-tips");
  assert.equal(featured.headline, "13억 9,500만 원");
  assert.equal(featured.wins.length, 8);
  assert.equal(featured.resultSummary, "지원사업 7건 선정 · 투자유치 1건");
  const pet = cases.find((item) => item.slug === "pet-product-growth");
  assert.equal(pet.headline, "4,000만 원");
  assert.equal(pet.wins.length, 1);
  assert.doesNotMatch(pet.wins.join(" "), /청년창업사관학교/);
  assert.equal((await getQuickWins())[0].amount, "4,000만 원");
  assert.equal((await getCaseHighlights())[1].result, "11억 원 낙찰");
});

test("입찰 5건·입점 6건·수상 2건과 원장 연결을 검증한다", async () => {
  const groups = await getPptCases();
  const ledger = await getSuccessLedger();
  assert.deepEqual(groups.map((group) => group.items.length), [5, 6, 2]);
  assert.equal(groups[0].items[0].result, "11억 원 낙찰");
  for (const item of groups.slice(0, 2).flatMap((group) => group.items)) {
    const record = ledger.find((record) => record.id === item.ledgerId);
    assert.ok(record && record.publicApproved && record.stage === "final");
  }
  const text = JSON.stringify(groups);
  for (const name of ["CJ올리브네트웍스", "부산 금정구", "광양", "다이소", "홈플러스", "무신사", "현대캐피탈", "더현대", "CJ온스타일", "카카오", "부평소방서", "롯데케미칼"]) assert.ok(text.includes(name), name);
  assert.doesNotMatch(text, /seoul-public-service/);
});
