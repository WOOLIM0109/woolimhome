import assert from "node:assert/strict";
import test from "node:test";
import { GeminiRequestError, geminiRetryDecision } from "./retry.ts";

test("rate limits are requeued with increasing persistent delays", () => {
  const error = new GeminiRequestError({ code: "GEMINI_RATE_LIMIT", message: "limited", retryable: true });
  const first = geminiRetryDecision(error, 0, new Date("2026-08-04T00:00:00.000Z"));
  const third = geminiRetryDecision(error, 2, new Date("2026-08-04T00:00:00.000Z"));
  assert.equal(first.nextRetryAt, "2026-08-04T00:05:00.000Z");
  assert.equal(third.nextRetryAt, "2026-08-04T01:00:00.000Z");
});

test("quota errors wait longer and retrying stops after six attempts", () => {
  const error = new GeminiRequestError({ code: "GEMINI_QUOTA_EXHAUSTED", message: "quota", retryable: true });
  assert.equal(
    geminiRetryDecision(error, 0, new Date("2026-08-04T00:00:00.000Z")).nextRetryAt,
    "2026-08-04T06:00:00.000Z",
  );
  assert.equal(geminiRetryDecision(error, 6).retryable, false);
});
