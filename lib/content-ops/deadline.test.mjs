import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATION_BUDGET_MS,
  GENERATION_DEADLINE,
  STAGE_BUDGET_MS,
  assertStageFits,
  deadlineExceeded,
  isDeadlineError,
} from "./deadline.ts";

const NOW = 1_700_000_000_000;

test("마감이 없으면 언제나 통과한다", () => {
  // 관리자가 직접 누른 요청처럼 시간을 재지 않는 경우입니다.
  assert.equal(deadlineExceeded("articleBody", null, NOW), false);
  assert.equal(deadlineExceeded("articleBody", undefined, NOW), false);
  assert.doesNotThrow(() => assertStageFits("articleBody", null, NOW));
});

test("그 단계를 끝낼 시간이 남아 있으면 시작한다", () => {
  const deadlineAt = NOW + STAGE_BUDGET_MS.research + 1_000;
  assert.equal(deadlineExceeded("research", deadlineAt, NOW), false);
  assert.doesNotThrow(() => assertStageFits("research", deadlineAt, NOW));
});

test("시간이 모자라면 부르기 전에 멈춘다", () => {
  // 핵심입니다. 시작해 놓고 죽으면 요금은 나가고 결과는 남지 않습니다.
  const deadlineAt = NOW + STAGE_BUDGET_MS.research - 1;
  assert.equal(deadlineExceeded("research", deadlineAt, NOW), true);
  assert.throws(() => assertStageFits("research", deadlineAt, NOW), (error) => {
    assert.equal(error.message, GENERATION_DEADLINE);
    return true;
  });
});

test("이미 지난 마감에서는 어느 단계도 시작하지 않는다", () => {
  const past = NOW - 1;
  for (const stage of ["topicPlan", "research", "articleBody"]) {
    assert.equal(deadlineExceeded(stage, past, NOW), true, stage);
  }
});

test("본문은 조사보다 넉넉하게 잡는다", () => {
  // 본문은 보정과 재요청이 붙어 한 번으로 끝나지 않습니다.
  assert.ok(STAGE_BUDGET_MS.articleBody > STAGE_BUDGET_MS.research);
  assert.ok(STAGE_BUDGET_MS.research >= STAGE_BUDGET_MS.topicPlan);
});

test("미룬 것과 진짜 실패를 구별한다", () => {
  // 미룬 것을 실패로 세면 두 번 만에 그 자리가 영영 건너뛰어집니다.
  assert.equal(isDeadlineError(new Error(GENERATION_DEADLINE)), true);
  assert.equal(isDeadlineError(new Error("AI 응답이 비어 있습니다.")), false);
  assert.equal(isDeadlineError("GENERATION_DEADLINE"), false);
  assert.equal(isDeadlineError(null), false);
});

test("세 단계를 한 번씩 거치는 최소 경로가 예산 안에 들어간다", () => {
  /*
   * 이 시험이 이 파일에서 가장 중요합니다.
   *
   * 단계별 예산의 합이 원고 몫보다 크면, 앞 단계를 지나 뒷 단계에 닿았을 때
   * 남은 시간이 늘 모자랍니다. 그러면 자동 생성은 언제나 '미뤘습니다'만
   * 남기고 한 편도 만들지 못합니다. 시간 초과로 죽는 것보다 조용해서
   * 오히려 알아채기 어렵습니다.
   */
  const total = STAGE_BUDGET_MS.topicPlan + STAGE_BUDGET_MS.research + STAGE_BUDGET_MS.articleBody;
  assert.ok(
    total <= GENERATION_BUDGET_MS,
    `세 단계 합이 ${total}ms 인데 원고 몫이 ${GENERATION_BUDGET_MS}ms 입니다. 한 편도 만들지 못합니다.`,
  );
});

test("처음 시작할 때는 세 단계가 모두 통과한다", () => {
  // 예산을 막 받은 시점에서 각 단계가 시작 가능한지 봅니다.
  const deadlineAt = NOW + GENERATION_BUDGET_MS;
  let elapsed = 0;
  for (const stage of ["topicPlan", "research", "articleBody"]) {
    assert.equal(
      deadlineExceeded(stage, deadlineAt, NOW + elapsed),
      false,
      `${stage} 단계에서 막혔습니다.`,
    );
    elapsed += STAGE_BUDGET_MS[stage];
  }
});
