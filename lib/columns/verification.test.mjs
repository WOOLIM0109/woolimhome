import assert from "node:assert/strict";
import test from "node:test";
import {
  getKnowledgeVerification,
  verificationCompletionChanges,
} from "./verification.ts";

function knowledge(raw_text) {
  return { raw_text, perspective: null, case_evidence: null, differentiator: null };
}

test("공개 조사 가능 항목은 대표 확인이 아니라 자동 조사로 분리한다", () => {
  const verification = getKnowledgeVerification(knowledge(
    "지원금은 최대 2천만원이다.\n[공식 확인 필요: 지원금액과 신청기간]",
  ));
  assert.equal(verification.pending, false);
  assert.equal(verification.automaticResearchPending, true);
  assert.equal(verification.items.length, 0);
  assert.equal(verification.automaticItems[0].excerpt, "지원금액과 신청기간");
});

test("외부 조사로 확인할 수 없는 개인정보만 대표 확인 목록에 남긴다", () => {
  const item = knowledge("고객사 사례\n[익명화 필요: 고객사명과 계약금액 공개 동의]");
  const verification = getKnowledgeVerification(item);
  assert.equal(verification.pending, true);
  assert.equal(verification.items[0].kind, "privacy");
  const completed = verificationCompletionChanges(item, "2026-08-04");
  assert.match(completed.raw_text, /익명화 완료: 2026-08-04/);
});

test("대표 확인 완료 처리는 자동 조사 항목을 임의 완료하지 않는다", () => {
  const item = knowledge("[공식 확인 필요: 최신 제도명]\n[익명화 필요: 고객사명]");
  const completed = verificationCompletionChanges(item, "2026-08-04");
  assert.match(completed.raw_text, /공식 확인 필요: 최신 제도명/);
  assert.match(completed.raw_text, /익명화 완료: 2026-08-04/);
});
