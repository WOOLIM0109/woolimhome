export type MockupOnlyRestoreState = {
  status: "review_required" | "approved" | "on_hold";
  summary: string | null;
  reviewNote: string | null;
};

const RESTORABLE_STATUSES = new Set<MockupOnlyRestoreState["status"]>([
  "review_required",
  "approved",
  "on_hold",
]);

function restoreState(value: unknown): MockupOnlyRestoreState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (typeof state.status !== "string" || !RESTORABLE_STATUSES.has(
    state.status as MockupOnlyRestoreState["status"],
  )) return null;
  return {
    status: state.status as MockupOnlyRestoreState["status"],
    summary: typeof state.summary === "string" ? state.summary : null,
    reviewNote: typeof state.reviewNote === "string" ? state.reviewNote : null,
  };
}

export function preserveMockupOnlyRestoreState(input: {
  existing: unknown;
  status: unknown;
  summary: unknown;
  reviewNote: unknown;
}): MockupOnlyRestoreState {
  const existing = restoreState(input.existing);
  if (existing) return existing;
  return {
    status: typeof input.status === "string" && RESTORABLE_STATUSES.has(
      input.status as MockupOnlyRestoreState["status"],
    )
      ? input.status as MockupOnlyRestoreState["status"]
      : "review_required",
    summary: typeof input.summary === "string" ? input.summary : null,
    reviewNote: typeof input.reviewNote === "string" ? input.reviewNote : null,
  };
}

export function completedMockupOnlyState(input: {
  restoreState: unknown;
  currentStatus: unknown;
  currentReviewNote: unknown;
}) {
  const restored = restoreState(input.restoreState);
  const status = restored?.status
    || (input.currentStatus === "approved" || input.currentStatus === "on_hold"
      ? input.currentStatus
      : "review_required");
  return {
    status,
    summary: status === "approved"
      ? "승인된 본문은 유지하고 포트폴리오 목업 이미지만 다시 만들었습니다."
      : status === "on_hold"
        ? restored?.summary || "본문은 유지하고 포트폴리오 목업 이미지만 다시 만들었습니다. 보류 사유를 확인해 주세요."
        : "본문은 유지하고 포트폴리오 목업 이미지만 다시 만들었습니다. 새 이미지를 검토해 주세요.",
    reviewNote: status === "review_required"
      ? null
      : restored?.reviewNote
        || (typeof input.currentReviewNote === "string" ? input.currentReviewNote : null),
  };
}
