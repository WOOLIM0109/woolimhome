import { redactGeminiTextParts } from "@/lib/security/privacy";
import { GeminiRequestError } from "./retry";
export { GeminiRequestError, geminiRetryDecision } from "./retry";

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

function classifyHttpError(status: number, body: string, retryDelay: number | null) {
  const quotaExhausted = status === 429 && /quota|billing|per.?day|resource_exhausted/i.test(body);
  if (quotaExhausted) {
    return new GeminiRequestError({
      code: "GEMINI_QUOTA_EXHAUSTED",
      message: "Gemini quota is temporarily exhausted.",
      retryable: true,
      status,
      retryAfterMs: retryDelay,
    });
  }
  if (status === 429) {
    return new GeminiRequestError({
      code: "GEMINI_RATE_LIMIT",
      message: "Gemini rate limit was reached.",
      retryable: true,
      status,
      retryAfterMs: retryDelay,
    });
  }
  if ([500, 502, 503, 504].includes(status)) {
    return new GeminiRequestError({
      code: "GEMINI_SERVER_ERROR",
      message: `Gemini returned a temporary server error (${status}).`,
      retryable: true,
      status,
      retryAfterMs: retryDelay,
    });
  }
  return new GeminiRequestError({
    code: "GEMINI_REQUEST_FAILED",
    message: `Gemini request failed (${status}).`,
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
}) {
  const attempts = Math.max(1, Math.min(input.attempts || 4, 5));
  const { parts, redactionCount } = redactGeminiTextParts(input.parts);
  let lastError: GeminiRequestError | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${input.model || "gemini-3.5-flash"}:generateContent?key=${apiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: input.generationConfig || {},
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
        if (!lastError.retryable || attempt === attempts - 1) throw lastError;
        const exponential = Math.min(30_000, 1_500 * (2 ** attempt));
        const jittered = Math.round(exponential * (0.8 + Math.random() * 0.4));
        await wait(Math.max(lastError.retryAfterMs || 0, jittered));
        continue;
      }
      const payload = await response.json();
      const text = payload.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || "").join("")?.trim();
      if (!text) {
        throw new GeminiRequestError({
          code: "GEMINI_EMPTY_RESPONSE",
          message: "Gemini returned an empty response.",
          retryable: true,
          status: response.status,
        });
      }
      return { text, redactionCount };
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        lastError = error;
      } else {
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        lastError = new GeminiRequestError({
          code: timedOut ? "GEMINI_TIMEOUT" : "GEMINI_REQUEST_FAILED",
          message: timedOut ? "Gemini request timed out." : "Gemini request could not be completed.",
          retryable: true,
        });
      }
      if (!lastError.retryable || attempt === attempts - 1) throw lastError;
      await wait(Math.round(Math.min(30_000, 1_500 * (2 ** attempt)) * (0.8 + Math.random() * 0.4)));
    }
  }
  throw lastError || new GeminiRequestError({
    code: "GEMINI_REQUEST_FAILED",
    message: "Gemini request could not be completed.",
    retryable: true,
  });
}
