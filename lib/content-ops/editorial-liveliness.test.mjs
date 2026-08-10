import test from "node:test";
import assert from "node:assert/strict";

import { friendlyStyleIssues } from "./editorial-style.ts";

const 볼드 = "<strong>핵심</strong>";
function 글(본문) {
  // 볼드 개수 부족으로 다른 지적이 섞이지 않도록 채워 둡니다.
  return `${본문}<p>${볼드} 하나</p><p>${볼드} 둘</p><p>${볼드} 셋</p><p>${볼드} 넷</p><p>${볼드} 다섯</p>`;
}
const 지적 = (본문) => friendlyStyleIssues(글(본문), [], { requireLiveliness: true }).join(" ");

test("질문도 느낌표도 없으면 지적한다", () => {
  const result = 지적("<h2>지원 요건</h2><ol><li>첫째</li></ol><p>요건을 확인합니다.</p>");
  assert.match(result, /질문이나 느낌표/);
});

test("질문이 있으면 지적하지 않는다", () => {
  const result = 지적("<h2>확인할 세 가지</h2><ol><li>첫째</li></ol><p>어디부터 보면 될까요?</p>");
  assert.doesNotMatch(result, /질문이나 느낌표/);
});

test("숫자 목록이 없으면 지적한다", () => {
  const result = 지적("<h2>지원 요건</h2><p>요건을 확인해 보세요!</p>");
  assert.match(result, /숫자를 앞세운 목록/);
});

test("숫자를 넣은 소제목이 있으면 목록 지적을 하지 않는다", () => {
  const result = 지적("<h2>먼저 확인할 세 가지</h2><p>요건을 확인해 보세요!</p>");
  assert.doesNotMatch(result, /숫자를 앞세운 목록/);
});

test("목록 태그가 있으면 목록 지적을 하지 않는다", () => {
  const result = 지적("<h2>지원 요건</h2><ul><li>첫째</li><li>둘째</li></ul><p>확인해 보세요!</p>");
  assert.doesNotMatch(result, /숫자를 앞세운 목록/);
});

test("느낌표가 너무 많으면 줄이라고 한다", () => {
  const result = 지적("<h2>세 가지 확인</h2><ol><li>첫째</li></ol><p>좋아요! 정말요! 대단해요! 최고예요! 굉장해요!</p>");
  assert.match(result, /느낌표가 5회/);
});

test("새로 추가한 AI 상투 표현을 잡아낸다", () => {
  for (const 표현 of ["알아보겠습니다", "정리해 보았습니다", "무엇보다도", "핵심은 바로"]) {
    const result = 지적(`<h2>세 가지</h2><ol><li>첫째</li></ol><p>${표현} 확인해 보세요!</p>`);
    assert.match(result, /AI 상투 표현/, `${표현} 을 잡지 못했습니다.`);
  }
});

test("규칙 적용을 끄면 목록·기호를 요구하지 않는다", () => {
  const result = friendlyStyleIssues(글("<h2>지원 요건</h2><p>요건을 확인합니다.</p>")).join(" ");
  assert.doesNotMatch(result, /질문이나 느낌표|숫자를 앞세운 목록/);
});

test("규칙을 지킨 글은 문체 지적이 없다", () => {
  const result = 지적(
    "<h2>먼저 볼 세 가지</h2><ol><li>대상</li><li>기간</li><li>서류</li></ol>"
    + "<p>어디부터 보면 좋을까요? 대상 요건부터 확인해 보세요!</p>",
  );
  assert.doesNotMatch(result, /질문이나 느낌표|숫자를 앞세운 목록|AI 상투 표현/);
});
