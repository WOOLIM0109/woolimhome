import assert from "node:assert/strict";
import test from "node:test";
import {
  knowledgeAreasForChannel,
  knowledgeRequiredForSlot,
  mostRelevantKnowledgeId,
} from "./knowledge-routing.ts";

test("컨설팅과 홈페이지는 전 분야를 본다", () => {
  /*
   * 예전에는 컨설팅에서 design 과 planning 을 뺐습니다. 그러면 그 카드들이
   * 홈페이지 칼럼에서만 쓰여 한쪽으로 쏠립니다. 기획은 울림의 핵심 분야이고
   * 컨설팅 글에도 문서·시각화 기획 노하우가 필요합니다.
   */
  assert.equal(knowledgeAreasForChannel("naver_consulting").length, 7);
  assert.equal(knowledgeAreasForChannel("homepage").length, 7);
  assert.deepEqual(
    knowledgeAreasForChannel("naver_consulting"),
    knowledgeAreasForChannel("homepage"),
  );
});

test("디자인만 분야를 좁힌다", () => {
  // 정책자금 노하우가 디자인 블로그 글에 섞이면 안 됩니다.
  const design = knowledgeAreasForChannel("naver_design");
  assert.deepEqual(design, ["design", "ir_ppt", "planning"]);
  assert.ok(!design.includes("government_support"));
});

test("울림의 판단이 중심인 글에만 노하우를 요구한다", () => {
  // 원천자료가 없으면 쓸 내용 자체가 없는 자리입니다. 보류되는 것이 맞습니다.
  assert.equal(knowledgeRequiredForSlot({ channel: "homepage", format: "column" }), true);
  assert.equal(knowledgeRequiredForSlot({ channel: "homepage", format: "authority" }), true);
  assert.equal(knowledgeRequiredForSlot({ channel: "naver_consulting", format: "authority" }), true);
});

test("디자인 인사이트에는 노하우를 요구하지 않는다", () => {
  /*
   * 예전에는 요구했습니다. 그래서 목요일마다 글을 3,000자 다 써 놓고
   * 마지막 검사에서 "원천자료 미사용" 으로 보류됐습니다. 쓸 만한 디자인
   * 카드가 없으면 몇 번을 돌려도 같은 자리에서 걸렸습니다.
   *
   * 이제 컨설팅 정보형과 같은 길입니다. 공식 자료를 조사해 쓰고, 맞는
   * 원천자료가 있으면 본문에 한두 번 섞고, 없으면 넣지 않고 넘어갑니다.
   */
  assert.equal(knowledgeRequiredForSlot({ channel: "naver_design", format: "design_insight" }), false);
  assert.equal(knowledgeRequiredForSlot({ channel: "naver_consulting", format: "informational" }), false);
  assert.equal(knowledgeRequiredForSlot({ channel: "naver_design", format: "portfolio" }), false);
});

test("기존 디자인 초안 수정에는 주제와 가장 가까운 노하우를 연결한다", () => {
  const selected = mostRelevantKnowledgeId({
    topicFamily: "기획·디자인",
    primaryTopic: "PPT 정보 구조와 거버닝 메시지",
    angle: "발표 자료의 가독성",
    workingTitle: "멀리서도 보이는 PPT를 만드는 법",
    keyEntities: ["PPT", "정보 구조"],
  }, [
    { id: "support", topic: "정부지원사업", raw_text: "지원금 신청과 정책자금" },
    { id: "ppt", topic: "PPT 거버닝 메시지", raw_text: "PPT 정보 구조와 가독성을 설계한다" },
  ]);
  assert.equal(selected, "ppt");
});
