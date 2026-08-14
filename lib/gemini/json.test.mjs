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

test("JSON 뒤에 군더더기가 붙어도 앞 덩어리를 읽는다", () => {
  // 실제로 보고된 현상: 모델이 JSON 뒤에 설명을 덧붙여
  // "Unexpected non-whitespace character after JSON" 으로 원고가 통째로 버려졌습니다.
  const value = parseGeminiJson('{"title":"제목","tags":["a","b"]}\n\n위와 같이 작성했습니다.');
  assert.equal(value.title, "제목");
  assert.deepEqual(value.tags, ["a", "b"]);
});

test("객체가 두 개 붙어 와도 첫 번째만 쓴다", () => {
  const value = parseGeminiJson('{"title":"첫째"}{"title":"둘째"}');
  assert.equal(value.title, "첫째");
});

test("문자열 안의 중괄호에 속지 않는다", () => {
  const value = parseGeminiJson('{"body":"여는 { 와 닫는 } 를 담은 문장"}\n덧붙임');
  assert.equal(value.body, "여는 { 와 닫는 } 를 담은 문장");
});

test("따옴표를 이스케이프한 문자열도 정확히 끊는다", () => {
  const value = parseGeminiJson('{"body":"큰따옴표 \\" 뒤의 } 까지 문자열"}\n덧붙임');
  assert.equal(value.body, '큰따옴표 " 뒤의 } 까지 문자열');
});

test("응답이 잘려 짝이 맞지 않으면 실패로 둔다", () => {
  // 반쪽짜리 글을 성공으로 넘기면 더 나쁩니다.
  assert.throws(() => parseGeminiJson('{"title":"제목","body":"쓰다 만 문장'));
});
