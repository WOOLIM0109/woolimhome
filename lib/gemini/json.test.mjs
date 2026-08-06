import assert from "node:assert/strict";
import test from "node:test";
import { escapeJsonStringControlCharacters, parseGeminiJson } from "./json.ts";

test("문자열 안의 이스케이프되지 않은 제어문자를 복구한다", () => {
  const malformed = '{"bodyHtml":"<p>첫 줄\n둘째 줄\t설명</p>","title":"칼럼"}';
  assert.deepEqual(parseGeminiJson(malformed), {
    bodyHtml: "<p>첫 줄\n둘째 줄\t설명</p>",
    title: "칼럼",
  });
});

test("JSON 구조 밖의 정상 줄바꿈은 그대로 둔다", () => {
  const formatted = '{\n  "title": "정상 JSON"\n}';
  assert.equal(escapeJsonStringControlCharacters(formatted), formatted);
  assert.deepEqual(parseGeminiJson(formatted), { title: "정상 JSON" });
});

test("이미 이스케이프된 줄바꿈을 중복 처리하지 않는다", () => {
  const valid = '{"bodyHtml":"첫 줄\\n둘째 줄"}';
  assert.deepEqual(parseGeminiJson(valid), { bodyHtml: "첫 줄\n둘째 줄" });
});
