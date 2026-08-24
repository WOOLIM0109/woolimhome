import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDraft, stringList } from "./normalize.ts";

/**
 * 이 시험들이 막는 것은 하나입니다.
 * AI 응답에서 항목이 빠졌다고 3,500자와 요금이 함께 사라지는 일.
 */

test("usedSourceUrls 가 빠져도 터지지 않는다", () => {
  // 실제로 이것 때문에 죽었습니다.
  // 화면에는 "Cannot read properties of undefined (reading 'map')" 만 떴습니다.
  const draft = normalizeDraft({ title: "제목", bodyHtml: "<p>본문</p>" });
  assert.deepEqual(draft.usedSourceUrls, []);
  assert.deepEqual(draft.usedKnowledgeIds, []);
  assert.deepEqual(draft.tags, []);
  assert.deepEqual(draft.faqs, []);
  assert.deepEqual(draft.expertQuestions, []);
});

test("아무것도 없는 응답도 모양은 갖춘다", () => {
  const draft = normalizeDraft({});
  assert.equal(draft.title, "");
  assert.equal(draft.bodyHtml, "");
  assert.equal(draft.contentKind, "informational");
  // 뒤의 검사가 "본문이 짧습니다"로 걸러 냅니다. 프로그래머 오류보다 낫습니다.
});

test("빠진 것을 지어내지 않는다", () => {
  const draft = normalizeDraft({ title: "제목" });
  assert.equal(draft.excerpt, "");
  assert.equal(draft.audience, "");
  assert.equal(draft.coreMessage, "");
});

test("배열 자리에 다른 것이 와도 빈 배열로 둔다", () => {
  const draft = normalizeDraft({ usedSourceUrls: "https://a.go.kr", tags: 3, faqs: null });
  assert.deepEqual(draft.usedSourceUrls, []);
  assert.deepEqual(draft.tags, []);
  assert.deepEqual(draft.faqs, []);
});

test("배열 안에 문자열이 아닌 것이 섞여도 걸러 낸다", () => {
  assert.deepEqual(stringList(["a", 1, null, { b: 2 }, "c"]), ["a", "c"]);
  assert.deepEqual(stringList(["  띄어쓰기  ", "   "]), ["띄어쓰기"]);
});

test("멀쩡한 값은 그대로 지나간다", () => {
  const draft = normalizeDraft({
    title: "사업계획서 심사 기준",
    slug: "review-criteria",
    contentKind: "hybrid",
    tags: ["사업계획서", "심사"],
    bodyHtml: "<p>본문</p>",
    usedSourceUrls: ["https://www.mss.go.kr/a", "https://www.bizinfo.go.kr/b"],
    faqs: [{ question: "질문", answer: "답" }],
  });
  assert.equal(draft.title, "사업계획서 심사 기준");
  assert.equal(draft.contentKind, "hybrid");
  assert.deepEqual(draft.tags, ["사업계획서", "심사"]);
  assert.equal(draft.usedSourceUrls.length, 2);
  assert.deepEqual(draft.faqs, [{ question: "질문", answer: "답" }]);
});

test("모르는 유형은 informational 로 낮춘다", () => {
  // 표의 제약에 없는 값을 저장하면 마지막 줄에서 통째로 거절당합니다(#129).
  assert.equal(normalizeDraft({ contentKind: "칼럼" }).contentKind, "informational");
  assert.equal(normalizeDraft({ contentKind: 7 }).contentKind, "informational");
});

test("FAQ 에 빈 껍데기가 섞여도 걸러 낸다", () => {
  const draft = normalizeDraft({
    faqs: [{ question: "질문", answer: "답" }, {}, null, { question: "", answer: "" }],
  });
  assert.equal(draft.faqs.length, 1);
});

test("목록이 지나치게 길면 잘라 낸다", () => {
  // 30개 출처를 붙여 오면 뒤에서 전부 대조하느라 시간만 씁니다.
  const many = Array.from({ length: 200 }, (_, i) => `https://www.mss.go.kr/${i}`);
  assert.equal(normalizeDraft({ usedSourceUrls: many }).usedSourceUrls.length, 30);
});
