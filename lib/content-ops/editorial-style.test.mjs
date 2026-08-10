import assert from "node:assert/strict";
import test from "node:test";
import {
  conciseStyleIssues,
  faqAnswerHtml,
  faqQuestionHtml,
  friendlyStyleIssues,
  safeInlineStrongHtml,
  stripFaqDisplayFormatting,
  stripFaqPrefix,
} from "./editorial-style.ts";
import {
  assertSameNumericFacts,
  lockValue,
  numericFacts,
  restoreLocked,
} from "./protected-markers.ts";

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
  assert.equal(
    faqQuestionHtml("Q. R&amp;D 지원 조건은 무엇인가요?"),
    "<strong>Q. R&amp;D 지원 조건은 무엇인가요?</strong>",
  );
  assert.equal(
    faqAnswerHtml("A. R&amp;amp;D 요건을 확인하세요."),
    "A. R&amp;D 요건을 확인하세요.",
  );
});

test("화면용 FAQ의 추가 이스케이프와 줄바꿈만 한 겹 제거한다", () => {
  assert.equal(
    stripFaqDisplayFormatting("<strong>Q. R&amp;amp;D 조건은 무엇인가요?<br><br></strong>"),
    "R&amp;D 조건은 무엇인가요?",
  );
  assert.equal(
    stripFaqDisplayFormatting("A. 기업마당(www.bizinfo.go.kr)에서 확인하세요.<br><br>"),
    "기업마당(www.bizinfo.go.kr)에서 확인하세요.",
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

test("긴 AI 문장과 장황한 FAQ 답변을 검출한다", () => {
  const longSentence = `${"복잡한 설명과 불필요한 수식어를 계속 이어 붙이는 문장입니다 ".repeat(7)}.`;
  const issues = friendlyStyleIssues(
    `<p><strong>핵심</strong>${longSentence}</p><p><strong>기준</strong>${longSentence}</p>`,
    [{ question: "무엇인가요?", answer: `${"같은 답을 길게 반복합니다. ".repeat(12)}` }],
  );
  assert.ok(issues.some((issue) => issue.includes("긴 문장")));
  assert.ok(issues.some((issue) => issue.includes("FAQ 답변")));
});

test("본문에 100자를 넘는 문장이 하나만 있어도 검출한다", () => {
  const longSentence = `${"한 문장에는 하나의 판단만 담아야 한다는 설명을 불필요하게 반복합니다".repeat(5)}.`;
  const issues = conciseStyleIssues(`<p>${longSentence}</p><p>짧은 문장입니다.</p>`);

  assert.ok(issues.some((issue) => issue.includes("100자를 넘는 긴 문장")));
});

test("FAQ 질문은 한 문장, 답변은 1~2문장과 180자 이하로 제한한다", () => {
  const invalidQuestion = conciseStyleIssues("<p>짧은 본문입니다.</p>", [{
    question: "준비할 자료가 있나요? 언제 제출하나요?",
    answer: "사업계획서를 준비하세요.",
  }]);
  assert.ok(invalidQuestion.some((issue) => issue.includes("FAQ 질문")));

  const tooManyAnswerSentences = conciseStyleIssues("<p>짧은 본문입니다.</p>", [{
    question: "준비할 자료가 있나요?",
    answer: "사업계획서를 준비하세요. 재무자료도 확인하세요. 제출 전 다시 검토하세요.",
  }]);
  assert.ok(tooManyAnswerSentences.some((issue) => issue.includes("FAQ 답변")));

  const tooLongAnswer = conciseStyleIssues("<p>짧은 본문입니다.</p>", [{
    question: "준비할 자료가 있나요?",
    answer: `${"필요한 자료를 확인하고 빠짐없이 준비해 제출하세요".repeat(10)}.`,
  }]);
  assert.ok(tooLongAnswer.some((issue) => issue.includes("FAQ 답변")));

  assert.deepEqual(conciseStyleIssues("<p>짧은 본문입니다.</p>", [{
    question: "준비할 자료가 있나요?",
    answer: "사업계획서를 준비하세요. 제출 전 수치를 다시 확인하세요.",
  }]), []);
});

test("소수점은 문장 종결 마침표로 세지 않는다", () => {
  assert.deepEqual(conciseStyleIssues("<p>짧은 본문입니다.</p>", [{
    question: "연 2.9% 금리는 어떻게 적용되나요?",
    answer: "연 2.9% 조건은 공고문을 기준으로 확인하세요. 신청 전에 최신 조건을 다시 확인하세요.",
  }]), []);
});

test("도메인 내부의 점은 문장 종결 마침표로 세지 않는다", () => {
  assert.deepEqual(conciseStyleIssues("<p>짧은 본문입니다.</p>", [{
    question: "bizinfo.go.kr에서 무엇을 확인하나요?",
    answer: "bizinfo.go.kr에서 신청 기간을 확인하세요. 제출 전 최신 공고를 다시 확인하세요.",
  }]), []);
});

test("명시적인 AI 상투어 한 건과 과도한 볼드를 검출한다", () => {
  const issues = friendlyStyleIssues(
    "<p><strong>오늘날</strong> <strong>기업은</strong> <strong>빠르게 변화하는</strong> 환경을 확인해야 합니다.</p>",
  );

  assert.ok(issues.includes("AI 상투 표현이 반복됩니다."));
  assert.ok(issues.includes("본문 볼드가 너무 많습니다."));
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

test("문체 수정 전후의 수치는 순서와 무관하게 정확히 대조한다", () => {
  assert.deepEqual(numericFacts("2026년 3개월 동안 2회"), ["2026년", "2회", "3개월"]);
  assert.doesNotThrow(() => assertSameNumericFacts("3개월 동안 2회", "2회 확인하고 3개월 유지"));
  assert.throws(
    () => assertSameNumericFacts("3개월 동안 2회", "3개월 동안 1회"),
    /빠진 수치: 2회; 추가·변경된 수치: 1회/,
  );
});
