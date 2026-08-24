import assert from "node:assert/strict";
import test from "node:test";
import {
  COLUMN_TOPIC_FAMILIES,
  familyOfPost,
  parseColumnTopicPlans,
  pickFreshPlan,
  recentColumnSummary,
  underusedFamilies,
} from "./topic-plan.ts";

/**
 * 이 시험들이 지키는 것은 하나입니다.
 * 최근에 지원사업만 썼으면, 다음 주제는 지원사업이 아니어야 합니다.
 */

test("주제군 목록은 컨설팅 블로그와 같은 것을 쓴다", () => {
  // 두 채널이 서로 다른 목록을 갖게 되면 한쪽만 조용히 좁아집니다.
  assert.ok(COLUMN_TOPIC_FAMILIES.length >= 10);
  assert.ok(COLUMN_TOPIC_FAMILIES.includes("마케팅·영업"));
  assert.ok(COLUMN_TOPIC_FAMILIES.includes("재무·수익구조"));
});

test("기록된 주제군을 그대로 읽는다", () => {
  assert.equal(
    familyOfPost({ generation_metadata: { topicPlan: { topicFamily: "마케팅·영업" } } }),
    "마케팅·영업",
  );
});

test("목록에 없는 주제군은 믿지 않는다", () => {
  assert.equal(
    familyOfPost({ generation_metadata: { topicPlan: { topicFamily: "아무거나" } }, title: "" }),
    null,
  );
});

test("기록이 없는 옛날 글은 제목으로 짐작한다", () => {
  // 이게 없으면 쌓여 있는 글이 전부 '미분류'가 되어, 최근에 뭘 썼는지 알 수 없습니다.
  assert.equal(familyOfPost({ title: "정책자금 융자 신청 전 점검할 것" }), "정책자금·융자·투자유치");
  assert.equal(familyOfPost({ title: "특허 출원 순서" }), "기술사업화·지식재산");
  assert.equal(familyOfPost({ title: "", tags: ["마케팅"] }), "마케팅·영업");
  assert.equal(familyOfPost({ title: "봄 소풍 이야기" }), null);
});

test("최근에 지원사업만 썼으면 지원사업이 뒤로 밀린다", () => {
  const posts = Array.from({ length: 8 }, () => ({
    generation_metadata: { topicPlan: { topicFamily: "정부지원사업·R&D" } },
  }));
  const families = underusedFamilies(posts, 6);
  assert.ok(!families.includes("정부지원사업·R&D"), "가장 많이 쓴 주제군이 우선 목록에 들어감");
  assert.equal(families.length, 6);
});

test("한 번도 안 쓴 주제군이 앞에 온다", () => {
  const posts = [
    { generation_metadata: { topicPlan: { topicFamily: "마케팅·영업" } } },
    { generation_metadata: { topicPlan: { topicFamily: "마케팅·영업" } } },
  ];
  const families = underusedFamilies(posts, 3);
  assert.ok(!families.includes("마케팅·영업"));
});

test("글이 하나도 없으면 그냥 목록을 준다", () => {
  const families = underusedFamilies([], 5);
  assert.equal(families.length, 5);
  families.forEach((family) => assert.ok(COLUMN_TOPIC_FAMILIES.includes(family)));
});

test("최근 글 요약은 제목과 주제군만 넘긴다", () => {
  const summary = recentColumnSummary([{
    title: "정책자금 점검",
    created_at: "2026-08-01T09:00:00Z",
    generation_metadata: { topicPlan: { topicFamily: "정책자금·융자·투자유치" } },
  }]);
  assert.deepEqual(summary, [{
    title: "정책자금 점검",
    family: "정책자금·융자·투자유치",
    date: "2026-08-01",
  }]);
});

test("주제 후보 JSON을 읽는다", () => {
  const raw = JSON.stringify({
    candidates: [{
      topicFamily: "마케팅·영업",
      primaryTopic: "첫 거래처를 잃은 뒤 할 일",
      angle: "이탈 원인부터 본다",
      audience: "거래처 두 곳에 매출이 몰린 제조업 대표",
      workingTitle: "거래처 하나가 빠졌을 때",
      rationale: "최근에 안 다룸",
    }],
  });
  const plans = parseColumnTopicPlans(raw);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].topicFamily, "마케팅·영업");
});

test("코드 울타리가 붙어 와도 읽는다", () => {
  const raw = "```json\n" + JSON.stringify({
    candidates: [{
      topicFamily: "재무·수익구조", primaryTopic: "a", angle: "b",
      audience: "c", workingTitle: "d", rationale: "e",
    }],
  }) + "\n```";
  assert.equal(parseColumnTopicPlans(raw).length, 1);
});

test("빈 칸이 있는 후보는 버린다", () => {
  const raw = JSON.stringify({
    candidates: [
      { topicFamily: "재무·수익구조", primaryTopic: "", angle: "b", audience: "c", workingTitle: "d", rationale: "e" },
      { topicFamily: "마케팅·영업", primaryTopic: "a", angle: "b", audience: "c", workingTitle: "d", rationale: "e" },
    ],
  });
  const plans = parseColumnTopicPlans(raw);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].topicFamily, "마케팅·영업");
});

test("읽을 수 없는 응답은 조용히 넘어가지 않는다", () => {
  assert.throws(() => parseColumnTopicPlans("주제를 못 정하겠습니다"));
  assert.throws(() => parseColumnTopicPlans(""));
});

const plan = (primaryTopic, workingTitle) => ({
  topicFamily: "정부지원사업·R&D",
  primaryTopic,
  angle: "a",
  audience: "b",
  workingTitle,
  rationale: "c",
});

test("지난 글과 거의 같은 후보는 건너뛴다", () => {
  const picked = pickFreshPlan(
    [plan("모두의 창업 프로젝트 신청", "모두의 창업 프로젝트 신청 방법"), plan("수출 바우처 준비", "수출 바우처 준비")],
    ["모두의 창업 프로젝트 신청 방법"],
  );
  assert.equal(picked.primaryTopic, "수출 바우처 준비");
});

test("전부 겹치면 그래도 하나는 내놓는다", () => {
  // 아무것도 안 내놓으면 그날 칼럼이 통째로 없습니다. 겹쳐도 사람이 고칠 수 있습니다.
  const picked = pickFreshPlan([plan("같은 주제", "같은 주제")], ["같은 주제"]);
  assert.equal(picked.primaryTopic, "같은 주제");
});

test("후보가 없으면 null", () => {
  assert.equal(pickFreshPlan([], ["무엇이든"]), null);
});
