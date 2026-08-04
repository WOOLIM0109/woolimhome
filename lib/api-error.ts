import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "INVALID_PUBLISHED_URL"
  | "PUBLISHED_ACCOUNT_MISMATCH"
  | "PUBLICATION_ACCOUNT_CONFIG_INVALID"
  | "PUBLISHED_URL_CONFLICT"
  | "PORTFOLIO_REVIEW_REQUIRED"
  | "CONTENT_CHANGED"
  | "NOT_FOUND"
  | "RETRY_SCHEDULED"
  | "INTERNAL_ERROR";

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  options: { retryable?: boolean; nextAction?: string; details?: Record<string, unknown> } = {},
) {
  return NextResponse.json({
    error: message,
    code,
    retryable: options.retryable || false,
    nextAction: options.nextAction || null,
    ...(options.details || {}),
  }, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
