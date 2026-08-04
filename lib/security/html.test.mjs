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
  assert.doesNotMatch(result, /script|onclick|onerror|javascript:|<svg/i);
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
