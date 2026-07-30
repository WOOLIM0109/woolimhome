import assert from "node:assert/strict";
import test from "node:test";
import { parseTopicPlans } from "./topic-planning.ts";

test("구조화된 주제 후보만 선택한다", () => {
  const plans = parseTopicPlans(JSON.stringify({
    candidates: [
      {
        topicFamily: "기업 연구개발",
        primaryTopic: "기업부설연구소 인적·물적 요건",
        angle: "설립 전 자가 점검",
        audience: "연구소 설립을 준비하는 중소기업 대표",
        keyEntities: ["기업부설연구소", "연구전담요원"],
        workingTitle: "기업부설연구소 설립 전 확인할 세 가지",
        rationale: "최근 정책자금 종합 안내 글과 주제와 독자 문제가 다릅니다.",
        knowledgeIds: [],
      },
    ],
  }));
  assert.equal(plans.length, 1);
  assert.equal(plans[0].primaryTopic, "기업부설연구소 인적·물적 요건");
});

test("문법이 깨진 주제 후보 JSON은 오류로 처리한다", () => {
  assert.throws(
    () => parseTopicPlans('{"candidates":[{"topicFamily":"기획","primaryTopic":"정보 구조"}'),
    SyntaxError,
  );
});
