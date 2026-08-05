import assert from "node:assert/strict";
import test from "node:test";
import {
  completedMockupOnlyState,
  preserveMockupOnlyRestoreState,
} from "./mockup-only-state.ts";

test("keeps the original review state across repeated conversion retries", () => {
  const first = preserveMockupOnlyRestoreState({
    existing: null,
    status: "review_required",
    summary: "기존 검토 요약",
    reviewNote: null,
  });
  assert.deepEqual(preserveMockupOnlyRestoreState({
    existing: first,
    status: "creating",
    summary: "22장 변환 중",
    reviewNote: "임시 상태",
  }), first);
});

test("returns a preserved draft to review instead of leaving it creating", () => {
  assert.deepEqual(completedMockupOnlyState({
    restoreState: null,
    currentStatus: "creating",
    currentReviewNote: "임시 상태",
  }), {
    status: "review_required",
    summary: "본문은 유지하고 포트폴리오 목업 이미지만 다시 만들었습니다. 새 이미지를 검토해 주세요.",
    reviewNote: null,
  });
});

test("keeps an explicit approved state without a stale conversion summary", () => {
  assert.deepEqual(completedMockupOnlyState({
    restoreState: { status: "approved", summary: "14장 변환 완료", reviewNote: "승인 메모" },
    currentStatus: "creating",
    currentReviewNote: null,
  }), {
    status: "approved",
    summary: "승인된 본문은 유지하고 포트폴리오 목업 이미지만 다시 만들었습니다.",
    reviewNote: "승인 메모",
  });
});
