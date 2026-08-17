import assert from "node:assert/strict";
import test from "node:test";

import { insertSentenceBreaks } from "./sentence-breaks-html.ts";

test("문단 안 문장마다 줄을 바꾼다", () => {
  const value = insertSentenceBreaks("<p>첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.</p>");
  assert.equal(value, "<p>첫 문장입니다.<br><br>둘째 문장입니다.<br><br>셋째 문장입니다.</p>");
});

test("마지막 문장 뒤에는 빈 줄을 남기지 않는다", () => {
  const value = insertSentenceBreaks("<p>한 문장뿐입니다.</p>");
  assert.equal(value, "<p>한 문장뿐입니다.</p>");
});

test("소제목과 그림 설명은 건드리지 않는다", () => {
  // 짧은 제목을 끊으면 오히려 어색합니다.
  const value = insertSentenceBreaks(
    "<h2>먼저 볼 것. 그다음 볼 것.</h2><figure><figcaption>앞. 뒤.</figcaption></figure>",
  );
  assert.ok(!value.includes("<br>"), value);
});

test("목록 항목에도 적용한다", () => {
  const value = insertSentenceBreaks("<ul><li>먼저 확인합니다. 그다음 제출합니다.</li></ul>");
  assert.ok(value.includes("먼저 확인합니다.<br><br>그다음 제출합니다."));
});

test("물음표와 느낌표도 문장 끝으로 본다", () => {
  const value = insertSentenceBreaks("<p>준비되셨나요? 시작해 보세요! 어렵지 않습니다.</p>");
  assert.equal(
    value,
    "<p>준비되셨나요?<br><br>시작해 보세요!<br><br>어렵지 않습니다.</p>",
  );
});

test("이미 줄이 바뀐 원고에 또 넣지 않는다", () => {
  const once = insertSentenceBreaks("<p>첫 문장입니다. 둘째 문장입니다.</p>");
  assert.equal(insertSentenceBreaks(once), once);
});

test("굵은 글씨 안에서 문장이 끝나도 처리한다", () => {
  const value = insertSentenceBreaks("<p><strong>핵심입니다.</strong> 설명이 이어집니다.</p>");
  assert.ok(value.includes("</strong><br><br>설명이 이어집니다."), value);
});

test("소수점과 숫자는 문장 끝으로 보지 않는다", () => {
  // 뒤에 공백이 없으면 문장이 끝난 것이 아닙니다.
  const value = insertSentenceBreaks("<p>지원율은 3.5퍼센트입니다. 확인해 주세요.</p>");
  assert.ok(!value.includes("3.<br>"), value);
  assert.ok(value.includes("3.5퍼센트입니다.<br><br>확인해 주세요."));
});

test("태그가 없는 값은 그대로 돌려준다", () => {
  assert.equal(insertSentenceBreaks("그냥 글입니다. 태그가 없습니다."), "그냥 글입니다. 태그가 없습니다.");
  assert.equal(insertSentenceBreaks(""), "");
});

test("링크가 섞인 문장도 끊는다", () => {
  const value = insertSentenceBreaks('<p>자료는 <a href="https://a.kr">여기</a>에 있습니다. 확인해 주세요.</p>');
  assert.ok(value.includes("있습니다.<br><br>확인해 주세요."), value);
});
