import test from "node:test";
import assert from "node:assert/strict";

import {
  assessNovelty,
  coreTopicKey,
  fingerprintFromPlan,
  stripRegionTokens,
} from "./novelty.ts";

function plan(overrides) {
  return {
    topicFamily: "정부지원사업·R&D",
    primaryTopic: "시제품 제작 지원",
    angle: "처음 신청하는 제조 기업이 확인할 것",
    workingTitle: "시제품 제작 지원사업 신청 전 확인할 것",
    rationale: "제조 기업이 시제품 비용을 줄이는 방법을 설명한다.",
    keyEntities: ["시제품 제작지원", "목업 비용"],
    knowledgeIds: [],
    ...overrides,
  };
}

test("지역 이름과 지역 기관 이름이 비교 대상에서 빠진다", () => {
  assert.equal(stripRegionTokens("부산테크노파크 시제품 제작지원"), "시제품 제작지원");
  assert.equal(stripRegionTokens("울산창조경제혁신센터 시제품 제작 지원"), "시제품 제작 지원");
  // 지역 기관 이름도 함께 빠지므로, 남는 것은 실제 주제뿐입니다.
  assert.equal(stripRegionTokens("경상남도 중소벤처기업청 수출 바우처"), "수출 바우처");
});

test("지역만 다르면 핵심 주제가 같은 것으로 판정된다", () => {
  const busan = fingerprintFromPlan(plan({ keyEntities: ["부산테크노파크 시제품 제작지원"] }));
  const ulsan = fingerprintFromPlan(plan({ keyEntities: ["울산창조경제혁신센터 시제품 제작 지원"] }));
  assert.equal(coreTopicKey(busan), coreTopicKey(ulsan));
});

test("지역만 갈아끼운 주제는 중복으로 차단된다", () => {
  // 실제로 보고된 현상: 같은 주제인데 기관명과 표현만 바뀌어 통과하던 경우
  const candidate = fingerprintFromPlan(plan({
    workingTitle: "울산 제조기업 시제품 제작 지원 안내",
    keyEntities: ["울산창조경제혁신센터 시제품 제작 지원", "개발 예산"],
  }));
  const existing = [{
    id: "old",
    title: "부산 제조기업 시제품 제작지원 안내",
    format: "informational",
    fingerprint: fingerprintFromPlan(plan({
      workingTitle: "부산 제조기업 시제품 제작지원 안내",
      keyEntities: ["부산테크노파크 시제품 제작지원", "목업 비용"],
    })),
  }];
  const assessment = assessNovelty({ candidate, existing, stage: "plan" });
  assert.equal(assessment.duplicate, true, "지역만 바뀐 주제가 통과하면 안 됩니다.");
  assert.ok(assessment.matches[0].reasons.some((reason) => reason.includes("지역")));
});

test("핵심 주제가 다르면 같은 지역이어도 중복이 아니다", () => {
  const candidate = fingerprintFromPlan(plan({
    topicFamily: "기업인증·제품인증·해외인증",
    primaryTopic: "ISO 인증 준비",
    angle: "인증 담당자가 먼저 볼 것",
    workingTitle: "부산 기업 ISO 인증 준비 순서",
    rationale: "인증 준비 순서를 설명한다.",
    keyEntities: ["ISO", "인증 심사"],
  }));
  const existing = [{
    id: "old",
    title: "부산 제조기업 시제품 제작지원 안내",
    format: "informational",
    fingerprint: fingerprintFromPlan(plan({ keyEntities: ["부산테크노파크 시제품 제작지원"] })),
  }];
  assert.equal(assessNovelty({ candidate, existing, stage: "plan" }).duplicate, false);
});
