import assert from "node:assert/strict";
import test from "node:test";

import { bodyWithSentenceBreaks, insertSentenceBreaks } from "./sentence-breaks-html.ts";

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

test("원고 묶음에서 본문만 바꾸고 나머지는 그대로 둔다", () => {
  const before = { summary: "요약. 그대로.", bodyHtml: "<p>앞. 뒤.</p>", faq: [] };
  const after = bodyWithSentenceBreaks(before);
  assert.equal(after.bodyHtml, "<p>앞.<br><br>뒤.</p>");
  assert.equal(after.summary, before.summary);
  assert.equal(after.faq, before.faq);
});

test("바꿀 것이 없으면 같은 객체를 돌려준다", () => {
  // 저장할 값이 달라지지 않았는지 바로 알 수 있게 합니다.
  const before = { bodyHtml: "<p>한 문장뿐입니다.</p>" };
  assert.equal(bodyWithSentenceBreaks(before), before);
});

test("링크가 섞인 문장도 끊는다", () => {
  const value = insertSentenceBreaks('<p>자료는 <a href="https://a.kr">여기</a>에 있습니다. 확인해 주세요.</p>');
  assert.ok(value.includes("있습니다.<br><br>확인해 주세요."), value);
});

/*
 * 표와 도식은 건드리지 않습니다.
 *
 * 이 기능은 블로그에만 쓰였고 블로그는 표를 못 씁니다. 그래서 표 안에 빈 줄이
 * 들어가는 문제가 드러날 일이 없었습니다. 칼럼에 붙이려면 먼저 막아야 합니다.
 */

test("표 칸 안에는 빈 줄을 넣지 않는다", () => {
  const html = "<table><tbody><tr><td>첫 문장. 둘째 문장.</td></tr></tbody></table>";
  assert.equal(insertSentenceBreaks(html), html);
});

test("표 머리글과 캡션도 건드리지 않는다", () => {
  const html = "<table><caption>비교 표. 기준일 기준.</caption>"
    + "<thead><tr><th>구분. 항목.</th></tr></thead></table>";
  assert.equal(insertSentenceBreaks(html), html);
});

test("도식 안의 글자에는 넣지 않는다", () => {
  // <br> 이 들어가면 그림이 통째로 깨집니다.
  const html = '<svg viewbox="0 0 10 10"><title>흐름. 단계.</title>'
    + "<text>신청. 심사. 통보.</text></svg>";
  assert.equal(insertSentenceBreaks(html), html);
});

test("표 바깥 문단에는 그대로 넣는다", () => {
  const html = "<p>첫 문장. 둘째 문장.</p><table><tr><td>칸 하나. 칸 둘.</td></tr></table>";
  const output = insertSentenceBreaks(html);
  assert.ok(output.includes("첫 문장.<br><br>둘째 문장."), "문단에는 들어가야 함");
  assert.ok(output.includes("<td>칸 하나. 칸 둘.</td>"), "표 안은 그대로여야 함");
});

test("표가 끝난 뒤 문단은 다시 넣는다", () => {
  // 건너뛰기 구역이 표에서 제대로 닫히는지 봅니다.
  const html = "<table><tr><td>칸. 칸.</td></tr></table><p>다음 문장. 그다음 문장.</p>";
  const output = insertSentenceBreaks(html);
  assert.ok(output.includes("<td>칸. 칸.</td>"));
  assert.ok(output.includes("다음 문장.<br><br>그다음 문장."));
});
