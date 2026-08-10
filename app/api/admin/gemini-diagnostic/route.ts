import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";

export const runtime = "nodejs";
export const maxDuration = 30;

const FAILED_TITLES = [
  "연구소도 없는 영천 부품 공장이 대기업 납품용 국산화 시제품 개발비를 해결하는 법",
  "이사 갈 공장도 비싼 기계도 부담스럽다면? 인천시 중소기업육성자금으로 시설 투자 해결하는 법",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function structuredFields(payload: unknown, httpStatus: number, requestedModel: string) {
  const error = record(record(payload).error);
  const details = Array.isArray(error.details) ? error.details.map(record) : [];
  const quotaFailure = details.find((entry) => (
    String(entry["@type"] || "").includes("QuotaFailure")
  ));
  const violations = Array.isArray(quotaFailure?.violations)
    ? quotaFailure.violations.map(record)
    : [];
  const violation = violations[0] || {};
  const dimensions = record(violation.quotaDimensions);
  const retryInfo = details.find((entry) => String(entry["@type"] || "").includes("RetryInfo"));
  const errorInfo = details.find((entry) => String(entry["@type"] || "").includes("ErrorInfo"));
  const metadata = record(errorInfo?.metadata);
  return {
    httpStatus,
    status: error.status ?? null,
    message: error.message ?? null,
    service: metadata.service ?? violation.service ?? "generativelanguage.googleapis.com",
    quotaMetric: violation.quotaMetric ?? null,
    quotaId: violation.quotaId ?? null,
    model: dimensions.model ?? requestedModel,
    location: dimensions.location ?? null,
    retryDelay: retryInfo?.retryDelay ?? null,
  };
}

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
  const model = "gemini-3.5-flash";
  const results = [];
  for (const title of FAILED_TITLES) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with OK only." }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const rawText = await response.text();
    let raw: unknown;
    try {
      raw = JSON.parse(rawText);
    } catch {
      raw = rawText;
    }
    results.push({
      title,
      ...structuredFields(raw, response.status, model),
      retryAfterHeader: response.headers.get("retry-after"),
      raw,
    });
  }
  return NextResponse.json({ reproducedAt: new Date().toISOString(), results });
}
