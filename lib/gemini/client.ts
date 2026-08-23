import { redactGeminiTextParts } from "../security/privacy.ts";
import { extractGeminiGrounding } from "./grounding.ts";
import { assertGeminiInvocationAllowed } from "./protection.ts";
import { reportGeminiUsage } from "./usage-sink.ts";
import { GeminiRequestError } from "./retry.ts";
import type { GeminiNetworkAttempt } from "./retry.ts";
export { GeminiRequestError, geminiRetryDecision } from "./retry.ts";
export type { GeminiGroundingSource } from "./grounding.ts";

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

function apiKey() {
  const value = process.env.GEMINI_API_KEY;
  if (!value) {
    throw new GeminiRequestError({
      code: "GEMINI_REQUEST_FAILED",
      message: "Gemini API key is not configured.",
      retryable: false,
    });
  }
  return value;
}

function retryAfterMs(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Google 이 보낸 설명을 꺼냅니다.
 *
 * 응답 본문은 보통 {"error":{"message":"..."}} 모양입니다. 그 안의 문장이
 * 진짜 이유입니다. 결제가 막혀서인지, 무료 등급을 다 써서인지, 분당 제한에
 * 걸린 것인지가 거기 적혀 있습니다.
 */
export function geminiErrorDetail(body: string) {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 400);
  } catch {
    // JSON 이 아니면 본문 앞부분이라도 씁니다. 없는 것보다 낫습니다.
  }
  const plain = body.replace(/\s+/g, " ").trim();
  return plain ? plain.slice(0, 400) : "";
}

function withDetail(message: string, detail: string) {
  return detail ? `${message} Google 응답: ${detail}` : message;
}

function classifyHttpError(status: number, body: string, retryDelay: number | null) {
  /**
   * Google 이 보낸 설명을 그대로 붙입니다.
   *
   * 예전에는 저희가 만든 한 문장으로 덮어썼습니다. 429 는 무조건
   * "일시적으로 소진되었습니다" 로 바뀌었는데, 결제가 막혀서 난 것이면
   * 기다려도 영영 풀리지 않습니다. 사람은 그 문장만 보고 내일 다시 되겠거니
   * 하고, 원인을 찾을 실마리는 어디에도 남지 않았습니다.
   */
  const detail = geminiErrorDetail(body);
  const quotaExhausted = status === 429 && /quota|billing|per.?day|resource_exhausted/i.test(body);
  if (quotaExhausted) {
    // 결제·등급 문제와 분당 제한은 대응이 정반대입니다. 앞의 것은 기다려도
    // 풀리지 않고, 뒤의 것은 기다리면 풀립니다. 그래서 나눠서 알려 줍니다.
    const billing = /billing|not enabled|disabled|free tier|payment/i.test(body);
    return new GeminiRequestError({
      code: "GEMINI_QUOTA_EXHAUSTED",
      message: withDetail(
        billing
          ? "Gemini 결제 또는 등급 문제로 호출이 거부되었습니다. 기다려도 풀리지 않습니다. Google Cloud 결제 설정을 확인해 주세요."
          : "Gemini 할당량을 다 썼습니다. 하루 한도라면 내일 풀립니다.",
        detail,
      ),
      retryable: !billing,
      status,
      retryAfterMs: retryDelay,
    });
  }
  if (status === 429) {
    return new GeminiRequestError({
      code: "GEMINI_RATE_LIMIT",
      message: withDetail("Gemini 분당 요청 제한에 걸렸습니다. 잠시 뒤 다시 됩니다.", detail),
      retryable: true,
      status,
      retryAfterMs: retryDelay,
    });
  }
  if ([500, 502, 503, 504].includes(status)) {
    return new GeminiRequestError({
      code: "GEMINI_SERVER_ERROR",
      message: withDetail(`Gemini 쪽 일시적인 오류입니다 (${status}).`, detail),
      retryable: true,
      status,
      retryAfterMs: retryDelay,
    });
  }
  if (status === 401 || status === 403) {
    return new GeminiRequestError({
      code: "GEMINI_REQUEST_FAILED",
      message: withDetail(
        `Gemini 가 요청을 거부했습니다 (${status}). API 키가 잘못되었거나 권한이 없습니다.`,
        detail,
      ),
      retryable: false,
      status,
    });
  }
  return new GeminiRequestError({
    code: "GEMINI_REQUEST_FAILED",
    message: withDetail(`Gemini 호출이 실패했습니다 (${status}).`, detail),
    retryable: false,
    status,
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateGeminiText(input: {
  parts: GeminiPart[];
  generationConfig?: Record<string, unknown>;
  model?: string;
  timeoutMs?: number;
  attempts?: number;
  tools?: Array<Record<string, unknown>>;
}) {
  const model = input.model || "gemini-3.5-flash";
  try {
    assertGeminiInvocationAllowed(model);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini 호출이 차단되어 있습니다.";
    throw new GeminiRequestError({
      code: /확인/.test(message) ? "GEMINI_APPROVAL_REQUIRED" : "GEMINI_DISABLED",
      message,
      retryable: false,
      networkAttempts: 0,
    });
  }
  // One logical user review normally makes one request. A second transport
  // attempt is allowed only when the caller explicitly requests it, and only
  // for retryable 429/5xx responses.
  const attempts = Math.max(1, Math.min(input.attempts || 1, 2));
  const { parts, redactionCount } = redactGeminiTextParts(input.parts);
  let lastError: GeminiRequestError | null = null;
  let networkAttempts = 0;
  const attemptLog: GeminiNetworkAttempt[] = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const startedAt = new Date().toISOString();
    try {
      networkAttempts += 1;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: input.generationConfig || {},
            ...(input.tools?.length ? { tools: input.tools } : {}),
          }),
          signal: AbortSignal.timeout(input.timeoutMs || 120_000),
        },
      );
      if (!response.ok) {
        lastError = classifyHttpError(
          response.status,
          (await response.text()).slice(0, 2_000),
          retryAfterMs(response),
        );
        lastError.networkAttempts = networkAttempts;
        attemptLog.push({
          attempt: networkAttempts,
          startedAt,
          completedAt: new Date().toISOString(),
          outcome: "failed",
          httpStatus: response.status,
          errorCode: lastError.code,
          retryable: lastError.retryable,
          retryAfterMs: lastError.retryAfterMs,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
        });
        lastError.attempts = [...attemptLog];
        if (!lastError.retryable || attempt === attempts - 1) throw lastError;
        await wait(Math.min(15_000, Math.max(lastError.retryAfterMs || 0, 1_500)));
        continue;
      }
      const payload = await response.json();
      // 답이 잘렸는지 알려 주는 값입니다. MAX_TOKENS 면 한도에 걸려 끊긴 것입니다.
      const finishReason = typeof payload.candidates?.[0]?.finishReason === "string"
        ? String(payload.candidates[0].finishReason)
        : null;
      const text = payload.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || "").join("")?.trim();
      if (!text) {
        throw new GeminiRequestError({
          code: "GEMINI_EMPTY_RESPONSE",
          message: "Gemini returned an empty response.",
          retryable: false,
          status: response.status,
          networkAttempts,
        });
      }
      const usageMetadata = payload.usageMetadata || {};
      const inputTokens = Number(usageMetadata.promptTokenCount || 0);
      const candidateTokens = Number(usageMetadata.candidatesTokenCount || 0);
      const thoughtsTokens = Number(usageMetadata.thoughtsTokenCount || 0);
      const totalTokens = Number(usageMetadata.totalTokenCount || 0);
      const usage = {
        inputTokens,
        // Thinking and other generated tokens can be billable even when they
        // are not present in candidatesTokenCount. Count the larger known
        // output total so the cost cap fails conservatively.
        outputTokens: Math.max(candidateTokens + thoughtsTokens, totalTokens - inputTokens, 0),
        candidateTokens,
        thoughtsTokens,
        totalTokens,
        cachedInputTokens: Number(usageMetadata.cachedContentTokenCount || 0),
      };
      attemptLog.push({
        attempt: networkAttempts,
        startedAt,
        completedAt: new Date().toISOString(),
        outcome: "completed",
        httpStatus: response.status,
        errorCode: null,
        retryable: false,
        retryAfterMs: null,
        ...usage,
      });
      // 자동 생성 작업이 실제로 쓴 양을 모아, 끝난 뒤 예약값 대신 실제값으로 기록합니다.
      reportGeminiUsage({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        networkAttempts,
      });
      return {
        text,
        finishReason,
        redactionCount,
        networkAttempts,
        usage,
        attempts: attemptLog,
        ...extractGeminiGrounding(payload),
      };
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        lastError = error;
        lastError.networkAttempts = networkAttempts;
      } else {
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        lastError = new GeminiRequestError({
          code: timedOut ? "GEMINI_TIMEOUT" : "GEMINI_REQUEST_FAILED",
          message: timedOut ? "Gemini request timed out." : "Gemini request could not be completed.",
          retryable: false,
          networkAttempts,
        });
      }
      if (!attemptLog.some((entry) => entry.attempt === networkAttempts)) {
        attemptLog.push({
          attempt: networkAttempts,
          startedAt,
          completedAt: new Date().toISOString(),
          outcome: "failed",
          httpStatus: lastError.status,
          errorCode: lastError.code,
          retryable: lastError.retryable,
          retryAfterMs: lastError.retryAfterMs,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
        });
      }
      lastError.attempts = [...attemptLog];
      if (!lastError.retryable || attempt === attempts - 1) throw lastError;
      await wait(1_500);
    }
  }
  throw lastError || new GeminiRequestError({
    code: "GEMINI_REQUEST_FAILED",
    message: "Gemini request could not be completed.",
    retryable: false,
    networkAttempts,
  });
}
