export type GeminiErrorCode =
  | "GEMINI_RATE_LIMIT"
  | "GEMINI_QUOTA_EXHAUSTED"
  | "GEMINI_SERVER_ERROR"
  | "GEMINI_TIMEOUT"
  | "GEMINI_REQUEST_FAILED"
  | "GEMINI_EMPTY_RESPONSE";

export class GeminiRequestError extends Error {
  code: GeminiErrorCode;
  retryable: boolean;
  status: number | null;
  retryAfterMs: number | null;

  constructor(input: {
    code: GeminiErrorCode;
    message: string;
    retryable: boolean;
    status?: number | null;
    retryAfterMs?: number | null;
  }) {
    super(input.message);
    this.name = "GeminiRequestError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status ?? null;
    this.retryAfterMs = input.retryAfterMs ?? null;
  }
}

export function geminiRetryDecision(error: unknown, retryCount: number, now = new Date()) {
  const typed = error instanceof GeminiRequestError ? error : null;
  const retryable = typed?.retryable === true;
  const nextRetryCount = retryCount + 1;
  if (!retryable || nextRetryCount > 6) {
    return { retryable: false, retryCount: nextRetryCount, nextRetryAt: null, code: typed?.code || "UNKNOWN" };
  }
  const normalDelays = [5, 15, 60, 180, 360, 1_440];
  const quotaDelays = [360, 720, 1_440, 1_440, 1_440, 1_440];
  const minutes = (typed?.code === "GEMINI_QUOTA_EXHAUSTED" ? quotaDelays : normalDelays)[nextRetryCount - 1];
  const delayMs = Math.max(minutes * 60_000, typed?.retryAfterMs || 0);
  return {
    retryable: true,
    retryCount: nextRetryCount,
    nextRetryAt: new Date(now.getTime() + delayMs).toISOString(),
    code: typed?.code || "UNKNOWN",
  };
}
