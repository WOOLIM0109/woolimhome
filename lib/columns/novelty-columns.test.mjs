import assert from "node:assert/strict";
import test from "node:test";
import { assessNovelty } from "../content-ops/novelty.ts";
import { comparableColumns, columnTopicPlanningRules } from "./topic-plan.ts";

const fingerprint = (over = {}) => ({
  title: "정책자금 신청 전 점검",
  summary: "",
  headings: [],
  bodyText: "",
  tags: ["정책자금"],
  sourceHosts: ["www.mss.go.kr", "www.bizinfo.go.kr"],
  topicFamily: "정책자금·융자·투자유치",
  primaryTopic: "정책자금 신청 전 점검",
  angle: "서류부터 본다",
  keyEntities: ["정책자금"],
  ...over,
});

test("같은 출처를 다시 써도 그것만으로는 중복이 아니다", () => {
  /*
   * 칼럼은 같은 공고를 근거로 다른 관점의 글을 여러 편 씁니다.
   * 출처가 같다는 이유로 막으면 지원사업 글을 두 번 못 씁니다.
   */
  const existing = [{
    id: "1",
    title: "수출바우처 신청 순서",
    format: "column",
    fingerprint: fingerprint({
      title: "수출바우처 신청 순서",
      topicFamily: "수출·해외진출",
      primaryTopic: "수출바우처 신청 순서",
      angle: "일정부터 본다",
      tags: ["수출바우처"],
      keyEntities: ["수출바우처"],
    }),
  }];
  const withSources = assessNovelty({ candidate: fingerprint(), existing, stage: "article" });
  const without = assessNovelty({
    candidate: fingerprint(), existing, stage: "article", ignoreSources: true,
  });
  assert.ok(without.riskScore <= withSources.riskScore, "출처를 빼면 점수가 오르면 안 됨");
  assert.equal(without.duplicate, false);
});

test("주제가 정말 같으면 출처를 빼도 중복으로 잡는다", () => {
  // 느슨하게 만든 게 아니라 출처 항목만 뺀 것이어야 합니다.
  const existing = [{
    id: "1", title: "정책자금 신청 전 점검", format: "column", fingerprint: fingerprint({ sourceHosts: [] }),
  }];
  const result = assessNovelty({
    candidate: fingerprint({ sourceHosts: [] }), existing, stage: "article", ignoreSources: true,
  });
  assert.equal(result.duplicate, true);
});

test("출처를 빼도 점수 눈금이 통째로 낮아지지 않는다", () => {
  // 가중치 합으로 나누지 않으면 문턱값 58점이 사실상 느슨해집니다.
  const existing = [{
    id: "1", title: "정책자금 신청 전 점검", format: "column", fingerprint: fingerprint(),
  }];
  const result = assessNovelty({
    candidate: fingerprint(), existing, stage: "article", ignoreSources: true,
  });
  assert.ok(result.riskScore >= 58, `눈금이 낮아짐: ${result.riskScore}점`);
});

test("지난 칼럼을 비교용 모양으로 바꾼다", () => {
  const items = comparableColumns([{
    id: "a",
    title: "정책자금 점검",
    tags: ["정책자금"],
    generation_metadata: { topicPlan: { topicFamily: "정책자금·융자·투자유치", primaryTopic: "점검" } },
  }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].fingerprint.topicFamily, "정책자금·융자·투자유치");
  assert.equal(items[0].fingerprint.primaryTopic, "점검");
});

test("기록이 없는 옛 글은 제목·태그로 채운다", () => {
  const items = comparableColumns([{ id: "b", title: "특허 출원 순서", tags: [] }]);
  assert.equal(items[0].fingerprint.topicFamily, "기술사업화·지식재산");
  assert.equal(items[0].fingerprint.primaryTopic, "특허 출원 순서");
});

test("주제를 적어 주면 그 주제를 바꾸지 말라고 못 박는다", () => {
  const rules = columnTopicPlanningRules({
    families: ["마케팅·영업"],
    recent: [],
    feedTitles: [],
    topicHint: "거래처 하나가 빠졌을 때",
  });
  assert.match(rules, /지정된 주제/);
  assert.match(rules, /거래처 하나가 빠졌을 때/);
  assert.match(rules, /주제를 바꾸지 않는다/);
  assert.match(rules, /겹쳐도 괜찮다/);
});

test("주제를 안 적으면 평소 기획 지시문이 나온다", () => {
  const rules = columnTopicPlanningRules({
    families: ["마케팅·영업"], recent: [], feedTitles: [],
  });
  assert.match(rules, /후보 5개/);
  assert.ok(!rules.includes("지정된 주제"));
});
