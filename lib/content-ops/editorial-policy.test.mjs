import assert from "node:assert/strict";
import test from "node:test";
import { editorialPublicationIssues } from "./editorial-policy.ts";

// 문체 규칙(숫자 목록, 독자에게 거는 말)을 지킨 본문입니다.
// 이 파일의 검사 목적은 출처 개수와 FAQ 개수이므로, 문체 지적이 섞이지 않도록 규칙을 맞춰 둡니다.
const conciseBody = [
  "<h2>먼저 확인할 세 가지</h2>",
  "<ol><li>대상</li><li>기간</li><li>서류</li></ol>",
  "<p><strong>핵심</strong>을 먼저 확인합니다. 어디부터 보면 좋을까요?</p>",
  "<p><strong>조건</strong>을 나눠서 검토합니다.</p>",
  "<p><strong>자료</strong>를 준비하면 됩니다.</p>",
].join("");
const conciseFaq = Array.from({ length: 3 }, (_, index) => ({
  question: `${index + 1}번째 질문인가요?`,
  answer: "핵심을 먼저 확인하세요.",
}));

test("일반 원고는 공개 출처 2개를 요구한다", () => {
  const issues = editorialPublicationIssues("informational", {
    bodyHtml: conciseBody,
    faq: conciseFaq,
    sourceUrls: ["https://example.com/one"],
  });
  assert.ok(issues.some((issue) => issue.includes("공개 출처")));
});

test("비공개 고객 원본을 쓰는 포트폴리오는 URL 없이도 문체 검수를 통과할 수 있다", () => {
  const issues = editorialPublicationIssues("portfolio", {
    bodyHtml: conciseBody,
    faq: conciseFaq,
    sourceUrls: [],
  });
  assert.deepEqual(issues, []);
});

test("FAQ는 검수 가능한 3~4개로 유지한다", () => {
  const issues = editorialPublicationIssues("portfolio", {
    bodyHtml: conciseBody,
    faq: [],
    sourceUrls: [],
  });
  assert.ok(issues.some((issue) => issue.includes("FAQ는 3~4개")));
});
