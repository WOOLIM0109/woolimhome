import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeGeneratedHtml, sanitizeInlineHtml, sanitizeWorkItemMetadata } from "./html.ts";

test("generated HTML keeps the editorial allowlist and removes executable markup", () => {
  const result = sanitizeGeneratedHtml(`
    <h2 onclick="alert(1)">제목</h2>
    <script>alert(1)</script>
    <p><a href="javascript:alert(1)">위험</a><strong>안전</strong></p>
    <img src="https://example.com/image.png" onerror="alert(1)">
    <svg><script>alert(2)</script></svg>
  `);
  assert.match(result, /<h2>제목<\/h2>/);
  assert.match(result, /<strong>안전<\/strong>/);
  assert.match(result, /loading="lazy"/);
  assert.doesNotMatch(result, /script|onclick|onerror|javascript:/i);
  // 도식 태그 자체는 이제 허용합니다. 다만 그 안에 심은 실행 코드는 그대로
  // 걸러집니다. 어떤 것이 통과하고 어떤 것이 막히는지는
  // lib/content-ops/diagram.test.mjs 에서 자세히 확인합니다.
  assert.doesNotMatch(result, /alert\(2\)/);
});

test("inline HTML permits emphasis only", () => {
  assert.equal(sanitizeInlineHtml('<strong>강조</strong><a href="https://example.com">링크</a>'), "<strong>강조</strong>링크");
});

test("stored generated content is sanitized without mutating unrelated metadata", () => {
  const original = { generated: { bodyHtml: '<p onmouseover="x">본문</p>', faq: [{ question: "<b>질문</b>", answer: "<strong>답</strong>" }] }, marker: 1 };
  const result = sanitizeWorkItemMetadata(original);
  assert.deepEqual(result, { generated: { bodyHtml: "<p>본문</p>", faq: [{ question: "질문", answer: "<strong>답</strong>" }] }, marker: 1 });
  assert.match(original.generated.bodyHtml, /onmouseover/);
});

/**
 * 비교 표는 글로 풀어 쓰기 어려운 내용을 한눈에 보여 줍니다. 예전에는 표
 * 태그가 허용 목록에 없어서, 관리자가 표를 넣어도 칸이 사라지고 글자만
 * 줄줄이 남았습니다. 저장은 되는데 화면에서만 무너져서 알아채기 어려웠습니다.
 */
test("본문의 표는 칸 구조를 그대로 지킨다", () => {
  const result = sanitizeGeneratedHtml(`
    <table>
      <caption>1기와 2기 비교</caption>
      <thead><tr><th scope="col">항목</th><th scope="col">1기</th></tr></thead>
      <tbody><tr><td>총 선발</td><td colspan="2">5,000명</td></tr></tbody>
    </table>
  `);
  for (const tag of ["table", "caption", "thead", "tbody", "tr", "th", "td"]) {
    assert.match(result, new RegExp(`<${tag}[\\s>]`), `${tag} 태그가 사라졌습니다`);
  }
  assert.match(result, /scope="col"/);
  assert.match(result, /colspan="2"/);
  assert.match(result, /총 선발/);
});

test("표 안에 끼어든 실행 코드는 그대로 걸러진다", () => {
  const result = sanitizeGeneratedHtml(
    '<table><tr><td onclick="alert(1)">칸</td>'
    + '<td><script>alert(2)</script></td></tr></table>',
  );
  assert.doesNotMatch(result, /onclick/);
  assert.doesNotMatch(result, /alert/);
  assert.match(result, /칸/);
});
