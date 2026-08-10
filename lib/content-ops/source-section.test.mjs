import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVATE_PORTFOLIO_SOURCE_NOTE,
  publicSourceUrls,
  sourceSectionHtml,
} from "./source-section.ts";

test("공개 HTTP 출처만 중복 없이 정리한다", () => {
  assert.deepEqual(publicSourceUrls([
    "https://www.mss.go.kr/path#part",
    "https://www.mss.go.kr/path",
    "javascript:alert(1)",
    "not-a-url",
  ]), ["https://www.mss.go.kr/path"]);
});

test("복사 원고 하단에 검색 가능한 출처 링크를 만든다", () => {
  const html = sourceSectionHtml(["https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do"]);
  assert.match(html, /<h2>출처<\/h2>/);
  assert.match(html, /href="https:\/\/www\.k-startup\.go\.kr\/web\/contents\/bizpbanc-ongoing\.do"/);
  assert.match(html, />k-startup\.go\.kr<\/a>/);
});

test("비공개 고객 원본을 쓴 포트폴리오는 링크 대신 기밀 출처 안내를 표시한다", () => {
  const html = sourceSectionHtml([], { note: PRIVATE_PORTFOLIO_SOURCE_NOTE });
  assert.match(html, /<h2>출처<\/h2>/);
  assert.match(html, /의뢰인이 제공한 원본 문서/);
  assert.doesNotMatch(html, /<a\b/);
});
