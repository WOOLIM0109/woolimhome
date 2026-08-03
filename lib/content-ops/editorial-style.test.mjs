import assert from "node:assert/strict";
import test from "node:test";
import {
  faqAnswerHtml,
  faqQuestionHtml,
  friendlyStyleIssues,
  safeInlineStrongHtml,
  stripFaqPrefix,
} from "./editorial-style.ts";
import { lockValue, restoreLocked } from "./protected-markers.ts";

test("FAQ 접두어를 중복 없이 제거한다", () => {
  assert.equal(stripFaqPrefix("Q. 어떤 자료가 필요한가요?"), "어떤 자료가 필요한가요?");
  assert.equal(stripFaqPrefix("A: 결산자료가 필요합니다."), "결산자료가 필요합니다.");
  assert.equal(stripFaqPrefix("<strong>Q. 어떤 자료가 필요한가요?</strong>"), "어떤 자료가 필요한가요?");
  assert.equal(stripFaqPrefix("질문입니다"), "질문입니다");
});

test("복사 HTML에 Q.와 A.를 한 번만 표시한다", () => {
  assert.equal(
    faqQuestionHtml("Q. 어떤 자료가 필요한가요?"),
    "<strong>Q. 어떤 자료가 필요한가요?</strong>",
  );
  assert.equal(
    faqAnswerHtml("A. <strong>결산자료</strong>를 준비하세요."),
    "A. <strong>결산자료</strong>를 준비하세요.",
  );
});

test("FAQ 인라인 HTML은 strong만 보존한다", () => {
  assert.equal(
    safeInlineStrongHtml('<img src=x onerror=alert(1)><strong>핵심</strong>'),
    "&lt;img src=x onerror=alert(1)&gt;<strong>핵심</strong>",
  );
});

test("본문 볼드 부족과 AI 상투어 반복을 찾는다", () => {
  const issues = friendlyStyleIssues("<p>오늘날 중요합니다.</p><p>빠르게 변화하는 환경이 중요합니다.</p><p>결론적으로 중요합니다.</p>");
  assert.ok(issues.includes("본문 핵심어 볼드가 부족합니다."));
  assert.ok(issues.includes("AI 상투 표현이 반복됩니다."));
});

test("보호 마커는 원문 문서 순서 그대로 복원된다", () => {
  const source = '<p>2026년 안내입니다.</p><a href="https://example.com">출처</a><figure><img src="x.jpg" /></figure><p>3개월 뒤 확인합니다.</p>';
  const locked = lockValue(source, "BODY", true);
  assert.equal(restoreLocked(locked.value, locked.locks), source);
});

test("수치 순서 변경은 허용하지만 링크와 이미지 순서 변경은 막는다", () => {
  const numeric = lockValue("3개월 동안 2회 확인", "NUMBER");
  const reversedNumeric = numeric.value.replace(
    numeric.locks[0].marker,
    "TEMPLOCK",
  ).replace(numeric.locks[1].marker, numeric.locks[0].marker).replace("TEMPLOCK", numeric.locks[1].marker);
  assert.equal(restoreLocked(reversedNumeric, numeric.locks), "2회 동안 3개월 확인");

  const assets = lockValue('<a href="https://example.com">출처</a><figure>이미지</figure>', "ASSET", true);
  const reversedAssets = assets.value.replace(
    assets.locks[0].marker,
    "TEMPLOCK",
  ).replace(assets.locks[1].marker, assets.locks[0].marker).replace("TEMPLOCK", assets.locks[1].marker);
  assert.throws(() => restoreLocked(reversedAssets, assets.locks), /링크·이미지의 순서/);
});
