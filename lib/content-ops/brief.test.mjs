import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIEF_LIMITS,
  briefPlanningRules,
  briefWritingRules,
  parseContentBrief,
  splitBriefSourceUrls,
} from "./brief.ts";

test("아무것도 넣지 않으면 주문서가 없는 것으로 본다", () => {
  assert.equal(parseContentBrief({}), null);
  assert.equal(parseContentBrief(null), null);
  assert.equal(parseContentBrief({ topicHint: "   ", sourceMaterial: "", sourceUrls: [] }), null);
});

test("주제 한 단어만 있어도 주문서가 된다", () => {
  const brief = parseContentBrief({ topicHint: "  모두의 창업 2기  " });
  assert.equal(brief?.topicHint, "모두의 창업 2기");
  assert.equal(brief?.sourceMaterial, "");
  assert.deepEqual(brief?.sourceUrls, []);
});

test("붙여넣은 자료만 있어도 주문서가 된다", () => {
  const brief = parseContentBrief({ sourceMaterial: "공고문 전문..." });
  assert.equal(brief?.sourceMaterial, "공고문 전문...");
  assert.equal(brief?.topicHint, "");
});

test("너무 긴 입력은 상한에서 자른다", () => {
  const brief = parseContentBrief({
    topicHint: "가".repeat(BRIEF_LIMITS.topicHint + 50),
    sourceMaterial: "나".repeat(BRIEF_LIMITS.sourceMaterial + 500),
  });
  assert.equal(brief?.topicHint.length, BRIEF_LIMITS.topicHint);
  assert.equal(brief?.sourceMaterial.length, BRIEF_LIMITS.sourceMaterial);
});

test("링크는 중복을 없애고 개수를 제한한다", () => {
  const many = Array.from({ length: BRIEF_LIMITS.sourceUrls + 5 }, (_, index) => `https://www.mss.go.kr/${index}`);
  const brief = parseContentBrief({ sourceUrls: [...many, many[0], "", 42] });
  assert.equal(brief?.sourceUrls.length, BRIEF_LIMITS.sourceUrls);
  assert.equal(new Set(brief?.sourceUrls).size, BRIEF_LIMITS.sourceUrls);
});

test("공공기관 주소만 읽고 나머지는 돌려준다", () => {
  const brief = parseContentBrief({
    sourceUrls: [
      "https://www.mss.go.kr/notice",
      "https://www.k-startup.go.kr/notice",
      "https://blog.naver.com/somebody",
      "http://www.mss.go.kr/insecure",
    ],
  });
  const { allowed, rejected } = splitBriefSourceUrls(brief);
  assert.deepEqual(allowed, ["https://www.mss.go.kr/notice", "https://www.k-startup.go.kr/notice"]);
  // 걸러진 주소는 조용히 사라지지 않아야 합니다. 붙였는데 아무 일도 없으면
  // 왜 반영되지 않았는지 알 길이 없습니다.
  assert.deepEqual(rejected, ["https://blog.naver.com/somebody", "http://www.mss.go.kr/insecure"]);
});

test("주문서가 없으면 지시문을 붙이지 않는다", () => {
  assert.equal(briefPlanningRules(null), "");
  assert.equal(briefWritingRules(null), "");
  assert.deepEqual(splitBriefSourceUrls(null), { allowed: [], rejected: [] });
});

test("주제를 지정하면 그 주제 안에서만 후보를 만들게 한다", () => {
  const rules = briefPlanningRules(parseContentBrief({ topicHint: "모두의 창업 2기" }));
  assert.match(rules, /모두의 창업 2기/);
  assert.match(rules, /다른 주제로 넘어가지 않는다/);
});

test("붙여넣은 자료는 근거가 아니라 재료로만 쓰게 한다", () => {
  const rules = briefWritingRules(parseContentBrief({ sourceMaterial: "1기에는 6만 2,944명이 몰렸습니다." }));
  assert.match(rules, /1기에는 6만 2,944명이 몰렸습니다\./);
  // 붙여넣은 자료를 근거로 인정해 버리면 사실 확인 절차가 통째로 무력해집니다.
  assert.match(rules, /그 자체로 근거가 되지 않습니다/);
  assert.match(rules, /\[공식 확인 완료\]로 확인된 값만/);
  assert.match(rules, /그대로 옮겨 쓰지 않습니다/);
});

test("자료 없이 주제만 준 경우에는 자료 관련 지시를 붙이지 않는다", () => {
  const rules = briefWritingRules(parseContentBrief({ topicHint: "정책자금" }));
  assert.match(rules, /정책자금/);
  assert.doesNotMatch(rules, /참고 자료/);
});
