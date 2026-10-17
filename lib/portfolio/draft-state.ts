/** Waiting is terminal for automatic retries; only an explicit admin retry requeues it. */
export function portfolioDraftQueueState(runtime: { enabled: boolean; reason: string | null }) {
  return {
    status: runtime.enabled ? "queued" : "draft_waiting",
    last_error_code: runtime.enabled ? null : "GEMINI_DISABLED",
    error_message: runtime.enabled ? null : runtime.reason,
  };
}

export function portfolioDraftFailure(error: unknown) {
  const value = error as { code?: string; message?: string } | null;
  return {
    status: "draft_waiting" as const,
    next_retry_at: null,
    last_error_code: value?.code || "PORTFOLIO_DRAFT_ERROR",
    error_message: value?.message || "포트폴리오 본문 생성 오류",
  };
}
