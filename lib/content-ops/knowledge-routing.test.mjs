import assert from "node:assert/strict";
import test from "node:test";
import {
  knowledgeAreasForChannel,
  knowledgeRequiredForSlot,
  mostRelevantKnowledgeId,
} from "./knowledge-routing.ts";

test("채널별로 허용된 노하우 전문 분야를 분리한다", () => {
  assert.deepEqual(knowledgeAreasForChannel("naver_consulting"), [
    "management", "government_support", "business_plan", "ir_ppt", "general",
  ]);
  assert.deepEqual(knowledgeAreasForChannel("naver_design"), ["design", "ir_ppt", "planning"]);
  assert.equal(knowledgeAreasForChannel("homepage").length, 7);
});

test("하이브리드·울림 콘텐츠·디자인 인사이트에 노하우를 요구한다", () => {
  assert.equal(knowledgeRequiredForSlot({ channel: "homepage", format: "column" }), true);
  assert.equal(knowledgeRequiredForSlot({ channel: "homepage", format: "authority" }), true);
  assert.equal(knowledgeRequiredForSlot({ channel: "naver_consulting", format: "authority" }), true);
  assert.equal(knowledgeRequiredForSlot({ channel: "naver_design", format: "design_insight" }), true);
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
