import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_ATTEMPTS,
  AI_BATCH_LIMITS,
  AI_INPUT_LIMITS,
  AI_OUTPUT_LIMITS,
  COLUMN_MIN_BODY_CHARS,
  RESEARCH_REUSE_HOURS,
} from "./ai-budget.ts";

test("새 글 한 편의 최악 호출 수에 상한이 있다", () => {
  // 주제 후보 × (조사 1 + 보정 × JSON 재요청)
  const worstCase =
    AI_ATTEMPTS.articlePlans * (1 + AI_ATTEMPTS.articleRepair * AI_ATTEMPTS.jsonReparse);
  assert.ok(worstCase <= 10, `최악 호출 수가 ${worstCase}회입니다. 10회 이하로 유지하세요.`);
});

test("주제 후보 시도가 다시 늘어나지 않는다", () => {
  assert.ok(AI_ATTEMPTS.articlePlans >= 1);
  assert.ok(
    AI_ATTEMPTS.articlePlans <= 2,
    "후보를 늘리면 후보마다 공식자료 조사가 다시 실행되어 요금이 비례해 증가합니다.",
  );
});

test("조사 결과 재사용 기간이 설정되어 있다", () => {
  assert.ok(
    RESEARCH_REUSE_HOURS >= 1,
    "0이면 문구 하나만 고쳐도 Google 검색 조사가 매번 다시 실행됩니다.",
  );
});

test("한 번의 관리자 클릭이 처리할 건수에 상한이 있다", () => {
  assert.ok(
    AI_BATCH_LIMITS.styleRevisionPerRun > 0 && AI_BATCH_LIMITS.styleRevisionPerRun <= 30,
    "상한이 없으면 문체 규칙을 한 번 바꿀 때 밀린 원고 전체가 다시 작성됩니다.",
  );
});

test("입력 자료 길이에 모두 상한이 있다", () => {
  for (const [name, value] of Object.entries(AI_INPUT_LIMITS)) {
    assert.ok(Number.isFinite(value) && value > 0, `${name} 상한이 설정되지 않았습니다.`);
  }
});

test("출력 상한이 목표 분량보다 지나치게 크지 않다", () => {
  for (const [name, value] of Object.entries(AI_OUTPUT_LIMITS)) {
    assert.ok(value <= 16000, `${name} 출력 상한 ${value}이 과도합니다.`);
  }
});

test("칼럼 재생성 기준이 목표 분량보다 낮다", () => {
  assert.ok(
    COLUMN_MIN_BODY_CHARS < 3000,
    "재생성 기준이 높으면 글 한 편마다 전체 재생성이 한 번 더 일어납니다.",
  );
});
