import { generateGeminiText } from "../gemini/client";
import { GEMINI_AUTOMATION_MODEL } from "../gemini/automation";
import { requirementsPrompt, type RequirementInput } from "./requirements";

export const REQUIREMENTS_RESPONSE_MAX_TOKENS = 16_000;

// GenerateContent configuration and the supported JSON Schema subset:
// https://ai.google.dev/gemini-api/docs/generate-content/thinking
// https://ai.google.dev/gemini-api/docs/generate-content/structured-output
const nullableText = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"], minimum: 0 };
const nullableInteger = { type: ["integer", "null"], minimum: 0 };
const nullableList = { type: ["array", "null"], items: nullableText };

/** No patternProperties, refs, conditional schema, or undocumented response-schema keywords. */
export const REQUIREMENTS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    regions: nullableList,
    target_types: nullableList,
    business_age: {
      type: ["object", "null"],
      properties: {
        min_years: nullableNumber,
        max_years: nullableNumber,
        basis: nullableText,
        as_of: { type: ["string", "null"], format: "date" },
      },
      required: ["min_years", "max_years", "basis"],
      additionalProperties: false,
    },
    size: {
      type: ["object", "null"],
      properties: { max_employees: nullableInteger, max_revenue_krw: nullableInteger, text: nullableText },
      required: ["max_employees", "max_revenue_krw", "text"],
      additionalProperties: false,
    },
    industries_included: nullableList,
    industries_excluded: nullableList,
    required_certifications: nullableList,
    bonus_points: {
      type: ["array", "null"],
      items: {
        type: "object", properties: { item: nullableText, points: nullableNumber },
        required: ["item", "points"], additionalProperties: false,
      },
    },
    support_amount_text: nullableText,
    self_pay_text: nullableText,
    deadline_at: { type: ["string", "null"], format: "date-time" },
    submission_documents: {
      type: ["array", "null"],
      items: {
        type: "object", properties: { name: nullableText, issuer: nullableText, note: nullableText },
        required: ["name", "issuer", "note"], additionalProperties: false,
      },
    },
    evaluation: {
      type: ["object", "null"], properties: { method: nullableText, criteria_text: nullableText },
      required: ["method", "criteria_text"], additionalProperties: false,
    },
    contact: nullableText,
    evidence: { type: ["object", "null"], additionalProperties: { type: "string" } },
  },
  required: ["regions", "target_types", "business_age", "size", "industries_included", "industries_excluded",
    "required_certifications", "bonus_points", "support_amount_text", "self_pay_text", "deadline_at",
    "submission_documents", "evaluation", "contact", "evidence"],
  additionalProperties: false,
};

const ERROR_CODES = ["GEMINI_RATE_LIMIT", "GEMINI_QUOTA_EXHAUSTED", "GEMINI_SERVER_ERROR", "GEMINI_TIMEOUT",
  "GEMINI_REQUEST_FAILED", "GEMINI_EMPTY_RESPONSE", "GEMINI_DISABLED", "GEMINI_APPROVAL_REQUIRED"] as const;
const FINISH_REASONS = ["FINISH_REASON_UNSPECIFIED", "STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "LANGUAGE",
  "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "MALFORMED_FUNCTION_CALL", "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT", "IMAGE_OTHER", "NO_IMAGE", "IMAGE_RECITATION", "UNEXPECTED_TOOL_CALL",
  "TOO_MANY_TOOL_CALLS", "MISSING_THOUGHT_SIGNATURE", "MALFORMED_RESPONSE", "ESCALATION",
  "PUP_LIMITED_DISABLED", "CONTINUATION"] as const;
const USAGE_FIELDS = ["inputTokens", "outputTokens", "candidateTokens", "thoughtsTokens", "totalTokens", "cachedInputTokens"] as const;
type ErrorCode = typeof ERROR_CODES[number];
export type RequirementFinishReason = typeof FINISH_REASONS[number];
export type RequirementSafeDiagnostics = {
  code: ErrorCode | null;
  status: number | null;
  finishReason: RequirementFinishReason | null;
  usage: Partial<Record<typeof USAGE_FIELDS[number], number>>;
};
export type RequirementGeneratedResponse = {
  rawText: string;
  finishReason: RequirementFinishReason | null;
  safeDiagnostics: RequirementSafeDiagnostics;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function finishReason(value: unknown): RequirementFinishReason | null {
  return typeof value === "string" && (FINISH_REASONS as readonly string[]).includes(value) ? value as RequirementFinishReason : null;
}

/** Deliberately does not read message, body, headers, URLs, prompt text, or raw provider diagnostics. */
function diagnostics(value: unknown, failed: boolean): RequirementSafeDiagnostics {
  const fallback: RequirementSafeDiagnostics = { code: failed ? "GEMINI_REQUEST_FAILED" : null, status: null, finishReason: null, usage: {} };
  try {
    const source = record(value);
    const attempts = Array.isArray(source.attempts) ? source.attempts : [];
    const lastAttempt = record(attempts.at(-1));
    const status = source.status ?? lastAttempt.httpStatus;
    const usage = record(source.usage ?? lastAttempt);
    const safeUsage: RequirementSafeDiagnostics["usage"] = {};
    for (const field of USAGE_FIELDS) {
      const count = usage[field];
      if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) safeUsage[field] = count;
    }
    return {
      code: failed && typeof source.code === "string" && (ERROR_CODES as readonly string[]).includes(source.code)
        ? source.code as ErrorCode : fallback.code,
      status: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
      finishReason: finishReason(source.finishReason),
      usage: safeUsage,
    };
  } catch { return fallback; }
}

export class RequirementGenerationError extends Error {
  readonly safeDiagnostics: RequirementSafeDiagnostics;
  constructor(safeDiagnostics: RequirementSafeDiagnostics) {
    super("공고 요건 응답 생성 실패");
    this.name = "RequirementGenerationError";
    this.safeDiagnostics = safeDiagnostics;
  }
}

/** The caller must keep the existing budget gate. This helper makes exactly one client request, never a retry. */
export async function generateRequirementResponse(
  input: RequirementInput,
  options: { timeoutMs?: number } = {},
): Promise<RequirementGeneratedResponse> {
  const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(80_000, Math.floor(options.timeoutMs))) : 80_000;
  try {
    const result = await generateGeminiText({
      model: GEMINI_AUTOMATION_MODEL,
      parts: [{ text: requirementsPrompt(input) }],
      attempts: 1,
      timeoutMs,
      generationConfig: {
        thinkingConfig: { thinkingLevel: "low" },
        responseMimeType: "application/json",
        responseJsonSchema: structuredClone(REQUIREMENTS_RESPONSE_SCHEMA),
        maxOutputTokens: REQUIREMENTS_RESPONSE_MAX_TOKENS,
      },
    });
    const safeDiagnostics = diagnostics(result, false);
    // Keep partial or invalid JSON verbatim for private persistence and later validation by the caller.
    return { rawText: result.text, finishReason: safeDiagnostics.finishReason, safeDiagnostics };
  } catch (error) {
    throw new RequirementGenerationError(diagnostics(error, true));
  }
}
