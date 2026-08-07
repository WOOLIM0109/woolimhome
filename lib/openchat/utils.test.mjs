import assert from "node:assert/strict";
import test from "node:test";
import { programDetailIssue } from "./utils.ts";

test("원문 참조뿐인 공고는 게시 후보로 통과시키지 않는다", () => {
  assert.equal(programDetailIssue({
    applicantSummary: "공고별 신청 요건을 충족하는 예비창업자·소상공인·중소기업",
    supportSummary: "세부 지원 내용과 금액은 원문 공고문 확인 필요",
    applicationMethod: "접수방법은 원문 공고문 참조",
    applicationPeriodText: "공고문 참조",
  }), "신청대상 누락");
});

test("대상·금액·기간·접수방법이 있는 공고는 게시 후보가 된다", () => {
  assert.equal(programDetailIssue({
    applicantSummary: "창업 7년 이내 기업, 신산업 분야는 창업 10년 이내 기업",
    supportSummary: "협업 지원금 최대 2억원과 창업성장기술개발 R&D 연계를 지원",
    applicationMethod: "K-Startup 온라인 접수",
    applicationPeriodText: "2026.08.06 14:00 ~ 2026.08.26 16:00",
  }), null);
});

test("자금 지원이라고 쓰고 금액을 빠뜨리면 게시 후보로 통과시키지 않는다", () => {
  assert.equal(programDetailIssue({
    applicantSummary: "만 39세 이하 예비창업자 또는 창업 3년 미만 기업",
    supportSummary: "선택형 사업화 자금과 멘토링을 지원",
    applicationMethod: "온라인 접수",
    applicationPeriodText: "2026.08.03 ~ 2026.08.28",
  }), "지원금액 누락");
});
