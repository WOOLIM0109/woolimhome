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

test("이스케이프하지 않은 큰따옴표는 여기서 못 살린다", () => {
  /*
   * 08-25 칼럼 회차가 이렇게 사라졌습니다.
   *
   *     Expected ',' or '}' after property value in JSON at position 3640
   *
   * 값 안의 " 에서 문자열이 끝난 것으로 읽히고, 그 뒤 글자에서 문법이
   * 깨집니다. 제어문자 복구는 0x20 미만만 고치므로 여기엔 손을 못 댑니다.
   * 앞 덩어리만 잘라 내는 방법도 소용없습니다 — 짝이 이미 어긋났습니다.
   *
   * 이 시험은 "고쳐 주는 코드를 넣으면 되잖아" 를 막으려고 있습니다.
   * 어디까지가 값이고 어디부터가 문법인지 글자만 보고는 알 수 없습니다.
   * 추측으로 고치면 본문 한가운데가 잘려 나갑니다.
   *
   * 답은 하나뿐입니다 — 부를 때 responseSchema 를 넘겨서 모델이 문법을
   * 지킨 JSON 을 돌려주게 하는 것(lib/columns/draft-schema.ts).
   */
  const broken = '{"bodyHtml":"<p>대표님이 "무형의 서비스"라고 하셨습니다.</p>","title":"칼럼"}';
  assert.throws(() => parseGeminiJson(broken));
});

test("깨진 응답의 오류에는 어디서 깨졌는지가 남는다", () => {
  // 자리를 알아야 기록에 남긴 원문 앞부분과 맞춰 볼 수 있습니다.
  try {
    parseGeminiJson('{"a":"값 "안" 따옴표","b":1}');
    assert.fail("깨진 JSON 이 통과했습니다.");
  } catch (error) {
    assert.match(error.message, /position \d+/);
  }
});
