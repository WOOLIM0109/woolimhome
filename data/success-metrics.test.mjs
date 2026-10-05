import assert from "node:assert/strict";
import test from "node:test";
import { getSuccessLedger } from "./success-ledger.ts";
import { calculateSuccessMetrics, floorAchievement, formatWon, getSuccessMetrics } from "./success-metrics.ts";

test("확정 원장의 세 갈래 합계와 건수가 대표 확인값과 일치한다", async () => {
  const m = await getSuccessMetrics();
  assert.deepEqual(m.breakdown.map(({count, amountWon}) => [count, amountWon]), [[23, 2_149_590_000], [5, 2_650_000_000], [1, 200_000_000]]);
  assert.equal(m.totalWon, 4_999_590_000);
  assert.equal(m.total, "49억 9,959만");
  assert.equal(m.funding.amount, "21억 4,959만");
  assert.equal(m.bidding.amount, "26억 5,000만");
  assert.equal(m.investment.amount, "2억");
  assert.equal(m.period, "2023~2026");
  assert.equal(m.summary.largestBid.value, "11억");
  assert.equal(m.summary.largestGrant.value, "8억");
  assert.equal(m.summary.entries.value, "6건");
  assert.equal(m.summary.production.value, "300+");
  assert.equal(m.summary.production.basis, "대표 확정 표기");
  assert.equal(formatWon(m.wposition.totalWon), "13억 9,500만");
  assert.equal(formatWon(m.wposition.fundingWon), "11억 9,500만");
});

test("누적 표기는 억 단위로 내림하고 경계를 넘을 때만 바뀐다", () => {
  assert.equal(floorAchievement(499_959 * 10_000), "49억+");
  assert.equal(floorAchievement(500_000 * 10_000), "50억+");
});

test("인증·기타 다섯 이력은 금액 집계에 더하지 않는다", async () => {
  const ledger = await getSuccessLedger();
  const other = ledger.filter((item) => item.track === "certification");
  assert.equal(other.length, 5);
  assert.ok(other.every((item) => item.amountWon === 0 && item.stage === "final" && item.publicApproved));
  assert.deepEqual(calculateSuccessMetrics(ledger), calculateSuccessMetrics(ledger.filter((item) => item.track !== "certification")));
});

test("서류합격과 공개 미승인 실적은 금액과 최대값에 포함하지 않는다", async () => {
  const ledger = await getSuccessLedger();
  assert.equal(ledger.filter((item) => item.stage === "screening").length, 2);
  const base = calculateSuccessMetrics(ledger);
  const changed = calculateSuccessMetrics([...ledger, {...ledger[0], id: "screening-test", stage: "screening", publicApproved: true, amountWon: 9_000_000_000}, {...ledger[0], id: "private-test", publicApproved: false, amountWon: 9_000_000_000}]);
  assert.deepEqual(changed, base);
  assert.equal(new Set(ledger.map((item) => item.id)).size, ledger.length);
});
