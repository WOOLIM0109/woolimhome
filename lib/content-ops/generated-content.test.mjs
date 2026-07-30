import assert from "node:assert/strict";
import test from "node:test";
import {
  editorialRevisionNote,
  parseGeneratedContent,
} from "./generated-content.ts";

const valid = {
  title: "제목",
  summary: "요약",
  bodyHtml: "<h2>본문</h2><p>내용</p>",
  faq: [{ question: "질문?", answer: "답변" }],
  tags: ["기획"],
  sourceUrls: ["https://example.com"],
};

test("코드 펜스와 앞뒤 설명이 있어도 JSON 객체를 읽는다", () => {
  const parsed = parseGeneratedContent(`설명\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n끝`);
  assert.deepEqual(parsed, valid);
});

test("문법이 깨진 JSON은 성공으로 처리하지 않는다", () => {
  assert.throws(
    () => parseGeneratedContent('{"title":"제목" "summary":"요약"}'),
    /JSON|Expected/,
  );
});

test("기술 오류 메시지는 수정 지시문으로 재사용하지 않는다", () => {
  assert.equal(
    editorialRevisionNote("Expected ',' or '}' after property value in JSON at position 4842"),
    null,
  );
  assert.equal(
    editorialRevisionNote("첫 문단을 더 친근하게 바꾸고 실제 사례를 강조해 주세요."),
    "첫 문단을 더 친근하게 바꾸고 실제 사례를 강조해 주세요.",
  );
});
