export type GeminiErrorCode =
  | "GEMINI_RATE_LIMIT"
  | "GEMINI_QUOTA_EXHAUSTED"
  | "GEMINI_SERVER_ERROR"
  | "GEMINI_TIMEOUT"
  | "GEMINI_REQUEST_FAILED"
  | "GEMINI_EMPTY_RESPONSE"
  | "GEMINI_DISABLED"
  | "GEMINI_APPROVAL_REQUIRED";

export type GeminiNetworkAttempt = {
  attempt: number;
  startedAt: string;
  completedAt: string;
  outcome: "completed" | "failed";
  httpStatus: number | null;
  errorCode: GeminiErrorCode | null;
  retryable: boolean;
  retryAfterMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
};

export class GeminiRequestError extends Error {
  code: GeminiErrorCode;
  retryable: boolean;
  status: number | null;
  retryAfterMs: number | null;
  networkAttempts: number;
  attempts: GeminiNetworkAttempt[];

  constructor(input: {
    code: GeminiErrorCode;
    message: string;
    retryable: boolean;
    status?: number | null;
    retryAfterMs?: number | null;
    networkAttempts?: number;
    attempts?: GeminiNetworkAttempt[];
  }) {
    super(input.message);
    this.name = "GeminiRequestError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status ?? null;
    this.retryAfterMs = input.retryAfterMs ?? null;
    this.networkAttempts = input.networkAttempts ?? 0;
    this.attempts = input.attempts ?? [];
  }
}

export function geminiRetryDecision(error: unknown, retryCount: number) {
  const typed = error instanceof GeminiRequestError ? error : null;
  const nextRetryCount = retryCount + 1;
  return {
    // Durable/background retries are forbidden in cost-protection mode.
    // The user must explicitly prepare and retry only failed review items.
    retryable: false,
    retryCount: nextRetryCount,
    nextRetryAt: null,
    code: typed?.code || "UNKNOWN",
  };
}
